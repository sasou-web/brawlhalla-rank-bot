/**
 * True combos Brawlhalla — données BrawlDatabase (https://www.brawldatabase.com).
 * - loadCombos / combosFor / weaponsWithCombos : lecture du dataset
 * - refreshCombos : (re)scrape depuis BrawlDB et écrit data/combos.json
 * - buildCombosMessage : payload Discord (vidéo + stats + menu arme + navigation)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "..", "data", "combos.json");
const BASE = "https://www.brawldatabase.com";
const MAX_ID = 240;
const CONCURRENCY = 10;
const HEADERS = { "HX-Request": "true", "User-Agent": "Mozilla/5.0 (combo-fetcher)" };

// slug d'arme BrawlDB -> libellé FR + emoji.
export const WEAPON_META = {
  sword: { label: "Épée", emoji: "🗡️" },
  hammer: { label: "Marteau", emoji: "🔨" },
  blasters: { label: "Blasters", emoji: "🔫" },
  lance: { label: "Lance", emoji: "🐎" },
  spear: { label: "Spear", emoji: "🔱" },
  katars: { label: "Katars", emoji: "🐾" },
  axe: { label: "Hache", emoji: "🪓" },
  bow: { label: "Arc", emoji: "🏹" },
  gauntlets: { label: "Gantelets", emoji: "🥊" },
  scythe: { label: "Faux", emoji: "☠️" },
  cannon: { label: "Canon", emoji: "💣" },
  orb: { label: "Orbe", emoji: "🔮" },
  greatsword: { label: "Grande épée", emoji: "⚔️" },
  battle_boots: { label: "Bottes", emoji: "🥾" },
  unarmed: { label: "Mains nues", emoji: "✊" },
  chakram: { label: "Chakram", emoji: "💫" },
};

export const weaponLabel = (slug) => WEAPON_META[slug]?.label || slug;
export const weaponEmoji = (slug) => WEAPON_META[slug]?.emoji || "⚔️";

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
// Le viewer est ré-affiché à chaque navigation (changement d'arme / de combo). Sans
// cache, on re-`fetch` le .mp4 et on le recharge entièrement en RAM à CHAQUE clic.
// LRU borné : budget total + taille max par fichier + TTL. Au-delà du budget, on évince
// les entrées les plus anciennes ; un fichier trop gros n'est jamais mis en cache.
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
  while (videoCacheBytes + size > VIDEO_MAX_BYTES && videoCache.size) {
    const oldest = videoCache.keys().next().value;
    const old = videoCache.get(oldest);
    videoCache.delete(oldest);
    videoCacheBytes -= old.size;
  }
  videoCache.set(key, { buf, size, ts: Date.now() });
  videoCacheBytes += size;
}

// Renvoie le buffer vidéo d'un combo (cache-first), ou null si indisponible.
async function getComboVideo(weapon, c) {
  const key = `${weapon}-${c.id}`;
  const hit = videoCacheGet(key);
  if (hit) return hit;
  try {
    const r = await fetch(c.video, { headers: { "User-Agent": "Mozilla/5.0 (combo-fetcher)" } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    videoCacheSet(key, buf);
    return buf;
  } catch {
    return null;
  }
}

// ---------- Payloads Discord (Components V2) ----------

const COMBO_COLOR = 0xf1c40f;
const cbDivider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// Panneau PUBLIC persistant : guide « comment ça marche » + menu d'armes, en un seul bloc V2.
// Chaque clic ouvre un affichage privé (ephemeral) propre à l'utilisateur.
export async function buildPanelMessage() {
  const weapons = await weaponsWithCombos();
  const container = new ContainerBuilder().setAccentColor(COMBO_COLOR);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## 🥊 Combos Brawlhalla — comment ça marche\n" +
        "Choisis ton **arme** ci-dessous (ou tape `/combos`) pour parcourir les meilleurs **true combos** du jeu.",
    ),
  );

  container.addSeparatorComponents(cbDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "🎯 **Choisis ton arme** → tu vois ses combos, du plus simple au plus technique.\n" +
        "🎬 **Pour chaque combo** : une vidéo, sa notation, sa **facilité /10**, ses **dégâts** et la **dextérité** requise.\n" +
        "🔄 **Change d'arme ou de combo** quand tu veux via les menus déroulants.\n" +
        "🔒 **C'est privé** : l'affichage n'est visible que par toi → plusieurs personnes peuvent l'utiliser en même temps.",
    ),
  );

  container.addSeparatorComponents(cbDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "💡 **Conseil débutant** — commence par les combos **facilité 10/10**, les plus faciles à placer en match.",
    ),
  );

  container.addSeparatorComponents(cbDivider());
  const menu = new StringSelectMenuBuilder()
    .setCustomId("cbp_open")
    .setPlaceholder("Choisis une arme…")
    .addOptions(weapons.map((w) => ({ label: weaponLabel(w), value: w, emoji: { name: weaponEmoji(w) } })));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Données & vidéos : BrawlDatabase.com"));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// Affichage privé d'un combo (Components V2) : vidéo + stats dans le cadre, menus + lien dessous.
// Renvoie un payload SANS flags : l'appelant diffère la réponse avec EPHEMERAL_V2.
export async function buildComboViewer(weapon, id) {
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

  const container = new ContainerBuilder().setAccentColor(COMBO_COLOR);

  // Vidéo en haut du cadre (Media Gallery). Repli sur un lien si le téléchargement échoue.
  let files = [];
  const name = `${weapon}-${c.id}.mp4`;
  const buf = await getComboVideo(weapon, c);
  if (buf) {
    files = [{ attachment: buf, name }];
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)),
    );
    container.addSeparatorComponents(cbDivider());
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${weaponEmoji(weapon)} ${weaponLabel(weapon)}\n**${c.notation}**`),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `🎯 **Facilité :** ${c.usability}/10\n` +
        `💥 **Dégâts :** ${c.damage}\n` +
        `✋ **Dextérité :** ${c.dexterity}\n` +
        `📊 **Dégâts moyens :** ${c.avgDamage}`,
    ),
  );
  if (!buf) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🎥 [Voir la vidéo](${c.video})`));
  }

  container.addSeparatorComponents(cbDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Combo ${pos + 1}/${list.length} · source BrawlDatabase.com`),
  );

  // Menus (changer d'arme / de combo) + lien, sous le cadre.
  const weaponMenu = new StringSelectMenuBuilder()
    .setCustomId("cbp_weapon")
    .setPlaceholder(`${weaponLabel(weapon)} — changer d'arme`)
    .addOptions(weapons.map((w) => ({ label: weaponLabel(w), value: w, emoji: { name: weaponEmoji(w) }, default: w === weapon })));

  const shown = list.slice(0, 25); // Discord limite un menu à 25 options.
  const comboMenu = new StringSelectMenuBuilder()
    .setCustomId(`cbp_pick:${weapon}`)
    .setPlaceholder("Choisis un combo…")
    .addOptions(
      shown.map((x) => ({
        label: x.notation.slice(0, 100),
        description: `Facilité ${x.usability}/10 · ${x.avgDamage} dmg moy.`.slice(0, 100),
        value: String(x.id),
        default: x.id === c.id,
      })),
    );

  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Voir sur BrawlDB").setURL(c.url),
  );

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(weaponMenu),
      new ActionRowBuilder().addComponents(comboMenu),
      linkRow,
    ],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}


