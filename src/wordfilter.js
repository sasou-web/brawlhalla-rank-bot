import { PermissionFlagsBits } from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import { compileFilter, findMatches, maskText, matchedTerms, termKey } from "./wordfilterEngine.js";

/**
 * Filtre de mots : supprime (ou masque) les messages contenant un terme interdit.
 * La détection est dans wordfilterEngine.js (pur, testable) ; ce module applique les
 * actions sur Discord et tient l'historique.
 *
 * Config (kv.wordfilter, modifiable par le staff via le dashboard) :
 *   { guilds: { [guildId]: { enabled, words, allowed, evasion, ignoreLinks, checkEdits,
 *     action, warnMode, warnMessage, warnDeleteSec, ignoreStaff, exemptRoleIds,
 *     exemptChannelIds, logChannelId, timeoutEnabled, timeoutAfter, timeoutWindowMin,
 *     timeoutMinutes } } }
 * État (kv.wordfilterState, jamais modifiable par le dashboard sauf « effacer l'historique ») :
 *   { guilds: { [guildId]: { total, log: [...], strikes: { [userId]: [ts...] } } } }
 *
 * Actions :
 *   delete : le message est supprimé ;
 *   mask   : supprimé puis republié à l'identique (pseudo + avatar, via un webhook) avec
 *            les termes masqués. Repli sur « delete » si le webhook est impossible ;
 *   flag   : rien n'est supprimé, le message est seulement signalé au journal.
 * Tout est best-effort : une permission manquante n'interrompt jamais le bot.
 */

const CONFIG_KEY = "wordfilter";
const STATE_KEY = "wordfilterState";
const LOG_CAP = 300;
const MAX_WORDS = 1000;
const MAX_ALLOWED = 500;
const MAX_TERM_LENGTH = 100;
const MAX_REPOST_FILES_BYTES = 8 * 1024 * 1024;
const WEBHOOK_NAME = "XK Filtre";

export const DEFAULT_WARN_MESSAGE = "{user}, ton message a été retiré : il contient un terme interdit sur ce serveur.";

const DEFAULT_CONFIG = {
  enabled: false,
  words: [],
  allowed: [],
  evasion: true,
  ignoreLinks: true,
  checkEdits: true,
  action: "delete", // delete | mask | flag
  warnMode: "channel", // channel | dm | off
  warnMessage: DEFAULT_WARN_MESSAGE,
  warnDeleteSec: 8,
  ignoreStaff: true,
  exemptRoleIds: [],
  exemptChannelIds: [],
  logChannelId: "",
  timeoutEnabled: false,
  timeoutAfter: 3,
  timeoutWindowMin: 10,
  timeoutMinutes: 10,
};
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
const ACTIONS = new Set(["delete", "mask", "flag"]);
const WARN_MODES = new Set(["channel", "dm", "off"]);

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

function guildConfig(guildId) {
  const c = configs();
  c.guilds[guildId] = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  return c.guilds[guildId];
}

function guildState(guildId) {
  const s = states();
  const st = (s.guilds[guildId] ||= {});
  st.total ||= 0;
  st.log ||= [];
  st.strikes ||= {};
  return st;
}

export async function getWordFilterConfig(guildId) {
  const g = guildConfig(guildId);
  const out = {};
  for (const k of CONFIG_KEYS) out[k] = Array.isArray(g[k]) ? [...g[k]] : g[k];
  return out;
}

// ---------- Validation des modifications ----------

const isSnowflake = (v) => /^\d{15,25}$/.test(v);
const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Liste de termes : nettoyée, bornée, dédoublonnée (enculé / ENCULE = même terme).
function cleanTerms(list, max) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TERM_LENGTH);
    const key = termKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizePatch(patch) {
  const out = {};
  const g = DEFAULT_CONFIG;
  for (const k of CONFIG_KEYS) {
    if (!(k in (patch || {}))) continue;
    const v = patch[k];
    switch (k) {
      case "enabled":
      case "evasion":
      case "ignoreLinks":
      case "checkEdits":
      case "ignoreStaff":
      case "timeoutEnabled":
        out[k] = Boolean(v);
        break;
      case "words":
        out[k] = cleanTerms(v, MAX_WORDS);
        break;
      case "allowed":
        out[k] = cleanTerms(v, MAX_ALLOWED);
        break;
      case "action":
        if (ACTIONS.has(v)) out[k] = v;
        break;
      case "warnMode":
        if (WARN_MODES.has(v)) out[k] = v;
        break;
      case "warnMessage":
        out[k] = String(v ?? "").slice(0, 500);
        break;
      case "warnDeleteSec":
        out[k] = clampInt(v, 0, 120, g.warnDeleteSec);
        break;
      case "timeoutAfter":
        out[k] = clampInt(v, 1, 20, g.timeoutAfter);
        break;
      case "timeoutWindowMin":
        out[k] = clampInt(v, 1, 1440, g.timeoutWindowMin);
        break;
      case "timeoutMinutes":
        out[k] = clampInt(v, 1, 40320, g.timeoutMinutes); // 28 jours = maximum Discord
        break;
      case "logChannelId": {
        const s = String(v ?? "").trim();
        if (s === "" || isSnowflake(s)) out[k] = s;
        break;
      }
      case "exemptRoleIds":
      case "exemptChannelIds":
        out[k] = [...new Set((Array.isArray(v) ? v : []).map(String).filter(isSnowflake))].slice(0, 100);
        break;
    }
  }
  return out;
}

export async function setWordFilterConfig(guildId, patch) {
  Object.assign(guildConfig(guildId), sanitizePatch(patch));
  saveDoc(CONFIG_KEY, configs());
  return getWordFilterConfig(guildId);
}

// ---------- Détection (cache des termes compilés) ----------

const compiledCache = new Map(); // guildId -> { key, filter }

function filterFor(guildId, cfg) {
  const key = JSON.stringify([cfg.words, cfg.allowed, cfg.evasion, cfg.ignoreLinks]);
  const hit = compiledCache.get(guildId);
  if (hit && hit.key === key) return hit.filter;
  const filter = compileFilter(cfg);
  compiledCache.set(guildId, { key, filter });
  return filter;
}

/**
 * Testeur du dashboard : analyse un texte avec une configuration (éventuellement non
 * enregistrée). Aucun effet sur Discord.
 */
export function checkWordFilterText(text, cfgLike = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgLike };
  const filter = compileFilter({
    words: cleanTerms(cfg.words, MAX_WORDS),
    allowed: cleanTerms(cfg.allowed, MAX_ALLOWED),
    evasion: cfg.evasion,
    ignoreLinks: cfg.ignoreLinks,
  });
  const src = String(text ?? "").slice(0, 2000);
  const matches = findMatches(src, filter);
  return { matches, terms: matchedTerms(matches), masked: maskText(src, matches) };
}

// ---------- Exemptions ----------

function isExempt(message, cfg) {
  const ch = message.channel;
  const ids = [ch?.id, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  if (ids.some((id) => cfg.exemptChannelIds.includes(id))) return true;
  const member = message.member;
  if (!member) return false;
  if (cfg.ignoreStaff && member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  return member.roles?.cache?.some((r) => cfg.exemptRoleIds.includes(r.id)) || false;
}

// ---------- Actions ----------

const webhooks = new Map(); // channelId -> Webhook

async function webhookFor(channel) {
  const target = channel.isThread?.() ? channel.parent : channel;
  if (!target?.fetchWebhooks) return null;
  if (webhooks.has(target.id)) return webhooks.get(target.id);
  const botId = channel.client.user.id;
  const hooks = await target.fetchWebhooks();
  let hook = hooks.find((h) => h.owner?.id === botId && h.name === WEBHOOK_NAME);
  if (!hook) hook = await target.createWebhook({ name: WEBHOOK_NAME, reason: "Filtre de mots : republication des messages masqués" });
  webhooks.set(target.id, hook);
  return hook;
}

// Pièces jointes téléchargées AVANT la suppression (leurs liens meurent avec le message).
async function downloadAttachments(message) {
  const atts = [...(message.attachments?.values?.() || [])];
  if (!atts.length) return [];
  const total = atts.reduce((a, x) => a + (x.size || 0), 0);
  if (total > MAX_REPOST_FILES_BYTES) return null;
  const files = [];
  for (const a of atts) {
    const res = await fetch(a.url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    files.push({ attachment: Buffer.from(await res.arrayBuffer()), name: a.name || "fichier" });
  }
  return files;
}

// Discord refuse ces mots dans le nom d'un webhook.
function webhookName(member, user) {
  const n = String(member?.displayName || user?.globalName || user?.username || "Membre").slice(0, 80);
  return /discord|clyde/i.test(n) ? "Membre" : n;
}

async function repostMasked(message, content, files) {
  const hook = await webhookFor(message.channel);
  if (!hook) return false;
  const text = content.length > 2000 ? content.slice(0, 1999) + "…" : content;
  await hook.send({
    content: text,
    username: webhookName(message.member, message.author),
    avatarURL: (message.member || message.author).displayAvatarURL?.({ size: 128 }),
    files: files || [],
    allowedMentions: { parse: [] },
    threadId: message.channel.isThread?.() ? message.channel.id : undefined,
  });
  return true;
}

function fill(template, message) {
  return String(template || DEFAULT_WARN_MESSAGE)
    .replace(/\{user\}/gi, `<@${message.author.id}>`)
    .replace(/\{username\}/gi, message.member?.displayName || message.author.username)
    .replace(/\{server\}/gi, message.guild.name)
    .replace(/\{channel\}/gi, `<#${message.channel.id}>`);
}

async function warnAuthor(message, cfg) {
  if (cfg.warnMode === "off") return;
  const content = fill(cfg.warnMessage, message);
  if (cfg.warnMode === "dm") {
    // En privé : pas de mention, et le nom du serveur pour situer le message.
    const name = message.member?.displayName || message.author.username;
    const dm = `**${message.guild.name}** · ${content.split(`<@${message.author.id}>`).join(name)}`;
    await message.author.send({ content: dm, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  const notice = await message.channel.send({ content, allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (notice && cfg.warnDeleteSec > 0) setTimeout(() => notice.delete().catch(() => {}), cfg.warnDeleteSec * 1000);
}

// Infractions récentes : exclusion temporaire quand le seuil est atteint dans la fenêtre.
async function maybeTimeout(message, cfg, st, now) {
  if (!cfg.timeoutEnabled) return false;
  const uid = message.author.id;
  const windowMs = cfg.timeoutWindowMin * 60_000;
  const list = (st.strikes[uid] || []).filter((t) => now - t < windowMs);
  list.push(now);
  st.strikes[uid] = list;
  // Ménage : on ne garde que les membres ayant des infractions récentes.
  for (const [k, v] of Object.entries(st.strikes)) if (!v.some((t) => now - t < windowMs)) delete st.strikes[k];
  if (list.length < cfg.timeoutAfter) return false;
  const member = message.member;
  if (!member?.moderatable) {
    console.warn(`Filtre de mots : exclusion impossible pour ${message.author.tag} (rôle trop haut ou permission « Exclure temporairement » manquante).`);
    return false;
  }
  const reason = `Filtre de mots : ${list.length} infractions en ${cfg.timeoutWindowMin} min`;
  const ok = await member.timeout(cfg.timeoutMinutes * 60_000, reason).then(() => true).catch(() => false);
  if (ok) delete st.strikes[uid];
  return ok;
}

const ACTION_LABEL = { delete: "supprimé", mask: "masqué", flag: "signalé", failed: "non supprimé (permission manquante)" };

async function postLog(message, cfg, entry) {
  if (!cfg.logChannelId) return;
  const ch = await message.client.channels.fetch(cfg.logChannelId).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  const original = String(message.content || "").replace(/\|/g, "∣").slice(0, 1000);
  const lines = [`**Message ${ACTION_LABEL[entry.action] || entry.action}** dans <#${message.channel.id}>${entry.edited ? " (après modification)" : ""}`, `||${original}||`];
  if (entry.timeout) lines.push(`⏳ Exclu ${cfg.timeoutMinutes} min (infractions répétées).`);
  await ch
    .send({
      embeds: [
        {
          color: entry.action === "flag" ? 0xd6a13b : 0xe5534b,
          author: { name: `${message.author.tag}`, icon_url: message.author.displayAvatarURL?.({ size: 64 }) },
          description: lines.join("\n"),
          fields: [{ name: "Termes", value: entry.terms.map((t) => `\`${t.replace(/`/g, "'")}\``).join(", ").slice(0, 1000) || "—" }],
          footer: { text: `Membre ${message.author.id}` },
          timestamp: new Date(entry.ts).toISOString(),
        },
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
}

/**
 * À appeler pour chaque message (créé ou modifié). Renvoie true si le message a été
 * retiré : l'appelant ne doit alors plus le traiter (XP, clips…).
 */
export async function handleWordFilter(message, { edited = false } = {}) {
  if (!message.guild || message.author?.bot || message.webhookId || !message.content) return false;
  const cfg = guildConfig(message.guild.id);
  if (!cfg.enabled || !cfg.words.length) return false;
  if (edited && !cfg.checkEdits) return false;
  if (isExempt(message, cfg)) return false;

  const matches = findMatches(message.content, filterFor(message.guild.id, cfg));
  if (!matches.length) return false;

  const now = Date.now();
  const terms = matchedTerms(matches);
  let action = cfg.action;

  if (action !== "flag") {
    const files = action === "mask" ? await downloadAttachments(message).catch(() => null) : [];
    if (action === "mask" && files === null) action = "delete"; // pièces jointes trop lourdes
    const deleted = await message.delete().then(() => true).catch(() => false);
    if (!deleted) action = "failed";
    else if (action === "mask") {
      const masked = maskText(message.content, matches, { char: "\\*" });
      const ok = await repostMasked(message, masked, files).catch(() => false);
      if (!ok) action = "delete";
    }
  }

  const st = guildState(message.guild.id);
  const removed = action === "delete" || action === "mask";
  const timeout = removed ? await maybeTimeout(message, cfg, st, now) : false;
  const entry = {
    ts: now,
    userId: message.author.id,
    userName: message.member?.displayName || message.author.username,
    channelId: message.channel.id,
    terms: terms.slice(0, 5),
    action,
    edited,
    timeout,
    excerpt: maskText(message.content, matches).replace(/\s+/g, " ").slice(0, 180),
  };
  st.total += 1;
  st.log.push(entry);
  if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
  saveDoc(STATE_KEY, states());

  if (removed) warnAuthor(message, cfg).catch(() => {});
  postLog(message, cfg, entry).catch(() => {});
  console.log(`Filtre de mots : message de ${message.author.tag} ${ACTION_LABEL[action]} dans #${message.channel.name} (${terms.join(", ")})${timeout ? ", membre exclu temporairement" : ""}.`);
  return removed;
}

// ---------- Dashboard ----------

/** Statistiques et historique récent (lecture seule). */
export async function getWordFilterStatus(guildId) {
  const st = guildState(guildId);
  const now = Date.now();
  const since = (ms) => st.log.filter((e) => now - e.ts < ms).length;
  return {
    total: st.total,
    last24h: since(86_400_000),
    last7d: since(7 * 86_400_000),
    lastTs: st.log.length ? st.log[st.log.length - 1].ts : 0,
    recent: st.log.slice(-100).reverse(),
  };
}

export async function clearWordFilterHistory(guildId) {
  const st = guildState(guildId);
  const n = st.log.length;
  st.log = [];
  st.strikes = {};
  saveDoc(STATE_KEY, states());
  return n;
}
