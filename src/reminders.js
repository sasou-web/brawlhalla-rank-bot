import { loadDoc, saveDoc } from "./db.js";

const KEY = "reminders";

/**
 * Rappels automatiques : le bot poste, à intervalle régulier, un message d'une liste
 * dans un salon choisi (pour rappeler aux membres comment marche le serveur : vocaux
 * privés, règles, liens utiles...).
 *
 * Structure : { guilds: { [guildId]: {
 *   enabled,                 // les rappels sont-ils actifs ?
 *   channelId,               // salon où poster
 *   intervalMinutes,         // délai entre deux rappels
 *   mode,                    // "rotate" (à la suite) ou "random" (aléatoire)
 *   messages: [string],      // liste des messages/rappels
 *   _idx,                    // pointeur de rotation (interne)
 *   _lastTs                  // timestamp du dernier envoi (interne)
 * } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelId: "",
  intervalMinutes: 120,
  mode: "rotate",
  messages: [],
  _idx: 0,
  _lastTs: 0,
};

// Champs internes non exposés au dashboard (gérés par le scheduler).
const INTERNAL = ["_idx", "_lastTs"];

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function doWrite() {
  saveDoc(KEY, cache);
}

function save() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

async function getGuild(guildId) {
  const c = await load();
  const g = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  if (!Array.isArray(g.messages)) g.messages = [];
  c.guilds[guildId] = g;
  return g;
}

// Normalise la config venant du dashboard (longueurs, bornes, mode valide).
function normalizePatch(patch) {
  const out = { ...patch };
  if ("messages" in out) {
    out.messages = (Array.isArray(out.messages) ? out.messages : [])
      .map((m) => String(m || "").slice(0, 2000))
      .filter((m) => m.trim())
      .slice(0, 25);
  }
  if ("intervalMinutes" in out) {
    out.intervalMinutes = Math.min(10080, Math.max(1, Number(out.intervalMinutes) || 120));
  }
  if ("mode" in out && out.mode !== "random") out.mode = "rotate";
  return out;
}

/** Config exposée au dashboard (sans les champs internes). */
export async function getRemindersConfig(guildId) {
  const g = await getGuild(guildId);
  const config = { ...g };
  for (const k of INTERNAL) delete config[k];
  return config;
}

export async function setRemindersConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, normalizePatch(patch || {}));
  await save();
  return getRemindersConfig(guildId);
}

// Choisit le prochain message à envoyer et fait avancer le pointeur de rotation.
function pickMessage(g) {
  const msgs = g.messages.filter((m) => m && m.trim());
  if (!msgs.length) return null;
  if (g.mode === "random") {
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  const idx = ((g._idx || 0) % msgs.length + msgs.length) % msgs.length;
  g._idx = idx + 1;
  return msgs[idx];
}

async function postMessage(client, guildId, content) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const g = await getGuild(guildId);
  const ch = g.channelId ? await guild.channels.fetch(g.channelId).catch(() => null) : null;
  if (!ch?.isTextBased?.()) return false;
  // Pas de mentions automatiques : un rappel ne doit jamais ping en masse.
  await ch.send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
  return true;
}

/**
 * Appelé périodiquement (toutes les minutes) par index.js. Envoie le prochain rappel
 * si l'intervalle configuré est écoulé. Best-effort : n'interrompt jamais le bot.
 */
export async function tickReminders(client, guildId) {
  try {
    const g = await getGuild(guildId);
    if (!g.enabled || !g.channelId || !g.messages.some((m) => m && m.trim())) return;
    const now = Date.now();
    const intervalMs = Math.max(1, g.intervalMinutes || 120) * 60_000;
    if (g._lastTs && now - g._lastTs < intervalMs) return;

    const content = pickMessage(g);
    g._lastTs = now;
    await save();
    if (content) await postMessage(client, guildId, content);
  } catch {
    /* best-effort : on réessaiera au prochain tick */
  }
}

/**
 * Envoi immédiat (bouton « Tester » du dashboard). Poste le prochain message sans
 * toucher au minuteur normal. Retourne { ok } ou { ok:false, reason }.
 */
export async function sendReminderNow(client, guildId) {
  const g = await getGuild(guildId);
  if (!g.channelId) return { ok: false, reason: "Aucun salon de rappel défini." };
  if (!g.messages.some((m) => m && m.trim())) return { ok: false, reason: "Aucun message à envoyer." };
  const content = pickMessage(g);
  await save(); // persiste l'avancée du pointeur de rotation
  const ok = await postMessage(client, guildId, content);
  return ok ? { ok: true } : { ok: false, reason: "Salon introuvable ou non textuel." };
}
