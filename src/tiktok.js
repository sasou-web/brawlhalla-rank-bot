import {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import {
  SourceError,
  byNewest,
  fetchEmbedItems,
  fetchFeedItems,
  handleFromFeedUrl,
  handleFromItems,
  normalizeHandle,
  stableVideoId,
} from "./tiktokSource.js";

// Réexports : API historique du module (tests, panneau, dashboard).
export { parseFeedXml, fetchFeedItems, stableVideoId, normalizeHandle } from "./tiktokSource.js";

/**
 * Notifications TikTok : poste chaque nouvelle vidéo d'un compte dans un salon.
 *
 * ── Pourquoi cette refonte ─────────────────────────────────────────────────────────────
 * L'ancienne version ne lisait qu'un flux RSS régénéré par une Action GitHub toutes les 4 h,
 * qui échouait la plupart du temps (TikTok bloque le scraping depuis les IP GitHub). Les
 * vidéos arrivaient donc avec 8 h à 4 jours de retard, plusieurs à la fois (= rafales).
 * Le dédoublonnage reposait sur un seul `lastItemId`, que le dashboard écrasait avec une
 * valeur périmée à chaque enregistrement (= reposts).
 *
 * ── Fonctionnement ─────────────────────────────────────────────────────────────────────
 * - Source principale : l'embed officiel du profil (tiktokSource.js), lu toutes les ~2 min.
 *   Flux RSS en secours optionnel, utilisé seulement si l'embed ne répond pas.
 * - Dédoublonnage par ENSEMBLE d'IDs vidéo déjà vus (et non plus « dernier posté ») :
 *   l'ordre du flux, les épinglées ou une resynchronisation ne peuvent plus faire reposter.
 * - Première lecture d'une source = amorçage silencieux (on mémorise, on ne poste rien).
 * - Jamais de rafale : plusieurs nouveautés au même passage -> UN message (la plus récente
 *   en carte, les autres en liens). Au-delà de MAX_BATCH, c'est une anomalie : on
 *   resynchronise sans rien poster.
 * - La configuration (modifiable par le staff) et l'état interne (IDs vus, diagnostics) sont
 *   stockés dans deux documents séparés : enregistrer la config ne touche jamais à l'état.
 * - Pause progressive par source en cas d'erreurs, alerte dans le salon d'alertes si une
 *   source reste illisible plus d'une heure, et message de rétablissement.
 */

// ---------- Réglages ----------

const MAX_BATCH = 5; // au-delà : anomalie (source réordonnée, compte changé...) -> resync
const MAX_UPLOAD_AGE_MS = 30 * 24 * 3600 * 1000; // vidéo inconnue plus vieille : épinglée / ressortie
const SEEN_CAP = 300; // IDs mémorisés (~10 mois à une vidéo par jour)
const MAX_SEND_ATTEMPTS = 3; // envois échoués avant d'abandonner une vidéo
const MAX_SOURCE_BACKOFF_MS = 30 * 60 * 1000;
const ALERT_AFTER_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MIN = 1;
const MAX_INTERVAL_MIN = 1440;
const SOURCE_LABEL = { embed: "la source directe TikTok (embed)", rss: "le flux RSS de secours" };

// ---------- Configuration (modifiable par le staff : panneau + dashboard) ----------

const DEFAULT_CONFIG = {
  enabled: false,
  account: "", // compte TikTok suivi, sans @ (source principale)
  feedUrl: "", // flux RSS de secours (optionnel)
  username: "", // nom affiché ({pseudo}). Vide = nom du profil TikTok, puis le compte.
  avatarUrl: "", // conservé pour compatibilité (non affiché)
  message: "", // phrase d'annonce ({pseudo}, {url}). Vide = phrase par défaut.
  showDate: true, // affiche l'heure de publication en pied de carte
  channelId: "",
  roleId: "", // rôle à ping (vide = pas de ping)
  pollIntervalMin: 2,
};
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

// Phrase d'annonce par defaut. {pseudo} est remplace par le nom affiche, {url} par le lien.
export const DEFAULT_TIKTOK_MESSAGE =
  "Nouvelle vidéo de {pseudo} va la voir tout de suite ! <:Emoji_Wow_Metadev:1513693924814880879>";

const CONFIG_KEY = "tiktok";
const STATE_KEY = "tiktokState";
let configDoc = null;
let stateDoc = null;

function configs() {
  if (!configDoc) {
    configDoc = loadDoc(CONFIG_KEY, { guilds: {} });
    if (!configDoc.guilds) configDoc.guilds = {};
  }
  return configDoc;
}

function states() {
  if (!stateDoc) {
    stateDoc = loadDoc(STATE_KEY, { guilds: {} });
    if (!stateDoc.guilds) stateDoc.guilds = {};
  }
  return stateDoc;
}

const saveConfigs = () => saveDoc(CONFIG_KEY, configs());
const saveStates = () => saveDoc(STATE_KEY, states());

// Objet stocké (mutable). Peut contenir des champs hérités de l'ancienne version.
function storedConfig(guildId) {
  const c = configs();
  c.guilds[guildId] = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  return c.guilds[guildId];
}

function pickConfig(stored) {
  const out = {};
  for (const k of CONFIG_KEYS) out[k] = stored[k];
  return out;
}

export async function getTikTokConfig(guildId) {
  getState(guildId); // déclenche la migration de l'ancien format si besoin
  return pickConfig(storedConfig(guildId));
}

const isSnowflakeOrEmpty = (v) => v === "" || /^\d{15,25}$/.test(v);

// Valide un patch de config : seules les clés de config passent (jamais l'état interne,
// même si le dashboard renvoie un objet complet périmé).
function sanitizeConfigPatch(patch) {
  const out = {};
  for (const k of CONFIG_KEYS) {
    if (!(k in (patch || {}))) continue;
    const v = patch[k];
    switch (k) {
      case "enabled":
      case "showDate":
        out[k] = Boolean(v);
        break;
      case "account": {
        const raw = String(v ?? "").trim();
        const h = normalizeHandle(raw);
        if (raw && !h) throw new Error("Compte TikTok invalide (ex : kayagoldforged, sans @).");
        out[k] = h;
        break;
      }
      case "feedUrl": {
        const s = String(v ?? "").trim();
        if (s && !/^https?:\/\/\S+$/i.test(s)) throw new Error("URL du flux RSS invalide (http(s)://...).");
        out[k] = s;
        break;
      }
      case "avatarUrl": {
        // Champ hérité, plus affiché dans l'interface : valeur invalide ignorée (pas d'erreur,
        // sinon un ancien réglage bloquerait tout enregistrement depuis le dashboard).
        const s = String(v ?? "").trim();
        if (!s || /^https?:\/\/\S+$/i.test(s)) out[k] = s;
        break;
      }
      case "username":
        out[k] = String(v ?? "").trim().replace(/^@+/, "").slice(0, 64);
        break;
      case "message":
        out[k] = String(v ?? "").slice(0, 1500);
        break;
      case "channelId":
      case "roleId": {
        const s = String(v ?? "").trim();
        if (isSnowflakeOrEmpty(s)) out[k] = s;
        break;
      }
      case "pollIntervalMin": {
        const n = Math.floor(Number(v));
        if (Number.isFinite(n)) out[k] = Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, n));
        break;
      }
    }
  }
  return out;
}

export async function setTikTokConfig(guildId, patch) {
  const st = getState(guildId);
  const g = storedConfig(guildId);
  const clean = sanitizeConfigPatch(patch);
  const before = { account: g.account, feedUrl: g.feedUrl, pollIntervalMin: g.pollIntervalMin, enabled: g.enabled };
  Object.assign(g, clean);
  saveConfigs();

  // Nouvelle source = nouvel amorçage silencieux (on ne reposte pas son historique).
  let touched = false;
  if ("account" in clean && clean.account !== before.account) {
    resetSource(st, "embed");
    st.profile = { nickname: "", avatarUrl: "" };
    touched = true;
  }
  if ("feedUrl" in clean && clean.feedUrl !== before.feedUrl) {
    resetSource(st, "rss");
    touched = true;
  }
  if (touched) saveStates();
  // Réactivation / changement de fréquence / de source : on revérifie au prochain tick.
  if (touched || g.pollIntervalMin !== before.pollIntervalMin || (g.enabled && !before.enabled)) {
    runtime(guildId).nextAt = 0;
  }
  return pickConfig(g);
}

// ---------- État interne (jamais exposé en écriture) ----------

const emptySource = () => ({ ok: null, at: "", error: "", count: 0, failures: 0, failingSince: 0, retryAt: 0, alerted: false });

function resetSource(st, name) {
  st.ready[name] = false;
  st.sources[name] = emptySource();
}

function getState(guildId) {
  const s = states();
  if (!s.guilds[guildId]) {
    s.guilds[guildId] = migrateLegacy(guildId);
    saveStates();
  }
  const st = s.guilds[guildId];
  st.seen ||= [];
  st.ready ||= { embed: false, rss: false };
  st.sources ||= {};
  st.sources.embed ||= emptySource();
  st.sources.rss ||= emptySource();
  st.profile ||= { nickname: "", avatarUrl: "" };
  return st;
}

// Première exécution de cette version : reprend ce qui est utile de l'ancien format.
function migrateLegacy(guildId) {
  const st = {
    seen: [],
    ready: { embed: false, rss: false },
    sources: { embed: emptySource(), rss: emptySource() },
    profile: { nickname: "", avatarUrl: "" },
    lastCheckAt: "",
    lastCheckError: "",
    lastSource: "",
    lastOkAt: "",
    lastPostAt: "",
    lastPostError: "",
    lastNote: "",
  };
  const raw = configs().guilds[guildId];
  if (!raw) return st;
  const g = storedConfig(guildId);
  if (g.lastItemId) st.seen.push(stableVideoId({ url: g.lastItemId, id: g.lastItemId }));
  // Compte déductible de l'URL du générateur GitHub (…/rss/<compte>.xml).
  if (!g.account) {
    const h = handleFromFeedUrl(g.feedUrl);
    if (h) {
      g.account = h;
      console.log(`TikTok : compte « ${h} » déduit du flux RSS (source directe activée).`);
    }
  }
  // L'ancien défaut (10 min) était calé sur un flux RSS lent ; la source directe permet 2 min.
  if (g.pollIntervalMin === 10) g.pollIntervalMin = DEFAULT_CONFIG.pollIntervalMin;
  saveConfigs();
  return st;
}

function addSeen(st, ids) {
  const set = new Set(st.seen);
  for (const id of ids) {
    if (!id || set.has(id)) continue;
    set.add(id);
    st.seen.push(id);
  }
  if (st.seen.length > SEEN_CAP) st.seen.splice(0, st.seen.length - SEEN_CAP);
}

/** État lisible pour le panneau / dashboard (copie). */
export async function getTikTokStatus(guildId) {
  const st = getState(guildId);
  const rt = runtime(guildId);
  return structuredClone({
    ...st,
    seen: undefined,
    seenCount: st.seen.length,
    nextPollAt: rt.nextAt ? new Date(rt.nextAt).toISOString() : "",
  });
}

// ---------- Décision : quoi publier (pur, testable) ----------

/**
 * À partir des items lus sur une source, décide quoi publier.
 * - source pas encore amorcée : on mémorise tout, on ne publie rien ;
 * - vidéo déjà vue : ignorée ;
 * - vidéo inconnue mais mise en ligne il y a plus de 30 j : épinglée ou ressortie, ignorée ;
 * - trop de nouveautés d'un coup : anomalie, on resynchronise sans publier.
 * @returns {{ seed: boolean, toPost: object[], markSeen: string[], anomaly: string }}
 *   toPost est trié du plus ancien au plus récent.
 */
export function planPost(items, { seen = [], ready = false, now = Date.now(), maxBatch = MAX_BATCH } = {}) {
  const valid = (items || []).filter((i) => i && i.videoId);
  if (!ready) return { seed: true, toPost: [], markSeen: valid.map((i) => i.videoId), anomaly: "" };

  const seenSet = seen instanceof Set ? seen : new Set(seen);
  const unique = new Set();
  const fresh = [];
  const markSeen = [];
  for (const it of valid) {
    if (seenSet.has(it.videoId) || unique.has(it.videoId)) continue;
    unique.add(it.videoId);
    const born = it.uploadTs || it.ts || 0;
    if (born && now - born > MAX_UPLOAD_AGE_MS) {
      markSeen.push(it.videoId);
      continue;
    }
    fresh.push(it);
  }
  if (fresh.length > maxBatch) {
    return {
      seed: false,
      toPost: [],
      markSeen: [...markSeen, ...fresh.map((i) => i.videoId)],
      anomaly: `${fresh.length} vidéos inconnues d'un coup : resynchronisation sans publier`,
    };
  }
  fresh.sort((a, b) => byNewest(b, a));
  return { seed: false, toPost: fresh, markSeen, anomaly: "" };
}

// ---------- Lecture des sources (avec pause progressive) ----------

function sourcePlan(cfg) {
  const plan = [];
  if (cfg.account) plan.push(["embed", () => fetchEmbedItems(cfg.account)]);
  if (cfg.feedUrl) plan.push(["rss", async () => ({ items: await fetchFeedItems(cfg.feedUrl), profile: null })]);
  return plan;
}

function markOk(s, count, now) {
  Object.assign(s, { ok: true, at: new Date(now).toISOString(), error: "", count, failures: 0, failingSince: 0, retryAt: 0 });
}

function markFail(s, err, intervalMs, now) {
  s.ok = false;
  s.at = new Date(now).toISOString();
  s.error = String(err?.message || err).slice(0, 300);
  s.failures = (s.failures || 0) + 1;
  s.failingSince ||= now;
  // Pause progressive : 1, 2, 4, 8... intervalles, plafonnée à 30 min. Si TikTok limite
  // (403/429), on part d'au moins 5 min pour ne pas aggraver le blocage ; si la config est
  // fausse (compte inexistant...), inutile d'insister : 30 min directement.
  const fatal = err instanceof SourceError && err.fatal;
  const limited = err instanceof SourceError && (err.status === 403 || err.status === 429);
  const step = limited ? Math.max(intervalMs, 5 * 60_000) : intervalMs;
  const wait = fatal ? MAX_SOURCE_BACKOFF_MS : Math.min(step * 2 ** (s.failures - 1), MAX_SOURCE_BACKOFF_MS);
  s.retryAt = s.failures > 1 || fatal || limited ? now + wait : 0;
}

async function readOne(name, run, st, intervalMs, now) {
  const s = st.sources[name];
  try {
    const r = await run();
    if (!r.items.length) throw new SourceError("aucune vidéo publique visible");
    markOk(s, r.items.length, now);
    return r;
  } catch (err) {
    markFail(s, err, intervalMs, now);
    return null;
  }
}

/** Essaie les sources dans l'ordre (embed puis RSS) et renvoie la première qui répond. */
async function readSources(cfg, st, { ignoreBackoff = false, now = Date.now() } = {}) {
  const intervalMs = cfg.pollIntervalMin * 60_000;
  let attempted = 0;
  for (const [name, run] of sourcePlan(cfg)) {
    const s = st.sources[name];
    if (!ignoreBackoff && s.retryAt && now < s.retryAt) continue;
    attempted++;
    const r = await readOne(name, run, st, intervalMs, now);
    if (r) return { source: name, items: r.items, profile: r.profile, attempted };
  }
  return { source: null, items: null, profile: null, attempted };
}

function sourceErrors(cfg, st) {
  return sourcePlan(cfg)
    .filter(([name]) => st.sources[name].ok === false)
    .map(([name]) => `${name === "embed" ? "embed" : "RSS"} : ${st.sources[name].error}`)
    .join(" · ");
}

// Alerte (une fois) si une source reste illisible plus d'1 h, puis message de rétablissement.
function evaluateAlerts(cfg, st, notify, now) {
  if (typeof notify !== "function") return;
  const who = cfg.account ? `@${cfg.account}` : "le compte suivi";
  const plan = sourcePlan(cfg).map(([n]) => n);
  const anyOk = plan.some((n) => st.sources[n].ok === true);
  for (const name of plan) {
    const s = st.sources[name];
    if (s.ok === false && s.failingSince && now - s.failingSince >= ALERT_AFTER_MS && !s.alerted) {
      s.alerted = true;
      notify(
        `⚠️ **TikTok** — ${SOURCE_LABEL[name]} est illisible depuis plus d'1 h pour ${who} : ${s.error}.` +
          (anyOk
            ? " Le bot se rabat sur l'autre source (notifications possiblement plus lentes)."
            : " **Aucune notification TikTok ne part** tant que ce n'est pas rétabli. Vérifie `/setup-tiktok`."),
      );
    } else if (s.ok === true && s.alerted) {
      s.alerted = false;
      notify(`✅ **TikTok** — ${SOURCE_LABEL[name]} est de nouveau lisible.`);
    }
  }
}

// ---------- Poll : détecte et poste les nouvelles vidéos ----------

const locks = new Map(); // guildId -> Promise (un seul passage à la fois par serveur)
const sendFailures = new Map(); // videoId -> nb d'envois échoués
const runtimes = new Map(); // guildId -> { nextAt }

function runtime(guildId) {
  if (!runtimes.has(guildId)) runtimes.set(guildId, { nextAt: 0 });
  return runtimes.get(guildId);
}

function withLock(guildId, fn) {
  if (locks.has(guildId)) return Promise.resolve({ posted: 0, skipped: "busy" });
  const p = (async () => {
    try {
      return await fn();
    } finally {
      locks.delete(guildId);
    }
  })();
  locks.set(guildId, p);
  return p;
}

export function pollGuild(client, guildId, opts = {}) {
  return withLock(guildId, () => doPoll(client, guildId, opts));
}

async function doPoll(client, guildId, { notify, now = Date.now() } = {}) {
  const cfg = await getTikTokConfig(guildId);
  if (!cfg.enabled || !cfg.channelId || (!cfg.account && !cfg.feedUrl)) return { posted: 0, skipped: "config" };
  const st = getState(guildId);

  const read = await readSources(cfg, st, { now });
  if (!read.attempted) return { posted: 0, skipped: "backoff" };
  st.lastCheckAt = new Date(now).toISOString();

  if (!read.items) {
    st.lastCheckError = sourceErrors(cfg, st) || "aucune source lisible";
    evaluateAlerts(cfg, st, notify, now);
    saveStates();
    return { posted: 0, error: st.lastCheckError };
  }

  st.lastCheckError = "";
  st.lastSource = read.source;
  st.lastOkAt = st.lastCheckAt;
  if (read.profile) st.profile = { nickname: read.profile.nickname || "", avatarUrl: read.profile.avatarUrl || "" };

  // Flux RSS seul configuré : on en déduit le compte pour activer la source directe.
  if (!cfg.account && read.source === "rss") {
    const h = handleFromItems(read.items);
    if (h) {
      storedConfig(guildId).account = h;
      saveConfigs();
      console.log(`TikTok : compte « ${h} » déduit du flux RSS (source directe activée).`);
    }
  }

  // Décision prise AVANT l'amorçage de la source de secours ci-dessous, pour qu'une vidéo
  // présente dans les deux ne soit pas absorbée silencieusement par cet amorçage.
  const plan = planPost(read.items, { seen: st.seen, ready: st.ready[read.source], now });

  // Source de secours jamais lue : on l'amorce maintenant (1 requête, une seule fois), pour
  // qu'un futur repli ne publie que les vraies nouveautés au lieu de tout ignorer.
  for (const [name, run] of sourcePlan(cfg)) {
    if (name === read.source || st.ready[name]) continue;
    const s = st.sources[name];
    if (s.retryAt && now < s.retryAt) continue;
    const r = await readOne(name, run, st, cfg.pollIntervalMin * 60_000, now);
    if (r) {
      const pending = new Set(plan.toPost.map((i) => i.videoId));
      addSeen(st, r.items.map((i) => i.videoId).filter((id) => !pending.has(id)));
      st.ready[name] = true;
    }
  }
  evaluateAlerts(cfg, st, notify, now);

  addSeen(st, plan.markSeen);
  if (plan.seed) {
    st.ready[read.source] = true;
    saveStates();
    console.log(`TikTok : ${SOURCE_LABEL[read.source]} amorcée (${plan.markSeen.length} vidéo(s) mémorisée(s), rien publié).`);
    return { posted: 0, seeded: plan.markSeen.length };
  }
  if (plan.anomaly) {
    st.lastNote = `${new Date(now).toISOString()} — ${plan.anomaly}`;
    saveStates();
    console.warn(`TikTok : ${plan.anomaly}.`);
    return { posted: 0, anomaly: plan.anomaly };
  }
  if (!plan.toPost.length) {
    saveStates();
    return { posted: 0 };
  }

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    st.lastPostError = "Salon introuvable ou non textuel.";
    saveStates();
    return { posted: 0, error: st.lastPostError };
  }

  // Un seul message : la plus récente en carte, les autres (même passage) en liens.
  const main = plan.toPost[plan.toPost.length - 1];
  const others = plan.toPost.slice(0, -1).reverse();
  const ids = plan.toPost.map((i) => i.videoId);
  // Détectée à ce passage = publiée il y a au plus un intervalle (l'embed ne donne pas l'heure).
  const shown = { ...main, date: main.date || new Date(now).toISOString() };
  try {
    await channel.send(await buildNotification(cfg, st, shown, { others }));
    addSeen(st, ids);
    ids.forEach((id) => sendFailures.delete(id));
    st.lastPostAt = new Date(now).toISOString();
    st.lastPostError = "";
    saveStates();
    return { posted: ids.length };
  } catch (err) {
    const n = (sendFailures.get(main.videoId) || 0) + 1;
    sendFailures.set(main.videoId, n);
    st.lastPostError = `Envoi impossible (permissions du salon ?) : ${err.message}`;
    if (n >= MAX_SEND_ATTEMPTS) {
      // On abandonne cette vidéo pour ne pas la poster des heures plus tard.
      addSeen(st, ids);
      ids.forEach((id) => sendFailures.delete(id));
      console.warn(`TikTok : envoi abandonné après ${n} essais : ${err.message}`);
    }
    saveStates();
    return { posted: 0, error: st.lastPostError };
  }
}

/**
 * À appeler toutes les ~30 s : lance un passage quand l'intervalle configuré est écoulé
 * (avec un léger aléa pour ne pas taper TikTok à heure fixe).
 */
export async function tickTikTok(client, guildId, { notify } = {}) {
  const cfg = await getTikTokConfig(guildId);
  if (!cfg.enabled) return { skipped: "disabled" };
  const rt = runtime(guildId);
  if (Date.now() < rt.nextAt) return { skipped: "wait" };
  const base = cfg.pollIntervalMin * 60_000;
  rt.nextAt = Date.now() + base * (0.9 + Math.random() * 0.2);
  const r = await pollGuild(client, guildId, { notify });
  if (r.posted) console.log(`TikTok : ${r.posted} nouvelle(s) vidéo(s) annoncée(s).`);
  return r;
}

// ---------- Diagnostic & test ----------

/** Lit chaque source configurée indépendamment (sans toucher à l'état). */
export async function checkTikTokSources(cfgLike) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgLike };
  const out = [];
  for (const [name, run] of sourcePlan(cfg)) {
    const t0 = Date.now();
    try {
      const r = await run();
      const latest = [...r.items].sort(byNewest)[0] || null;
      out.push({ source: name, ok: r.items.length > 0, count: r.items.length, latest, profile: r.profile, ms: Date.now() - t0, error: r.items.length ? "" : "aucune vidéo publique visible" });
    } catch (err) {
      out.push({ source: name, ok: false, count: 0, latest: null, profile: null, ms: Date.now() - t0, error: err.message, fatal: Boolean(err.fatal) });
    }
  }
  return out;
}

// Poste la dernière publication (bouton Test). Ne modifie pas la liste des vidéos vues.
export async function postTest(client, guildId) {
  const cfg = await getTikTokConfig(guildId);
  if (!cfg.account && !cfg.feedUrl) return { ok: false, reason: "Aucun compte TikTok ni flux RSS défini." };
  if (!cfg.channelId) return { ok: false, reason: "Aucun salon défini." };

  const st = getState(guildId);
  const read = await readSources(cfg, st, { ignoreBackoff: true });
  if (read.profile) st.profile = { nickname: read.profile.nickname || "", avatarUrl: read.profile.avatarUrl || "" };
  saveStates();
  if (!read.items) return { ok: false, reason: `Lecture impossible — ${sourceErrors(cfg, st) || "aucune source lisible"}` };

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, reason: "Salon introuvable ou non textuel." };

  const item = read.items[0];
  try {
    await channel.send(await buildNotification(cfg, st, item, { test: true }));
  } catch (err) {
    return { ok: false, reason: `Envoi impossible (permissions du salon ?) : ${err.message}` };
  }
  return { ok: true, item, source: read.source };
}

// ---------- Message posté dans le salon ----------

// Normalise vers une URL TikTok canonique (clic = ouvre la vraie page TikTok).
function canonicalUrl(url) {
  return String(url || "").replace(/^https?:\/\/(?:www\.|vm\.|m\.)?tiktok\.com/i, "https://www.tiktok.com");
}

// Repli si la miniature n'a pas pu être téléchargée : recadrage 9:16 via le CDN wsrv.nl.
function cropImage(url) {
  if (!url) return "";
  return "https://wsrv.nl/?url=" + encodeURIComponent(url) + "&w=720&h=1280&fit=cover&a=center&output=jpg";
}

const IMG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Télécharge la miniature et la renvoie en 9:16 (recadrage centré si besoin).
 * Jointe au message, elle est hébergée par Discord : les liens de miniature TikTok sont
 * signés et expirent en ~2 jours, ce qui cassait l'image des anciennes notifications.
 */
async function prepareCover(url, videoId) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": IMG_UA, Referer: "https://www.tiktok.com/" },
      signal: AbortSignal.timeout(10_000),
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;

    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    const name = `tiktok-${String(videoId || "video").replace(/[^\w-]/g, "")}`;
    if (Math.abs(img.width / img.height - 9 / 16) < 0.02 && /jpe?g|png|webp/i.test(type)) {
      const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : "jpg";
      return { buffer: buf, name: `${name}.${ext}` };
    }
    const H = Math.min(1280, img.height);
    const W = Math.round((H * 9) / 16);
    const canvas = createCanvas(W, H);
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    canvas.getContext("2d").drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return { buffer: await canvas.encode("jpeg", 88), name: `${name}.jpg` };
  } catch {
    return null; // best-effort : repli sur l'URL
  }
}

async function buildNotification(cfg, st, item, { others = [], test = false } = {}) {
  const cover = await prepareCover(item.image, item.videoId);
  const payload = buildMessagePayload(cfg, item, {
    test,
    others,
    displayName: st?.profile?.nickname || "",
    imageUrl: cover ? `attachment://${cover.name}` : undefined,
  });
  if (cover) payload.files = [new AttachmentBuilder(cover.buffer, { name: cover.name })];
  return payload;
}

const shortTitle = (s, max = 60) => {
  const t = String(s || "").replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

/**
 * Construit le message (Components V2) : ligne d'annonce (+ping) puis carte TikTok avec
 * légende, miniature 9:16, pied « TikTok • date », liens des autres nouveautés et bouton.
 * Pur (aucun I/O) : `imageUrl` permet de pointer une pièce jointe (attachment://...).
 */
export function buildMessagePayload(cfg, item, { test = false, others = [], displayName = "", imageUrl } = {}) {
  const ping = cfg.roleId ? `<@&${cfg.roleId}>` : "";
  const who = String(cfg.username || "").replace(/^@+/, "") || displayName || cfg.account || "le compte suivi";
  const videoUrl = canonicalUrl(item.url);

  // Phrase d'annonce : modele configurable ({pseudo} / {url}), sinon phrase par defaut.
  const template = cfg.message && cfg.message.trim() ? cfg.message : DEFAULT_TIKTOK_MESSAGE;
  const intro = template.replace(/\{pseudo\}/gi, who).replace(/\{url\}/gi, videoUrl).trim();

  // Légende séparée des hashtags pour un rendu propre.
  const caption = String(item.title || "").replace(/\s+/g, " ").trim();
  const tags = (caption.match(/#[^\s#]+/g) || []).join(" ");
  let captionText = caption.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (captionText.length > 280) captionText = captionText.slice(0, 277).trimEnd() + "…";

  const firstLine = test ? `${ping} 🧪 **Test** — ${intro}`.trim() : `${ping} ${intro}`.trim();

  const container = new ContainerBuilder().setAccentColor(0xfe2c55);

  if (captionText) {
    const safe = captionText.replace(/[[\]]/g, ""); // évite de casser le lien markdown
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> [${safe}](${videoUrl})`));
  }
  const media = imageUrl || (item.image ? cropImage(item.image) : "");
  if (media) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(media)));
  }

  // Pied : "📱 TikTok • <date>" + hashtags, en sous-texte.
  const footParts = ["📱 **TikTok**"];
  if (cfg.showDate !== false && item.date) {
    const d = new Date(item.date);
    if (!Number.isNaN(d.getTime())) footParts.push(`<t:${Math.floor(d.getTime() / 1000)}:f>`);
  }
  let footer = `-# ${footParts.join(" • ")}`;
  if (tags) footer += `\n-# ${tags.slice(0, 500)}`;
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  // Plusieurs vidéos au même passage : un seul message, les autres en liens (pas de rafale).
  const extra = (others || []).filter((o) => o?.url).slice(0, MAX_BATCH);
  if (extra.length) {
    const links = extra.map((o) => `[${shortTitle(o.title) || "vidéo"}](${canonicalUrl(o.url)})`).join(" · ");
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# 📚 Aussi publiée${extra.length > 1 ? "s" : ""} : ${links}`),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Voir sur TikTok").setEmoji("▶️").setURL(videoUrl),
    ),
  );

  return {
    components: [new TextDisplayBuilder().setContent(firstLine), container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] },
  };
}
