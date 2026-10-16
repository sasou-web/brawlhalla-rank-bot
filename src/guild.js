import { escapeMarkdown } from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import { apiGetOrNull } from "./brawlhalla.js";
import { getAllLinks } from "./store.js";

const KEY = "guild";

/**
 * Guilde Brawlhalla du serveur (guildes in-game, patch 10.00).
 * Structure : { guilds: { [discordGuildId]: {
 *   config: { brawlhallaGuildId, roleId, announceChannelId, announceJoins },
 *   snapshot: { at, bhGuildId, stats, members: [{ id, name, rank, joinDate, xp, points }] },
 *   baseline: { bhGuildId, members: [{ id, name }] },   // dernière liste vue par syncGuild (diff arrivées/départs)
 *   weekBase: { at, bhGuildId, members: [{ id, xp }] }, // début de semaine du récap hebdo
 *   lastSyncAt, lastError
 * } } }
 * Le snapshot sert à /guilde et au dashboard sans rappeler l'API (TTL 10 min). La baseline
 * n'est avancée QUE par syncGuild : un /guilde qui rafraîchit le snapshot ne fait pas
 * « disparaître » une arrivée avant qu'elle soit annoncée.
 */
export const DEFAULT_GUILD_CONFIG = {
  brawlhallaGuildId: "",
  roleId: "",
  announceChannelId: "",
  announceJoins: true,
};

export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds || typeof cache.guilds !== "object") cache.guilds = {};
  return cache;
}

function save() {
  const doWrite = () => saveDoc(KEY, cache);
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

function getState(guildId) {
  const c = load();
  const g = c.guilds[guildId] || {};
  g.config = { ...DEFAULT_GUILD_CONFIG, ...(g.config || {}) };
  c.guilds[guildId] = g;
  return g;
}

export async function getGuildConfig(guildId) {
  return { ...getState(guildId).config };
}

function badRequest(message) {
  const e = new Error(message);
  e.httpStatus = 400;
  return e;
}

/** Applique un patch de config (dashboard). Changer de guilde efface les données de l'ancienne. */
export async function setGuildConfig(guildId, patch = {}) {
  const g = getState(guildId);
  const next = { ...g.config };
  if ("brawlhallaGuildId" in patch) {
    const id = String(patch.brawlhallaGuildId ?? "").trim();
    if (id && !/^\d{1,12}$/.test(id)) throw badRequest("L'ID de guilde doit être un nombre (visible dans le jeu ou sur l'API Brawlhalla).");
    next.brawlhallaGuildId = id;
  }
  for (const k of ["roleId", "announceChannelId"]) {
    if (!(k in patch)) continue;
    const v = String(patch[k] ?? "").trim();
    if (v && !/^\d{5,25}$/.test(v)) throw badRequest(`Valeur invalide pour ${k}.`);
    next[k] = v;
  }
  if ("announceJoins" in patch) next.announceJoins = Boolean(patch.announceJoins);

  if (next.brawlhallaGuildId !== g.config.brawlhallaGuildId) {
    delete g.snapshot;
    delete g.baseline;
    delete g.weekBase;
    delete g.lastError;
  }
  g.config = next;
  await save();
  return getGuildConfig(guildId);
}

// ---------- API Brawlhalla ----------

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Normalise la réponse de /guild/members (tableau `guild_members`, ou tableau brut). */
export function normalizeGuildMembers(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.guild_members) ? raw.guild_members : Array.isArray(raw?.members) ? raw.members : null;
  if (!list) return null;
  return list
    .filter((m) => m && m.brawlhalla_id != null)
    .map((m) => ({
      id: String(m.brawlhalla_id),
      name: String(m.name ?? "").trim() || `#${m.brawlhalla_id}`,
      rank: String(m.rank ?? ""),
      joinDate: num(m.join_date),
      xp: num(m.xp),
      points: num(m.guild_points),
    }));
}

/** Normalise la réponse de /guild/stats. `rank`/`member_count` peuvent manquer (guilde récente). */
export function normalizeGuildStats(raw) {
  if (!raw || typeof raw !== "object" || raw.guild_id == null) return null;
  return {
    id: String(raw.guild_id),
    name: String(raw.name ?? "").trim() || `Guilde ${raw.guild_id}`,
    xp: num(raw.xp),
    legacyXp: num(raw.legacy_xp),
    points: num(raw.guild_points),
    rank: raw.rank == null || raw.rank === "" ? null : num(raw.rank),
    memberCount: raw.member_count == null || raw.member_count === "" ? null : num(raw.member_count),
    createDate: num(raw.create_date),
    recruiting: Boolean(raw.is_recruiting),
  };
}

// La forme des réponses n'a pas pu être vérifiée sur la vraie guilde avant la mise en prod :
// on journalise un extrait de la PREMIÈRE réponse de chaque endpoint (et toute réponse
// illisible) pour pouvoir ajuster la normalisation depuis `pm2 logs`.
const loggedShape = new Set();
function logShape(endpoint, raw, parsed) {
  if (raw == null || (parsed && loggedShape.has(endpoint))) return;
  loggedShape.add(endpoint);
  const sample = JSON.stringify(raw).slice(0, 400);
  if (parsed) console.log(`Guilde Brawlhalla : première réponse ${endpoint} = ${sample}`);
  else console.warn(`Guilde Brawlhalla : réponse ${endpoint} illisible = ${sample}`);
}

export async function fetchGuildStats(bhGuildId) {
  const raw = await apiGetOrNull("/guild/stats", { guild_id: bhGuildId });
  const parsed = normalizeGuildStats(raw);
  logShape("/guild/stats", raw, parsed);
  return parsed;
}

export async function fetchGuildMembers(bhGuildId) {
  const raw = await apiGetOrNull("/guild/members", { guild_id: bhGuildId });
  const parsed = normalizeGuildMembers(raw);
  logShape("/guild/members", raw, parsed);
  return parsed;
}

// ---------- Fonctions pures ----------

/** Arrivées / départs entre deux listes de membres (comparaison par ID : un renommage n'est ni l'un ni l'autre). */
export function diffGuildMembers(prevList = [], nextList = []) {
  const prevIds = new Set(prevList.map((m) => String(m.id)));
  const nextIds = new Set(nextList.map((m) => String(m.id)));
  return {
    joined: nextList.filter((m) => !prevIds.has(String(m.id))),
    left: prevList.filter((m) => !nextIds.has(String(m.id))),
  };
}

/** Index brawlhallaId (string) → discordId, à partir de getAllLinks(). */
export function buildLinksIndex(links = {}) {
  const index = new Map();
  for (const [discordId, link] of Object.entries(links)) {
    if (link?.brawlhallaId != null) index.set(String(link.brawlhallaId), discordId);
  }
  return index;
}

/**
 * Plan d'attribution du rôle de guilde.
 * - `members` : membres de la guilde ; `linksIndex` : Map brawlhallaId → discordId ;
 * - `memberRoleIds` : Set des discordId (membres LIÉS) qui ont déjà le rôle.
 * Ajout : lié + dans la guilde + sans le rôle. Retrait : lié + rôle + hors de la guilde.
 * Un membre Discord non lié n'apparaît jamais (rôle donné à la main = intouché).
 */
export function guildRolePlan(members = [], linksIndex = new Map(), memberRoleIds = new Set()) {
  const inGuild = new Set();
  for (const m of members) {
    const discordId = linksIndex.get(String(m.id));
    if (discordId) inGuild.add(discordId);
  }
  const linked = new Set(linksIndex.values());
  const toAdd = [...inGuild].filter((id) => !memberRoleIds.has(id));
  const toRemove = [...memberRoleIds].filter((id) => linked.has(id) && !inGuild.has(id));
  return { toAdd, toRemove };
}

/**
 * Bilan de la semaine pour le récap hebdo : arrivées, départs et meilleur contributeur
 * (gain d'XP de guilde depuis `weekBase`, repli sur les points de guilde de la semaine).
 */
export function computeGuildWeek(weekBase, members = []) {
  const base = new Map((weekBase?.members || []).map((m) => [String(m.id), num(m.xp)]));
  const { joined, left } = diffGuildMembers(weekBase?.members || [], members);
  let top = null;
  for (const m of members) {
    const gain = m.xp - (base.get(String(m.id)) ?? 0);
    if (gain > 0 && (!top || gain > top.value)) top = { id: m.id, name: m.name, value: gain, unit: "XP" };
  }
  if (!top) {
    for (const m of members) {
      if (m.points > 0 && (!top || m.points > top.value)) top = { id: m.id, name: m.name, value: m.points, unit: "points" };
    }
  }
  return { joined: joined.length, left: left.length, top };
}

/** Texte « membre » : pseudo échappé, suivi de la mention si le compte est lié. */
export function memberLabel(m, linksIndex) {
  const discordId = linksIndex?.get(String(m.id));
  const name = `**${escapeMarkdown(m.name)}**`;
  return discordId ? `${name} (<@${discordId}>)` : name;
}

export function formatGuildWeek(week, linksIndex) {
  const parts = [`+${week.joined} membre${week.joined > 1 ? "s" : ""}`];
  if (week.left) parts.push(`${week.left} départ${week.left > 1 ? "s" : ""}`);
  let text = parts.join(", ");
  if (week.top) text += `\nTop contributeur : ${memberLabel(week.top, linksIndex)} (+${week.top.value.toLocaleString("fr-FR")} ${week.top.unit})`;
  return text;
}

/** Messages d'annonce (découpés sous la limite Discord de 2000 caractères). */
export function buildJoinLeaveMessages({ joined = [], left = [] }) {
  const lines = [
    ...joined.map((m) => `🛡️ **${escapeMarkdown(m.name)}** a rejoint la guilde`),
    ...left.map((m) => `👋 **${escapeMarkdown(m.name)}** a quitté la guilde`),
  ];
  const out = [];
  let cur = "";
  for (const line of lines) {
    if (cur && cur.length + 1 + line.length > 1900) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- Snapshot ----------

const inflight = new Map(); // discordGuildId -> Promise

/**
 * Récupère stats + membres et remplace le snapshot. Sur erreur ou donnée manquante, garde
 * l'ancien snapshot, note l'erreur et renvoie { ok: false }. Une liste vide alors que la
 * précédente ne l'était pas est traitée comme une réponse incomplète de l'API.
 */
export function refreshGuildSnapshot(guildId) {
  if (inflight.has(guildId)) return inflight.get(guildId);
  const p = (async () => {
    const g = getState(guildId);
    const bhGuildId = g.config.brawlhallaGuildId;
    if (!bhGuildId) return { ok: false, error: "Guilde non configurée." };
    let stats;
    let members;
    try {
      [stats, members] = await Promise.all([fetchGuildStats(bhGuildId), fetchGuildMembers(bhGuildId)]);
    } catch (err) {
      return fail(g, `API Brawlhalla indisponible : ${err.message}`);
    }
    if (!stats || !members) return fail(g, `Guilde ${bhGuildId} introuvable sur l'API Brawlhalla.`);
    const prev = g.snapshot?.bhGuildId === bhGuildId ? g.snapshot : null;
    if (members.length === 0 && prev?.members?.length) return fail(g, "L'API a renvoyé une liste de membres vide : ignorée.");
    // La config a pu changer pendant l'appel : on n'écrit pas les données d'une autre guilde.
    if (g.config.brawlhallaGuildId !== bhGuildId) return { ok: false, error: "Configuration modifiée pendant la lecture." };
    g.snapshot = { at: Date.now(), bhGuildId, stats, members };
    delete g.lastError;
    await save();
    return { ok: true, snapshot: g.snapshot };
  })().finally(() => inflight.delete(guildId));
  inflight.set(guildId, p);
  return p;
}

async function fail(g, error) {
  g.lastError = { at: Date.now(), message: error };
  await save();
  return { ok: false, error };
}

/**
 * Vue courante pour /guilde et le dashboard : snapshot de moins de 10 min, sinon relecture.
 * Si la relecture échoue, renvoie l'ancien snapshot marqué `stale`.
 */
export async function getGuildView(guildId, { maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
  const g = getState(guildId);
  const bhGuildId = g.config.brawlhallaGuildId;
  if (!bhGuildId) return { configured: false };
  const snap = g.snapshot?.bhGuildId === bhGuildId ? g.snapshot : null;
  if (snap && Date.now() - snap.at < maxAgeMs) return { configured: true, snapshot: snap, stale: false };
  const r = await refreshGuildSnapshot(guildId);
  if (r.ok) return { configured: true, snapshot: r.snapshot, stale: false };
  return { configured: true, snapshot: snap, stale: true, error: r.error };
}

/** État pour le dashboard (lecture seule) : config, dernier snapshot, erreurs, liaisons. */
export async function getGuildStatus(guildId) {
  const g = getState(guildId);
  const linksIndex = buildLinksIndex(await getAllLinks());
  const snap = g.snapshot?.bhGuildId === g.config.brawlhallaGuildId ? g.snapshot : null;
  return {
    configured: Boolean(g.config.brawlhallaGuildId),
    lastSyncAt: g.lastSyncAt || null,
    lastError: g.lastError || null,
    snapshot: snap && {
      at: snap.at,
      stats: snap.stats,
      members: snap.members.map((m) => ({ ...m, discordId: linksIndex.get(m.id) || null })),
    },
  };
}

// ---------- Synchro (boucle de refresh) ----------

let syncing = false;

/**
 * Appelée après chaque refresh des membres : relit la guilde, annonce arrivées/départs,
 * ajuste le rôle des membres liés. Inerte si non configurée ; ne retire jamais rien quand
 * la lecture échoue. Renvoie un bilan { skipped?, added, removed, joined, left, error? }.
 */
export async function syncGuild(guild) {
  const g = getState(guild.id);
  const cfg = g.config;
  if (!cfg.brawlhallaGuildId) return { skipped: "not-configured" };
  if (syncing) return { skipped: "busy" };
  syncing = true;
  try {
    const r = await refreshGuildSnapshot(guild.id);
    if (!r.ok) return { error: r.error, added: 0, removed: 0, joined: 0, left: 0 };
    const { members, bhGuildId } = r.snapshot;
    const result = { added: 0, removed: 0, joined: 0, left: 0 };

    // Arrivées / départs : uniquement par rapport à une baseline de la MÊME guilde
    // (premier passage ou changement de guilde = amorçage silencieux).
    const baseline = g.baseline?.bhGuildId === bhGuildId ? g.baseline.members : null;
    if (baseline) {
      const diff = diffGuildMembers(baseline, members);
      result.joined = diff.joined.length;
      result.left = diff.left.length;
      if (cfg.announceJoins && cfg.announceChannelId && (diff.joined.length || diff.left.length)) {
        const ch = await guild.channels.fetch(cfg.announceChannelId).catch(() => null);
        if (ch?.isTextBased?.()) {
          for (const content of buildJoinLeaveMessages(diff)) {
            await ch.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
          }
        }
      }
    }
    g.baseline = { bhGuildId, members: members.map((m) => ({ id: m.id, name: m.name })) };
    if (g.weekBase?.bhGuildId !== bhGuildId) g.weekBase = { at: Date.now(), bhGuildId, members: members.map((m) => ({ id: m.id, xp: m.xp })) };
    g.lastSyncAt = Date.now();
    await save();

    if (cfg.roleId) Object.assign(result, await applyGuildRole(guild, cfg.roleId, members));
    return result;
  } finally {
    syncing = false;
  }
}

async function applyGuildRole(guild, roleId, members) {
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return { added: 0, removed: 0, roleError: "Rôle de guilde introuvable (supprimé ?)." };
  const linksIndex = buildLinksIndex(await getAllLinks());
  const discordMembers = new Map();
  const holders = new Set();
  for (const discordId of new Set(linksIndex.values())) {
    const member = guild.members.cache.get(discordId) ?? (await guild.members.fetch(discordId).catch(() => null));
    if (!member) continue; // a quitté le Discord : son rôle est parti avec lui
    discordMembers.set(discordId, member);
    if (member.roles.cache.has(roleId)) holders.add(discordId);
  }
  const plan = guildRolePlan(members, linksIndex, holders);
  let added = 0;
  let removed = 0;
  for (const id of plan.toAdd) {
    const member = discordMembers.get(id);
    if (!member) continue;
    try {
      await member.roles.add(roleId, "Membre de la guilde Brawlhalla");
      added++;
    } catch (err) {
      console.warn(`Rôle de guilde non ajouté à ${id} : ${err.message}`);
    }
  }
  for (const id of plan.toRemove) {
    try {
      await discordMembers.get(id).roles.remove(roleId, "N'est plus dans la guilde Brawlhalla");
      removed++;
    } catch (err) {
      console.warn(`Rôle de guilde non retiré à ${id} : ${err.message}`);
    }
  }
  return { added, removed };
}

// ---------- Récap hebdo ----------

/**
 * Bloc « Guilde » du récap hebdo (texte) ou null si la guilde n'est pas configurée ou sans
 * données. Remet le compteur de semaine à zéro (appelé une fois par récap).
 */
export async function takeGuildWeekRecap(guildId) {
  const g = getState(guildId);
  const bhGuildId = g.config.brawlhallaGuildId;
  const snap = g.snapshot?.bhGuildId === bhGuildId ? g.snapshot : null;
  if (!bhGuildId || !snap) return null;
  const week = g.weekBase?.bhGuildId === bhGuildId ? computeGuildWeek(g.weekBase, snap.members) : null;
  g.weekBase = { at: Date.now(), bhGuildId, members: snap.members.map((m) => ({ id: m.id, xp: m.xp })) };
  await save();
  if (!week) return null;
  return formatGuildWeek(week, buildLinksIndex(await getAllLinks()));
}
