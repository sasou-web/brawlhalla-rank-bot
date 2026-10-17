import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  escapeMarkdown,
} from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import { REGION_LABELS, TIERS, tierIndex, tierEmojiText } from "./config.js";
import { getAllLinks } from "./store.js";
import { getSettings } from "./settings.js";
import { removeTempChannel } from "./tempvoice.js";
import { getLadderPlayer } from "./ladder.js";

const KEY = "lfg";

/**
 * LFG : annonces « cherche partenaire / équipe » avec le rank vérifié de l'auteur.
 * Structure : { guilds: { [guildId]: {
 *   config: DEFAULT_LFG_CONFIG,
 *   posts: { [id]: { id, authorId, mode, region, text, tier, rating, members: [authorId, ...],
 *     channelId, messageId, createdAt, expiresAt, status: "open"|"full"|"closed"|"expired",
 *     pingRoleId, closedReason, endedAt, fullAt, voiceChannelId, messageGone } },
 *   pingedAt: { [userId]: ts }   // dernier ping du rôle de recherche (anti-spam, persistant)
 * } } }
 * Faible écriture (quelques annonces par heure) : le doc kv suffit.
 */
export const DEFAULT_LFG_CONFIG = {
  enabled: false,
  channelId: "",
  ttlMinutes: 60,
  requireLink: true,
  maxTierGap: 2,
  createVoice: false,
  voiceCategoryId: "",
  // Rôle pingé à la publication, par mode (vide : pas de ping), et délai entre deux pings
  // d'un même membre (anti-spam ; 0 : à chaque annonce).
  pingRole1v1: "",
  pingRole2v2: "",
  pingRole3v3: "",
  pingCooldownMinutes: 15,
};

// `rank` : mode ranked dont on affiche le rank (le 1v1 « entraînement » montre le rank 1v1).
// `openJoin` : n'importe qui rejoint, sans compte lié ni contrôle d'écart (choix d'ogsas,
// 17/10/2026 : le rank vérifié ne sert qu'à former une équipe 2v2/3v3).
export const LFG_MODES = {
  "2v2": { label: "2v2", capacity: 2, rank: "2v2" },
  "3v3": { label: "3v3", capacity: 3, rank: "3v3" },
  "1v1": { label: "1v1 entraînement", capacity: 2, rank: "1v1", openJoin: true },
};

export const LFG_COOLDOWN_MS = 2 * 60 * 1000;
export const LFG_TEXT_MAX = 200;
const TTL_MIN = 10;
const TTL_MAX = 24 * 60;
const MESSAGE_DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // carte terminée retirée du salon
const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // annonce terminée oubliée
const VOICE_IDLE_MS = 15 * 60 * 1000; // vocal d'équipe jamais rejoint : supprimé

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds || typeof cache.guilds !== "object") cache.guilds = {};
  return cache;
}

/** Persiste le doc (écritures sérialisées). À appeler après toute mutation d'annonce. */
export function saveLfg() {
  const doWrite = () => saveDoc(KEY, cache);
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

function getState(guildId) {
  const c = load();
  const g = c.guilds[guildId] || {};
  g.config = { ...DEFAULT_LFG_CONFIG, ...(g.config || {}) };
  if (!g.posts || typeof g.posts !== "object") g.posts = {};
  if (!g.pingedAt || typeof g.pingedAt !== "object") g.pingedAt = {};
  c.guilds[guildId] = g;
  return g;
}

// ---------- Config ----------

export async function getLfgConfig(guildId) {
  return { ...getState(guildId).config };
}

function badRequest(message) {
  const e = new Error(message);
  e.httpStatus = 400;
  return e;
}

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Applique un patch de config (dashboard). */
export async function setLfgConfig(guildId, patch = {}) {
  const g = getState(guildId);
  const next = { ...g.config };
  for (const k of ["channelId", "voiceCategoryId", "pingRole1v1", "pingRole2v2", "pingRole3v3"]) {
    if (!(k in patch)) continue;
    const v = String(patch[k] ?? "").trim();
    if (v && !/^\d{5,25}$/.test(v)) throw badRequest(`Valeur invalide pour ${k}.`);
    next[k] = v;
  }
  for (const k of ["enabled", "requireLink", "createVoice"]) if (k in patch) next[k] = Boolean(patch[k]);
  if ("ttlMinutes" in patch) next.ttlMinutes = clampInt(patch.ttlMinutes, TTL_MIN, TTL_MAX, DEFAULT_LFG_CONFIG.ttlMinutes);
  if ("pingCooldownMinutes" in patch) next.pingCooldownMinutes = clampInt(patch.pingCooldownMinutes, 0, TTL_MAX, DEFAULT_LFG_CONFIG.pingCooldownMinutes);
  if ("maxTierGap" in patch) next.maxTierGap = clampInt(patch.maxTierGap, 0, TIERS.length - 1, DEFAULT_LFG_CONFIG.maxTierGap);
  g.config = next;
  await saveLfg();
  return getLfgConfig(guildId);
}

// ---------- Annonces ----------

export function getPost(guildId, id) {
  return getState(guildId).posts[id] ?? null;
}

export function findOpenPostByAuthor(guildId, userId) {
  return Object.values(getState(guildId).posts).find((p) => p.status === "open" && p.authorId === userId) ?? null;
}

/**
 * Réserve une annonce (synchrone : la vérification « une annonce active par membre » et
 * l'insertion ne sont séparées par aucun `await`, deux /lfg simultanés ne passent pas).
 */
export function reservePost(guildId, { authorId, mode, region, text, tier, rating, channelId, ttlMinutes, pingRoleId }, now = Date.now()) {
  const existing = findOpenPostByAuthor(guildId, authorId);
  if (existing) return { error: "already", post: existing };
  const id = `${now.toString(36)}${randomBytes(2).toString("hex")}`;
  const post = {
    id,
    authorId,
    mode,
    region: region || "",
    text: text || "",
    tier: tier ?? null,
    rating: rating || 0,
    members: [authorId],
    pingRoleId: pingRoleId || "",
    channelId,
    messageId: null,
    createdAt: now,
    expiresAt: now + ttlMinutes * 60 * 1000,
    status: "open",
  };
  getState(guildId).posts[id] = post;
  return { post };
}

/** Délai anti-spam restant (ms) avant que `userId` puisse de nouveau pinger le rôle de recherche. */
export function pingCooldownLeft(guildId, userId, cooldownMs, now = Date.now()) {
  const last = getState(guildId).pingedAt[userId] ?? 0;
  return Math.max(0, cooldownMs - (now - last));
}

/** Note le ping (persisté avec le prochain `saveLfg`). */
export function markPinged(guildId, userId, now = Date.now()) {
  getState(guildId).pingedAt[userId] = now;
}

export async function deletePost(guildId, id) {
  delete getState(guildId).posts[id];
  await saveLfg();
}

// ---------- Fonctions pures ----------

/** Rôle à pinger pour une annonce de ce mode (config du dashboard), ou "". */
export function pingRoleFor(cfg, mode) {
  return LFG_MODES[mode] ? cfg?.[`pingRole${mode}`] || "" : "";
}

/**
 * Faut-il pinger le rôle de recherche ? `role` : le rôle Discord (ou null s'il a été
 * supprimé), `botCanMentionAll` : permission « Mentionner @everyone… » du bot dans le salon,
 * `cooldownLeftMs` : délai anti-spam restant pour l'auteur. Renvoie { roleId, reason } :
 * roleId vide = pas de ping, reason dit pourquoi (null si aucun rôle n'est configuré).
 */
export function pingDecision(roleId, { role, botCanMentionAll = false, cooldownLeftMs = 0 } = {}) {
  if (!roleId) return { roleId: "", reason: null };
  if (!role) return { roleId: "", reason: "missing" };
  if (!role.mentionable && !botCanMentionAll) return { roleId: "", reason: "not_mentionable" };
  if (cooldownLeftMs > 0) return { roleId: "", reason: "cooldown" };
  return { roleId, reason: null };
}

export function lfgCapacity(mode) {
  return LFG_MODES[mode]?.capacity ?? 2;
}

/** Tier de base (« Gold »…) du compte lié dans le mode de l'annonce, ou null. */
export function memberTier(link, mode) {
  const rankMode = LFG_MODES[mode]?.rank ?? mode;
  return link?.tiers?.[rankMode] ?? null;
}

export function memberRating(link, mode) {
  const rankMode = LFG_MODES[mode]?.rank ?? mode;
  return Number(link?.[`rating${rankMode}`]) || 0;
}

/**
 * Le membre `userId` (compte lié `link`, ou null) peut-il rejoindre `post` ?
 * Renvoie { ok: true } ou { ok: false, reason }. L'écart de rank se compare au tier de
 * l'auteur à la publication. « Non classé libre » (choix d'ogsas, 17/10/2026) : un membre
 * sans rank dans le mode, ou un auteur non classé, ne subit aucun contrôle d'écart, même
 * avec `requireLink` (qui n'exige alors que le compte lié). Annonce 1v1 entraînement
 * (`openJoin`) : ouverte à tous, ni compte lié ni contrôle d'écart.
 */
export function canJoin(post, link, userId, cfg = DEFAULT_LFG_CONFIG) {
  if (!post || post.status !== "open") return { ok: false, reason: "closed" };
  if (userId === post.authorId) return { ok: false, reason: "author" };
  if (post.members.includes(userId)) return { ok: false, reason: "already" };
  if (post.members.length >= lfgCapacity(post.mode)) return { ok: false, reason: "full" };
  if (LFG_MODES[post.mode]?.openJoin) return { ok: true };
  if (cfg.requireLink && !link) return { ok: false, reason: "not_linked" };
  const authorIdx = tierIndex(post.tier);
  const joinIdx = tierIndex(memberTier(link, post.mode));
  if (authorIdx >= 0 && joinIdx >= 0 && Math.abs(authorIdx - joinIdx) > cfg.maxTierGap) {
    return { ok: false, reason: "tier_gap" };
  }
  return { ok: true };
}

/** Ajoute le membre (après `canJoin`). Passe l'annonce en « full » quand elle est complète. */
export function joinPost(post, userId, now = Date.now()) {
  post.members.push(userId);
  if (post.members.length >= lfgCapacity(post.mode)) {
    post.status = "full";
    post.fullAt = now;
    post.endedAt = now;
  }
}

export function leavePost(post, userId) {
  if (post.status !== "open" || userId === post.authorId || !post.members.includes(userId)) return false;
  post.members = post.members.filter((id) => id !== userId);
  return true;
}

export function closePost(post, reason = "closed", now = Date.now()) {
  if (post.status !== "open") return false;
  post.status = "closed";
  post.closedReason = reason;
  post.endedAt = now;
  return true;
}

/** Expire les annonces ouvertes arrivées à échéance (les « full » ne sont pas touchées). Renvoie leurs ids. */
export function expirePosts(posts, now = Date.now()) {
  const expired = [];
  for (const post of Object.values(posts)) {
    if (post.status !== "open" || post.expiresAt > now) continue;
    post.status = "expired";
    post.endedAt = now;
    expired.push(post.id);
  }
  return expired;
}

/** Oublie les annonces terminées depuis plus de 7 jours. Renvoie le nombre supprimé. */
export function purgePosts(posts, now = Date.now()) {
  let n = 0;
  for (const [id, post] of Object.entries(posts)) {
    if (post.status === "open") continue;
    if (now - (post.endedAt ?? post.createdAt ?? 0) >= PURGE_AFTER_MS) {
      delete posts[id];
      n++;
    }
  }
  return n;
}

// ---------- Carte (Components V2) ----------

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const text = (s) => new TextDisplayBuilder().setContent(s);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

export function regionLabel(region) {
  return region ? REGION_LABELS[region] || region : "Toutes régions";
}

function rankLabel(link, mode, fallback = {}, ladderElo = null) {
  if (!link && !fallback.tier) return "*compte non lié*";
  const tier = memberTier(link, mode) ?? fallback.tier ?? null;
  if (!tier) return `*non classé*${ladderElo ? ` · ladder ${fmt(ladderElo)}` : ""}`;
  const rating = memberRating(link, mode) || fallback.rating || 0;
  const emoji = tierEmojiText(tier);
  return `${emoji ? `${emoji} ` : ""}**${tier}**${rating ? ` (${fmt(rating)})` : ""}`;
}

// En 2v2/3v3, le rank du mode peut être très différent du niveau réel : on montre aussi le 1v1.
function playerLabel(link, mode, fallback = {}, ladderElo = null) {
  const main = rankLabel(link, mode, fallback, ladderElo);
  const rankMode = LFG_MODES[mode]?.rank ?? mode;
  if (rankMode === "1v1" || !link) return main;
  return `${rankMode} ${main} · 1v1 ${rankLabel(link, "1v1")}`;
}

const STATUS_VIEW = {
  open: { accent: 0x5865f2, title: (m) => `## 🔎 Cherche ${m === "3v3" ? "équipe" : "partenaire"} ${LFG_MODES[m]?.label ?? m}` },
  full: { accent: 0x2ecc71, title: (m) => `## ✅ Équipe complète · ${LFG_MODES[m]?.label ?? m}` },
  expired: { accent: 0x5a606b, title: (m) => `## ⌛ Expirée · ${LFG_MODES[m]?.label ?? m}` },
  closed: { accent: 0x5a606b, title: (m) => `## 🔒 Fermée · ${LFG_MODES[m]?.label ?? m}` },
};

/**
 * Carte de l'annonce. `links` : { [discordUserId]: link } (getAllLinks). Seul l'envoi
 * initial (`ping: true`) peut notifier, et uniquement le rôle de recherche du mode ; les
 * éditions ne notifient personne. Le ping d'équipe complète est un message à part.
 */
export function buildLfgCard(post, links = {}, { ping = false, ladder = {} } = {}) {
  const view = STATUS_VIEW[post.status] ?? STATUS_VIEW.closed;
  const cap = lfgCapacity(post.mode);
  const card = new ContainerBuilder().setAccentColor(view.accent);

  const head = [view.title(post.mode)];
  if (post.pingRoleId && post.status === "open") head.push(`🔔 <@&${post.pingRoleId}>`);
  head.push(`🌍 ${regionLabel(post.region)} · par <@${post.authorId}> · ${playerLabel(links[post.authorId], post.mode, post, ladder[post.authorId])}`);
  if (post.text) head.push(`> ${escapeMarkdown(post.text).replace(/\n+/g, " ")}`);
  card.addTextDisplayComponents(text(head.join("\n")));

  card.addSeparatorComponents(sep());
  const lines = post.members.map((id) => `• <@${id}> · ${playerLabel(links[id], post.mode, id === post.authorId ? post : {}, ladder[id])}`);
  if (post.status === "open") for (let i = post.members.length; i < cap; i++) lines.push("• *place libre*");
  card.addTextDisplayComponents(text(`### Équipe ${post.members.length}/${cap}\n${lines.join("\n")}`));

  const ts = Math.floor(post.expiresAt / 1000);
  const footer = {
    open: `-# Expire <t:${ts}:R> · ${LFG_MODES[post.mode]?.openJoin ? "ouvert à tous" : "écart de rank vérifié à l'entrée"}`,
    full: post.voiceChannelId ? `-# 🎙️ Vocal d'équipe : <#${post.voiceChannelId}>` : "-# Bon jeu !",
    expired: "-# Personne n'a rejoint à temps. Relance /lfg pour republier.",
    closed: post.closedReason === "author_left" ? "-# L'auteur a quitté le serveur." : "-# Annonce fermée.",
  }[post.status];
  card.addTextDisplayComponents(text(footer ?? "-# Annonce terminée."));

  if (post.status === "open") {
    card.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg_join:${post.id}`).setLabel("Rejoindre").setEmoji("✋").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lfg_leave:${post.id}`).setLabel("Quitter").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg_close:${post.id}`).setLabel("Fermer").setStyle(ButtonStyle.Danger),
      ),
    );
  }
  const allowedMentions = ping && post.pingRoleId ? { roles: [post.pingRoleId] } : { parse: [] };
  return { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions };
}

/**
 * Carte prête à envoyer : comptes liés + Elo de ladder des membres qui y ont joué cette
 * saison (affiché pour les joueurs non classés dans le mode).
 */
export async function renderLfgCard(guildId, post, { ping = false } = {}) {
  const ladder = {};
  for (const id of post.members) {
    const row = getLadderPlayer(guildId, id);
    if (row?.played > 0) ladder[id] = row.elo;
  }
  return buildLfgCard(post, await getAllLinks(), { ping, ladder });
}

// ---------- Tick (toutes les 60 s) ----------

// Codes Discord « n'existe plus » : à distinguer d'une panne réseau (undefined = inconnu).
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_MESSAGE = 10008;

async function fetchOr(manager, id, goneCode) {
  const hit = manager.cache?.get(id);
  if (hit) return hit;
  try {
    return (await manager.fetch(id)) ?? null;
  } catch (err) {
    return err?.code === goneCode ? null : undefined;
  }
}

async function alertStaff(guild, content) {
  try {
    const s = await getSettings();
    const id = s.alertChannelId || s.auditChannelId;
    if (!id) return;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send({ content, allowedMentions: { parse: [] } });
  } catch {
    /* best-effort */
  }
}

/**
 * Expire les annonces, ferme celles dont l'auteur a quitté le serveur, retire les cartes
 * terminées depuis 24 h, supprime les vocaux d'équipe jamais rejoints et purge l'historique.
 * Salon LFG supprimé : module désactivé + alerte staff.
 */
export async function tickLfg(client, guild, now = Date.now()) {
  const g = getState(guild.id);
  const posts = g.posts;
  if (!g.config.enabled && !Object.keys(posts).length && !Object.keys(g.pingedAt).length) return;
  let dirty = false;

  const channels = new Map();
  const channelOf = async (id) => {
    if (!channels.has(id)) channels.set(id, id ? await fetchOr(guild.channels, id, UNKNOWN_CHANNEL) : null);
    return channels.get(id);
  };

  if (g.config.enabled && g.config.channelId && (await channelOf(g.config.channelId)) === null) {
    g.config.enabled = false;
    dirty = true;
    await alertStaff(guild, "⚠️ Le salon LFG a été supprimé : le module LFG est désactivé. Choisis un nouveau salon dans le dashboard (Communauté › LFG) puis réactive-le.");
  }

  const changed = [];
  for (const post of Object.values(posts)) {
    if (post.status !== "open") continue;
    if ((await fetchOr(guild.members, post.authorId, UNKNOWN_MEMBER)) === null && closePost(post, "author_left", now)) changed.push(post);
  }
  for (const id of expirePosts(posts, now)) changed.push(posts[id]);
  if (changed.length) dirty = true;

  const editable = changed.filter((p) => p.messageId && !p.messageGone);
  if (editable.length) {
    for (const post of editable) {
      const ch = await channelOf(post.channelId);
      if (!ch) continue;
      await ch.messages.edit(post.messageId, await renderLfgCard(guild.id, post)).catch((err) => {
        if (err?.code === UNKNOWN_MESSAGE) post.messageGone = true;
      });
    }
  }

  for (const post of Object.values(posts)) {
    if (post.status === "open" || !post.messageId || post.messageGone) continue;
    if (now - (post.endedAt ?? 0) < MESSAGE_DELETE_AFTER_MS) continue;
    const ch = await channelOf(post.channelId);
    if (ch === undefined) continue;
    if (ch) {
      const ok = await ch.messages
        .delete(post.messageId)
        .then(() => true)
        .catch((err) => err?.code === UNKNOWN_MESSAGE);
      if (!ok) continue;
    }
    post.messageGone = true;
    dirty = true;
  }

  for (const post of Object.values(posts)) {
    if (!post.voiceChannelId || now - (post.fullAt ?? 0) < VOICE_IDLE_MS) continue;
    const vc = await fetchOr(guild.channels, post.voiceChannelId, UNKNOWN_CHANNEL);
    if (vc === undefined || (vc && vc.members?.size > 0)) continue;
    if (vc) await vc.delete("Vocal LFG jamais rejoint").catch(() => {});
    await removeTempChannel(guild.id, post.voiceChannelId);
    post.voiceChannelId = null;
    dirty = true;
  }

  if (purgePosts(posts, now)) dirty = true;
  for (const [userId, ts] of Object.entries(g.pingedAt)) {
    if (now - ts < TTL_MAX * 60 * 1000) continue;
    delete g.pingedAt[userId];
    dirty = true;
  }
  if (dirty) await saveLfg();
}
