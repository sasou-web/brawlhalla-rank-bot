/**
 * True combos Brawlhalla — données BrawlDatabase (https://www.brawldatabase.com).
 * - loadCombos / combosFor / comboById / weaponsWithCombos : lecture du dataset
 * - refreshCombos : (re)scrape depuis BrawlDB et écrit data/combos.json
 * - getComboVideo / getSlowComboVideo : vidéo d'origine (cache LRU) et ralenti x0.25 (ffmpeg)
 * - buildPanelMessage / buildComboViewer : payloads Discord (Components V2)
 *
 * Aucun accès à la base ici : la progression (combos maîtrisés) est fournie par l'appelant,
 * pour que scripts/scrape-combos.js et deploy-commands n'ouvrent jamais data/bot.db.
 */
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { WEAPON_META, weaponLabel, weaponEmoji } from "./comboData.js";

// Ré-export : definitions.js, server.js… importaient ces symboles depuis ce module.
export { WEAPON_META, weaponLabel, weaponEmoji };

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "..", "data", "combos.json");
const BASE = "https://www.brawldatabase.com";
const MAX_ID = 240;
const CONCURRENCY = 10;
const HEADERS = { "HX-Request": "true", "User-Agent": "Mozilla/5.0 (combo-fetcher)" };

let cache = null;
let meta = { scrapedAt: null };

export async function loadCombos() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(DATA, "utf8"));
    cache = Array.isArray(raw.combos) ? raw.combos : [];
    meta.scrapedAt = raw.scrapedAt || null;
  } catch {
    cache = [];
  }
  return cache;
}

export async function combosInfo() {
  const combos = await loadCombos();
  const byWeapon = {};
  for (const c of combos) byWeapon[c.weapon] = (byWeapon[c.weapon] || 0) + 1;
  return { count: combos.length, scrapedAt: meta.scrapedAt, byWeapon };
}

export async function weaponsWithCombos() {
  const combos = await loadCombos();
  const present = new Set(combos.map((c) => c.weapon));
  return Object.keys(WEAPON_META).filter((w) => present.has(w));
}

export async function combosFor(weapon) {
  const combos = await loadCombos();
  return combos.filter((c) => c.weapon === weapon);
}

// Les ids BrawlDB sont uniques toutes armes confondues.
export async function comboById(id) {
  const combos = await loadCombos();
  return combos.find((c) => String(c.id) === String(id)) || null;
}

// ---------- Scrape / refresh ----------
const decodeHtml = (s) =>
  (s || "")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function fetchCombo(id) {
  let res;
  try {
    res = await fetch(`${BASE}/combos/${id}/`, { headers: HEADERS });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  const t = await res.text();
  const vid = t.match(/\/media\/combos\/([\w-]+)\/(\d+)\.mp4/);
  if (!vid) return null;
  const weapon = vid[1];
  const notationRaw = (t.match(/combo--viewer__header[\s\S]*?<h1>([\s\S]*?)<\/h1>/) || [])[1] || "";
  const notation = decodeHtml(
    notationRaw.replace(/<span class="modifier">(.*?)<\/span>/g, "[$1]").replace(/<[^>]+>/g, ""),
  );
  if (!notation) return null;
  const desc = (t.match(/og:description" content="([^"]*)"/) || [])[1] || "";
  const stats = desc.match(/Usability:\s*(\d+)\s*\|\s*Damage Range:\s*(.+?)\s*\|\s*Dexterity:\s*(.+?)\s*\|\s*Average Damage:\s*(\d+)/);
  return {
    id,
    weapon,
    notation,
    usability: stats ? Number(stats[1]) : 0,
    damage: stats ? stats[2].trim() : "—",
    dexterity: stats ? stats[3].trim() : "Any",
    avgDamage: stats ? Number(stats[4]) : 0,
    video: `${BASE}/media/combos/${weapon}/${id}.mp4`,
    url: `${BASE}/combos/${id}/`,
  };
}

// Re-scrape BrawlDB et réécrit data/combos.json. Renvoie { count, byWeapon }.
export async function refreshCombos() {
  const ids = Array.from({ length: MAX_ID }, (_, i) => i + 1);
  const combos = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchCombo));
    for (const c of results) if (c) combos.push(c);
  }
  combos.sort((a, b) => a.weapon.localeCompare(b.weapon) || b.usability - a.usability || a.id - b.id);
  const scrapedAt = new Date().toISOString();
  await mkdir(dirname(DATA), { recursive: true });
  await writeFile(DATA, JSON.stringify({ source: BASE, scrapedAt, combos }, null, 2));
  cache = combos; // recharge le cache à chaud
  meta.scrapedAt = scrapedAt;
  const byWeapon = {};
  for (const c of combos) byWeapon[c.weapon] = (byWeapon[c.weapon] || 0) + 1;
  return { count: combos.length, byWeapon };
}

// ---------- Cache mémoire des vidéos de combos (anti re-téléchargement) ----------
// Le viewer est ré-affiché à chaque navigation (changement d'arme / de combo) et le Combo Lab
// sert les mêmes fichiers. Sans cache, on re-`fetch` le .mp4 et on le recharge entièrement en
// RAM à CHAQUE clic. LRU borné : budget total + taille max par fichier + TTL. Au-delà du budget,
// on évince les entrées les plus anciennes ; un fichier trop gros n'est jamais mis en cache.
const VIDEO_TTL_MS = 60 * 60 * 1000; // 1 h
const VIDEO_MAX_BYTES = 80 * 1024 * 1024; // budget total ~80 Mo
const VIDEO_MAX_FILE = 12 * 1024 * 1024; // ne cache pas un fichier > 12 Mo
const videoCache = new Map(); // key -> { buf, size, ts }
let videoCacheBytes = 0;

function videoCacheGet(key) {
  const e = videoCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > VIDEO_TTL_MS) {
    videoCache.delete(key);
    videoCacheBytes -= e.size;
    return null;
  }
  // Rafraîchit la récence (LRU : Map conserve l'ordre d'insertion).
  videoCache.delete(key);
  videoCache.set(key, e);
  return e.buf;
}

function videoCacheSet(key, buf) {
  const size = buf.length;
  if (size > VIDEO_MAX_FILE) return; // trop gros : on sert sans cacher
  const prev = videoCache.get(key);
  if (prev) {
    videoCache.delete(key);
    videoCacheBytes -= prev.size;
  }
  while (videoCacheBytes + size > VIDEO_MAX_BYTES && videoCache.size) {
    const oldest = videoCache.keys().next().value;
    const old = videoCache.get(oldest);
    videoCache.delete(oldest);
    videoCacheBytes -= old.size;
  }
  videoCache.set(key, { buf, size, ts: Date.now() });
  videoCacheBytes += size;
}

// Téléchargements en cours, partagés : deux demandes simultanées du même fichier (Lab +
// Discord, ou requêtes Range parallèles du navigateur) ne déclenchent qu'un seul fetch.
const videoInflight = new Map();

// Renvoie le buffer vidéo d'origine d'un combo (cache-first), ou null si indisponible.
export async function getComboVideo(c) {
  const key = `${c.weapon}-${c.id}`;
  const hit = videoCacheGet(key);
  if (hit) return hit;
  if (videoInflight.has(key)) return videoInflight.get(key);
  const p = (async () => {
    try {
      const r = await fetch(c.video, { headers: { "User-Agent": "Mozilla/5.0 (combo-fetcher)" } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      videoCacheSet(key, buf);
      return buf;
    } catch {
      return null;
    }
  })().finally(() => videoInflight.delete(key));
  videoInflight.set(key, p);
  return p;
}

// ---------- Ralenti x0.25 (ffmpeg, SANS réencodage) ----------
// Le lecteur de Discord n'a ni vitesse ni boucle : on produit une version ralentie, jouée
// plusieurs fois d'affilée et sans son. Les images d'origine sont recopiées telles quelles
// (`-c:v copy`) et seuls leurs horodatages sont étirés (`-itsscale 4`) : 60 i/s deviennent
// 15 i/s, en qualité d'origine. Mesuré sur le serveur de prod (2 vCPU partagés) : ~0,1 s de
// CPU, contre ~25 s pour un réencodage libx264. ffmpeg est optionnel : sans lui, le bouton
// n'est simplement pas proposé.
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const SLOW_FACTOR = 4; // x0.25
export const SLOW_LOOPS = 3; // la séquence est jouée 3 fois (moins si la vidéo est lourde)
const SLOW_TIMEOUT_MS = 15_000;
const SLOW_MAX_JOBS = 2; // traitements simultanés
const SLOW_MAX_QUEUE = 10; // au-delà, on refuse plutôt que d'accumuler
const SLOW_MAX_UPLOAD = 9 * 1024 * 1024; // marge sous la limite d'envoi Discord (10 Mo)

/** Nombre de répétitions du ralenti pour une source de `size` octets (le fichier final pèse ~size × répétitions). */
export function slowLoopsFor(size) {
  return Math.max(1, Math.min(SLOW_LOOPS, Math.floor(SLOW_MAX_UPLOAD / Math.max(1, size))));
}

let ffmpegProbe = null;
/** true si ffmpeg répond (détecté une seule fois, résultat mémorisé). */
export function slowmoAvailable() {
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise((resolveProbe) => {
      let child;
      try {
        child = spawn(FFMPEG, ["-hide_banner", "-version"], { stdio: "ignore", windowsHide: true });
      } catch {
        resolveProbe(false);
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveProbe(false);
      }, 5000);
      child.on("error", () => {
        clearTimeout(timer);
        resolveProbe(false);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolveProbe(code === 0);
      });
    }).then((ok) => {
      if (!ok) console.warn(`Ralenti des combos désactivé : ffmpeg introuvable (${FFMPEG}). Installe-le (apt install ffmpeg) ou renseigne FFMPEG_PATH.`);
      return ok;
    });
  }
  return ffmpegProbe;
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error("délai dépassé"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectRun(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else rejectRun(new Error(`code ${code} : ${stderr.trim().split("\n").pop() || "?"}`));
    });
  });
}

// File d'attente : au plus SLOW_MAX_JOBS traitements ffmpeg en parallèle. Le créneau est transmis
// directement au suivant, sans fenêtre où un nouvel arrivant pourrait doubler la limite.
let slowJobs = 0;
const slowQueue = [];
async function withSlowSlot(fn) {
  if (slowJobs >= SLOW_MAX_JOBS) {
    if (slowQueue.length >= SLOW_MAX_QUEUE) return null;
    await new Promise((r) => slowQueue.push(r));
  } else {
    slowJobs++;
  }
  try {
    return await fn();
  } finally {
    const next = slowQueue.shift();
    if (next) next();
    else slowJobs--;
  }
}

const slowInflight = new Map();

/** Buffer MP4 ralenti x0.25 (joué slowLoopsFor(source) fois), ou null si ffmpeg absent / échec. */
export async function getSlowComboVideo(c) {
  const key = `${c.weapon}-${c.id}:slow`;
  const hit = videoCacheGet(key);
  if (hit) return hit;
  if (slowInflight.has(key)) return slowInflight.get(key);
  const p = (async () => {
    if (!(await slowmoAvailable())) return null;
    const src = await getComboVideo(c);
    if (!src) return null;
    return withSlowSlot(async () => {
      const base = join(tmpdir(), `xk-combo-${c.id}-${randomBytes(4).toString("hex")}`);
      const inPath = `${base}-in.mp4`;
      const outPath = `${base}-slow.mp4`;
      try {
        await writeFile(inPath, src);
        await runFfmpeg(
          [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-stream_loop", String(slowLoopsFor(src.length) - 1),
            "-itsscale", String(SLOW_FACTOR),
            "-i", inPath,
            "-map", "0:v:0", "-an",
            "-c:v", "copy",
            "-movflags", "+faststart",
            outPath,
          ],
          SLOW_TIMEOUT_MS,
        );
        const buf = await readFile(outPath);
        if (!buf.length || buf.length > SLOW_MAX_UPLOAD) return null;
        videoCacheSet(key, buf);
        return buf;
      } catch (err) {
        console.warn(`Ralenti du combo ${c.id} impossible :`, err.message);
        return null;
      } finally {
        unlink(inPath).catch(() => {});
        unlink(outPath).catch(() => {});
      }
    });
  })().finally(() => slowInflight.delete(key));
  slowInflight.set(key, p);
  return p;
}

// ---------- Payloads Discord (Components V2) ----------

const COMBO_COLOR = 0xf1c40f;
const cbDivider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// URL du Combo Lab (page publique du dashboard), ou "" si le dashboard n'a pas d'URL publique.
export function comboLabUrl(labBaseUrl, id = null) {
  const root = String(labBaseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(root)) return "";
  return id != null ? `${root}/lab/?c=${encodeURIComponent(id)}` : `${root}/lab/`;
}

// Panneau PUBLIC persistant : guide « comment ça marche » + menu d'armes, en un seul bloc V2.
// Chaque clic ouvre un affichage privé (ephemeral) propre à l'utilisateur.
export async function buildPanelMessage({ labBaseUrl = "" } = {}) {
  const weapons = await weaponsWithCombos();
  const labUrl = comboLabUrl(labBaseUrl);
  const slowOk = await slowmoAvailable();
  const container = new ContainerBuilder().setAccentColor(COMBO_COLOR);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## 🥊 Combos Brawlhalla — comment ça marche\n" +
        "Choisis ton **arme** ci-dessous (ou tape `/combos`) pour parcourir et **apprendre** les meilleurs **true combos** du jeu.",
    ),
  );

  const features = [
    "🎯 **Choisis ton arme** → tu vois ses combos, du plus simple au plus technique.",
    "🎬 **Pour chaque combo** : une vidéo, sa notation, sa **facilité /10**, ses **dégâts** et la **dextérité** requise.",
    slowOk ? "🐌 **Ralenti x0.25** en un clic pour bien voir chaque input." : null,
    "✅ **Je maîtrise** : coche tes combos, suis ta progression par arme et débloque XP et succès.",
    labUrl ? "🎓 **Combo Lab** : vitesse réglable, image par image, zoom, boucle A-B et miroir, dans ton navigateur." : null,
    "🔒 **C'est privé** : l'affichage n'est visible que par toi → plusieurs personnes peuvent l'utiliser en même temps.",
  ].filter(Boolean);
  container.addSeparatorComponents(cbDivider());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(features.join("\n")));

  container.addSeparatorComponents(cbDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "💡 **Conseil débutant** — commence par les combos **facilité 10/10**, travaille-les au ralenti, puis remonte la vitesse.",
    ),
  );

  container.addSeparatorComponents(cbDivider());
  const menu = new StringSelectMenuBuilder()
    .setCustomId("cbp_open")
    .setPlaceholder("Choisis une arme…")
    .addOptions(weapons.map((w) => ({ label: weaponLabel(w), value: w, emoji: { name: weaponEmoji(w) } })));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  if (labUrl) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Ouvrir le Combo Lab").setEmoji("🎓").setURL(labUrl),
      ),
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Données & vidéos : BrawlDatabase.com"));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Affichage privé d'un combo (Components V2) : vidéo + stats dans le cadre, menus + boutons dessous.
 * Renvoie un payload SANS flags d'éphémère : l'appelant diffère la réponse avec EPHEMERAL_V2.
 *
 * opts.mastered   : Set des ids de combos maîtrisés par le membre (null = pas de progression,
 *                   ex. hors serveur) ; active le bouton « Je maîtrise » et les compteurs.
 * opts.slow       : affiche la version ralentie x0.25 (si ffmpeg est disponible).
 * opts.labBaseUrl : racine publique du dashboard (PUBLIC_URL) pour le lien Combo Lab.
 * opts.notice     : ligne d'information affichée sous les stats (XP gagnée, succès…).
 */
export async function buildComboViewer(weapon, id, { mastered = null, slow = false, labBaseUrl = "", notice = "" } = {}) {
  const list = await combosFor(weapon);
  if (!list.length) {
    return {
      components: [new TextDisplayBuilder().setContent("Aucun combo pour cette arme.")],
      files: [],
      flags: MessageFlags.IsComponentsV2,
    };
  }
  let c = id != null ? list.find((x) => String(x.id) === String(id)) : null;
  if (!c) c = list[0];
  const pos = list.indexOf(c);
  const weapons = await weaponsWithCombos();
  const all = await loadCombos();
  const slowOk = await slowmoAvailable();
  const isDone = (x) => Boolean(mastered?.has(Number(x.id)));
  const doneHere = mastered ? list.filter(isDone).length : 0;

  const container = new ContainerBuilder().setAccentColor(COMBO_COLOR);

  // Vidéo en haut du cadre (Media Gallery) : ralentie si demandé, sinon d'origine.
  // Repli sur la vidéo normale si le ralenti échoue, puis sur un lien si tout échoue.
  let files = [];
  let slowShown = false;
  let slowFailed = false;
  let buf = null;
  let name = `${weapon}-${c.id}.mp4`;
  if (slow && slowOk) {
    buf = await getSlowComboVideo(c);
    if (buf) {
      slowShown = true;
      name = `${weapon}-${c.id}-ralenti.mp4`;
    } else {
      slowFailed = true;
    }
  }
  if (!buf) buf = await getComboVideo(c);
  if (buf) {
    files = [{ attachment: buf, name }];
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)),
    );
    if (slowShown) {
      const source = await getComboVideo(c); // en cache : sert juste à connaître le nombre de répétitions
      const loops = slowLoopsFor(source?.length || 0);
      const repeat = loops > 1 ? ` · joué ${loops} fois de suite` : "";
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# 🐌 Ralenti x${1 / SLOW_FACTOR}${repeat} · sans son`),
      );
    }
    container.addSeparatorComponents(cbDivider());
  }

  const masteredLine = isDone(c) ? "\n✅ **Tu maîtrises ce combo**" : "";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${weaponEmoji(weapon)} ${weaponLabel(weapon)}\n**${c.notation}**${masteredLine}`),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `🎯 **Facilité :** ${c.usability}/10\n` +
        `💥 **Dégâts :** ${c.damage}\n` +
        `✋ **Dextérité :** ${c.dexterity}\n` +
        `📊 **Dégâts moyens :** ${c.avgDamage}`,
    ),
  );
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 1000)));
  if (slowFailed) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("⚠️ Ralenti indisponible pour le moment : vidéo à vitesse normale."),
    );
  }
  if (!buf) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🎥 [Voir la vidéo](${c.video})`));
  }

  container.addSeparatorComponents(cbDivider());
  const footer = [`Combo ${pos + 1}/${list.length}`];
  if (mastered) footer.push(`✅ ${doneHere}/${list.length} maîtrisés (${weaponLabel(weapon)})`);
  footer.push("source BrawlDatabase.com");
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer.join(" · ")}`));

  // Menus (changer d'arme / de combo), sous le cadre. Avec la progression : x/y par arme.
  const perWeapon = {};
  for (const x of all) {
    const s = (perWeapon[x.weapon] ||= { total: 0, done: 0 });
    s.total++;
    if (isDone(x)) s.done++;
  }
  const weaponMenu = new StringSelectMenuBuilder()
    .setCustomId("cbp_weapon")
    .setPlaceholder(`${weaponLabel(weapon)} — changer d'arme`)
    .addOptions(
      weapons.map((w) => {
        const s = perWeapon[w] || { total: 0, done: 0 };
        return {
          label: weaponLabel(w),
          value: w,
          emoji: { name: weaponEmoji(w) },
          description: (mastered ? `✅ ${s.done}/${s.total} maîtrisés` : `${s.total} combos`).slice(0, 100),
          default: w === weapon,
        };
      }),
    );

  const shown = list.slice(0, 25); // Discord limite un menu à 25 options.
  const comboMenu = new StringSelectMenuBuilder()
    .setCustomId(`cbp_pick:${weapon}`)
    .setPlaceholder("Choisis un combo…")
    .addOptions(
      shown.map((x) => ({
        label: x.notation.slice(0, 100),
        description: `${isDone(x) ? "Maîtrisé · " : ""}Facilité ${x.usability}/10 · ${x.avgDamage} dmg moy.`.slice(0, 100),
        value: String(x.id),
        ...(isDone(x) ? { emoji: { name: "✅" } } : {}),
        default: x.id === c.id,
      })),
    );

  // Boutons : ralenti (bascule), maîtrise (bascule), Combo Lab, BrawlDB. Le dernier champ des
  // customIds mémorise la vitesse affichée pour que chaque bouton la conserve.
  const slowFlag = slowShown ? 1 : 0;
  const buttons = [];
  if (slowOk) {
    buttons.push(
      slowShown
        ? new ButtonBuilder().setCustomId(`cbp_slow:${weapon}:${c.id}:0`).setStyle(ButtonStyle.Secondary).setEmoji("▶️").setLabel("Vitesse normale")
        : new ButtonBuilder().setCustomId(`cbp_slow:${weapon}:${c.id}:1`).setStyle(ButtonStyle.Primary).setEmoji("🐌").setLabel("Ralenti x0.25"),
    );
  }
  if (mastered) {
    buttons.push(
      isDone(c)
        ? new ButtonBuilder().setCustomId(`cbp_master:${weapon}:${c.id}:${slowFlag}`).setStyle(ButtonStyle.Secondary).setEmoji("↩️").setLabel("Plus maîtrisé")
        : new ButtonBuilder().setCustomId(`cbp_master:${weapon}:${c.id}:${slowFlag}`).setStyle(ButtonStyle.Success).setEmoji("✅").setLabel("Je maîtrise"),
    );
  }
  const labUrl = comboLabUrl(labBaseUrl, c.id);
  if (labUrl) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setEmoji("🎓").setLabel("Combo Lab").setURL(labUrl));
  }
  buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("BrawlDB").setURL(c.url));

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(weaponMenu),
      new ActionRowBuilder().addComponents(comboMenu),
      new ActionRowBuilder().addComponents(...buttons),
    ],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
