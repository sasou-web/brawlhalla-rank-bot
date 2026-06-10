import { SERVER_LEVEL_TIERS } from "./config.js";
import { db, loadDoc, saveDoc, runOnce } from "./db.js";

const KEY = "levels";

/**
 * Niveaux / XP.
 *
 * - La CONFIG par serveur reste dans le document kv "levels" (faible écriture) :
 *     { guilds: { [guildId]: { config: {...} } } }
 * - Les DONNÉES XP des membres (forte écriture : chaque message/minute vocale) vivent
 *   dans la table dédiée `xp` (clé (guild_id, user_id)), avec des opérations atomiques
 *   par ligne au lieu de réécrire un gros blob JSON à chaque gain.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  cooldownSec: 60, // un seul gain d'XP par membre toutes les X secondes
  minXp: 15, // XP minimum par message comptabilise
  maxXp: 25, // XP maximum par message comptabilise
  announceChannelId: "", // salon d'annonce dedie (utilise si announceMode = "channel")
  announceMode: "channel", // "channel" (salon dedie/courant) | "dm" (message prive) | "off"
  rewards: {}, // { "5": roleId, "10": roleId, ... }
  stackRewards: true, // true = cumule tous les roles atteints ; false = garde seulement le plus haut
  // ---- XP vocal ----
  voiceEnabled: true,
  voiceXpPerMin: 10, // XP accordee par minute passee en vocal
  voiceRequireOthers: true, // exige au moins 2 membres (non-bots) dans le salon
  voiceIgnoreMuted: true, // pas d'XP si le membre est mute/sourdine (lui-meme)
  // ---- Multiplicateurs & anti-abus ----
  weekendBonus: 1, // multiplicateur le week-end (1 = off, ex: 2 = double XP sam/dim)
  boosterRoleId: "", // role qui beneficie d'un bonus d'XP (ex: booster Nitro)
  boosterMultiplier: 2, // multiplicateur applique au role bonus
  noXpChannels: [], // salons (texte/vocal) ou aucune XP n'est gagnee
  dailyXpCap: 0, // plafond d'XP par membre et par jour (0 = illimite)
};

// ---------- Persistance de la CONFIG (kv JSON) ----------

let cache = null;
let writeChain = Promise.resolve();

function loadConfigDoc() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function doWrite() {
  saveDoc(KEY, cache);
}

// Chaîne d'écritures : deux sauvegardes ne se chevauchent jamais.
function enqueueWrite() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

async function saveNow() {
  await enqueueWrite();
}

async function getGuild(guildId) {
  const c = loadConfigDoc();
  if (!c.guilds[guildId]) c.guilds[guildId] = { config: { ...DEFAULT_CONFIG } };
  c.guilds[guildId].config = { ...DEFAULT_CONFIG, ...c.guilds[guildId].config };
  return c.guilds[guildId];
}

// ---------- Table XP (forte écriture) ----------

const xpGetStmt = db.prepare(
  "SELECT xp, messages, last_ts AS lastTs, day_key AS dayKey, day_xp AS dayXp FROM xp WHERE guild_id = ? AND user_id = ?",
);
const xpUpsertStmt = db.prepare(`
  INSERT INTO xp (guild_id, user_id, xp, messages, last_ts, day_key, day_xp)
  VALUES (@g, @u, @xp, @messages, @lastTs, @dayKey, @dayXp)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    xp = @xp, messages = @messages, last_ts = @lastTs, day_key = @dayKey, day_xp = @dayXp
`);
const xpGreaterStmt = db.prepare("SELECT COUNT(*) AS c FROM xp WHERE guild_id = ? AND xp > ?");
const xpTotalStmt = db.prepare("SELECT COUNT(*) AS c FROM xp WHERE guild_id = ?");
const xpBoardStmt = db.prepare(
  "SELECT user_id AS id, xp, messages FROM xp WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC LIMIT ?",
);
const xpDelUserStmt = db.prepare("DELETE FROM xp WHERE guild_id = ? AND user_id = ?");
const xpDelGuildStmt = db.prepare("DELETE FROM xp WHERE guild_id = ?");
const xpInsertIgnoreStmt = db.prepare(
  "INSERT OR IGNORE INTO xp (guild_id, user_id, xp, messages, last_ts, day_key, day_xp) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

function getUserRow(guildId, userId) {
  return xpGetStmt.get(String(guildId), String(userId)) ?? null;
}

function blankUser() {
  return { xp: 0, messages: 0, lastTs: 0, dayKey: "", dayXp: 0 };
}

function saveUserRow(guildId, userId, u) {
  xpUpsertStmt.run({
    g: String(guildId),
    u: String(userId),
    xp: Math.max(0, Math.floor(u.xp || 0)),
    messages: Math.floor(u.messages || 0),
    lastTs: Math.floor(u.lastTs || 0),
    dayKey: u.dayKey ?? "",
    dayXp: Math.floor(u.dayXp || 0),
  });
}

// ---------- Migration unique : doc kv "levels".users -> table xp ----------
migrateUsersToTable();
function migrateUsersToTable() {
  if (!runOnce("levelsXpTable")) return;
  const doc = loadDoc(KEY, { guilds: {} });
  if (!doc.guilds) return;
  let migrated = 0;
  const tx = db.transaction(() => {
    for (const [gid, g] of Object.entries(doc.guilds)) {
      const users = g.users || {};
      for (const [uid, u] of Object.entries(users)) {
        xpInsertIgnoreStmt.run(
          String(gid),
          String(uid),
          Math.max(0, Math.floor(u.xp || 0)),
          Math.floor(u.messages || 0),
          Math.floor(u.lastTs || 0),
          u.dayKey ?? "",
          Math.floor(u.dayXp || 0),
        );
        migrated++;
      }
      delete g.users; // la config seule reste dans le doc kv
    }
  });
  tx();
  saveDoc(KEY, doc);
  cache = null; // force le rechargement de la version nettoyée
  if (migrated) console.log(`Migration XP -> table xp (${migrated} membre(s)).`);
}

// ---------- Courbe de niveaux (style MEE6) ----------

// XP necessaire pour passer du niveau `level` au niveau `level + 1`.
export function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

// XP cumulee totale pour atteindre `level`.
export function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

// A partir d'une XP totale, deduit niveau + progression vers le niveau suivant.
export function levelFromTotalXp(xp) {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return {
    level,
    xpIntoLevel: remaining, // XP acquise dans le niveau courant
    xpForNext: xpForLevel(level), // XP totale requise pour finir le niveau courant
  };
}

// ---------- Config ----------

export async function getLevelConfig(guildId) {
  const g = await getGuild(guildId);
  return { ...g.config };
}

export async function setLevelConfig(guildId, patch) {
  const g = await getGuild(guildId);
  g.config = { ...g.config, ...patch };
  await saveNow();
  return { ...g.config };
}

export async function setReward(guildId, level, roleId) {
  const g = await getGuild(guildId);
  if (roleId) g.config.rewards[String(level)] = roleId;
  else delete g.config.rewards[String(level)];
  await saveNow();
  return { ...g.config.rewards };
}

// Calcule le "plan" de roles de recompense pour un membre a un niveau donne.
// Renvoie { desired: string[], all: string[] }. Respecte stackRewards.
export async function rewardRolePlan(guildId, level) {
  const g = await getGuild(guildId);
  const entries = Object.entries(g.config.rewards)
    .map(([lvl, roleId]) => ({ lvl: Number(lvl), roleId }))
    .filter((e) => e.roleId);

  const all = entries.map((e) => e.roleId);
  const reached = entries.filter((e) => e.lvl <= level).sort((a, b) => a.lvl - b.lvl);

  let desired;
  if (g.config.stackRewards) {
    desired = reached.map((e) => e.roleId);
  } else {
    const top = reached[reached.length - 1];
    desired = top ? [top.roleId] : [];
  }
  return { desired: [...new Set(desired)], all: [...new Set(all)] };
}

// ---------- Gain d'XP ----------

// Jour calendaire (UTC) pour le suivi du cap journalier.
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Applique le plafond d'XP/jour : reset si nouveau jour, puis borne le gain au reste autorisé.
// Met à jour user.dayKey / user.dayXp. Renvoie le gain effectif (>= 0).
function applyDailyCap(cfg, user, gain) {
  const cap = Math.max(0, Math.floor(cfg.dailyXpCap || 0));
  const day = todayKey();
  if (user.dayKey !== day) {
    user.dayKey = day;
    user.dayXp = 0;
  }
  if (cap <= 0) {
    user.dayXp = (user.dayXp || 0) + gain;
    return gain;
  }
  const remaining = Math.max(0, cap - (user.dayXp || 0));
  const granted = Math.min(gain, remaining);
  user.dayXp = (user.dayXp || 0) + granted;
  return granted;
}

// Jour de la semaine en fuseau Europe/Paris ("Sat"/"Sun"...), pour que le bonus week-end
// colle au samedi/dimanche LOCAL des membres (et non au week-end UTC, décalé).
function parisWeekday() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(new Date());
}

/**
 * Calcule le multiplicateur d'XP à appliquer pour un gain, selon la config.
 * @param ctx { channelId?, roleIds?: string[] }
 */
export async function computeXpMultiplier(guildId, { channelId = "", roleIds = [] } = {}) {
  const g = await getGuild(guildId);
  const cfg = g.config;

  if (channelId && Array.isArray(cfg.noXpChannels) && cfg.noXpChannels.includes(channelId)) return 0;

  let mult = 1;
  const wd = parisWeekday(); // week-end en heure locale FR
  if ((wd === "Sat" || wd === "Sun") && cfg.weekendBonus > 1) mult *= cfg.weekendBonus;
  if (cfg.boosterRoleId && roleIds.includes(cfg.boosterRoleId) && cfg.boosterMultiplier > 1) {
    mult *= cfg.boosterMultiplier;
  }
  return mult;
}

/**
 * Comptabilise un message d'un membre.
 * Renvoie null si en cooldown / désactivé, sinon { level, leveledUp, oldLevel, xp, gain }.
 */
export async function addMessageXp(guildId, userId, multiplier = 1) {
  const g = await getGuild(guildId);
  if (!g.config.enabled) return null;
  if (multiplier <= 0) return null; // salon sans XP

  const now = Date.now();
  const user = getUserRow(guildId, userId) ?? blankUser();
  const cooldownMs = Math.max(0, g.config.cooldownSec) * 1000;
  if (now - (user.lastTs ?? 0) < cooldownMs) {
    // Toujours compter le message, mais pas d'XP en periode de cooldown.
    user.messages += 1;
    saveUserRow(guildId, userId, user);
    return null;
  }

  const oldLevel = levelFromTotalXp(user.xp).level;
  const min = Math.min(g.config.minXp, g.config.maxXp);
  const max = Math.max(g.config.minXp, g.config.maxXp);
  const baseGain = Math.floor(Math.random() * (max - min + 1)) + min;
  const gain = applyDailyCap(g.config, user, Math.max(0, Math.round(baseGain * multiplier)));

  user.xp += gain;
  user.messages += 1;
  user.lastTs = now;
  saveUserRow(guildId, userId, user);

  const newLevel = levelFromTotalXp(user.xp).level;
  return { leveledUp: newLevel > oldLevel, oldLevel, level: newLevel, xp: user.xp, gain };
}

// Accorde une quantité fixe d'XP (vocal, sans cooldown).
// Renvoie { leveledUp, oldLevel, level, xp } ou null si XP désactivée.
export async function addVoiceXp(guildId, userId, amount, multiplier = 1) {
  const g = await getGuild(guildId);
  if (!g.config.enabled || !g.config.voiceEnabled) return null;
  if (amount <= 0 || multiplier <= 0) return null;

  const user = getUserRow(guildId, userId) ?? blankUser();
  const oldLevel = levelFromTotalXp(user.xp).level;
  const gain = applyDailyCap(g.config, user, Math.max(0, Math.round(amount * multiplier)));
  user.xp += gain;
  saveUserRow(guildId, userId, user);

  const newLevel = levelFromTotalXp(user.xp).level;
  return { leveledUp: newLevel > oldLevel, oldLevel, level: newLevel, xp: user.xp };
}

// ---------- Annonce de montee de niveau (embed partage bot + dashboard) ----------

// Petite barre de progression visuelle (XP dans le niveau courant).
function xpBar(value, max, size = 14) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, size - filled));
}

const NF = new Intl.NumberFormat("fr-FR");

/**
 * Construit l'embed d'annonce de montée de niveau pour un membre.
 * Renvoie { embed, tierCrossed }.
 */
export function buildLevelUpAnnounce(guild, member, level, oldLevel, stats = null) {
  const tierCrossed = SERVER_LEVEL_TIERS.find((t) => t.level > (oldLevel ?? level - 1) && t.level <= level) || null;
  const reachedTier = [...SERVER_LEVEL_TIERS].reverse().find((t) => t.level <= level) || null;
  const color = (tierCrossed ?? reachedTier)?.color ?? 0xfee75c;
  const avatar = member.displayAvatarURL({ extension: "png", size: 128 });

  const author = {
    name: tierCrossed
      ? `🏆 ${member.displayName} • ${tierCrossed.name} débloqué !`
      : `⚡ ${member.displayName} • Niveau ${level}`,
    icon_url: avatar,
  };

  const congrats = tierCrossed
    ? `🎉 GG <@${member.id}>, tu franchis le palier **${tierCrossed.name}** ! 🔥`
    : `Bien joué <@${member.id}>, tu passes **niveau ${level}** ✨`;

  const lines = [congrats];
  if (stats && typeof stats.xpForNext === "number") {
    const into = Math.max(0, Math.floor(stats.xpIntoLevel || 0));
    const next = Math.max(1, Math.floor(stats.xpForNext));
    const bits = [`${xpBar(into, next, 10)} ${NF.format(into)}/${NF.format(next)} XP`];
    if (typeof stats.xp === "number") bits.push(`✨ ${NF.format(Math.floor(stats.xp))}`);
    if (stats.rank) bits.push(`🏅 #${NF.format(stats.rank)}`);
    lines.push(`-# ${bits.join("  ·  ")}`);
  }

  const embed = {
    color,
    author,
    description: lines.join("\n"),
  };

  return { embed, tierCrossed };
}

// ---------- Lecture ----------

export async function getUserStats(guildId, userId) {
  const row = getUserRow(guildId, userId);
  const user = row ?? blankUser();
  const info = levelFromTotalXp(user.xp);
  const greater = xpGreaterStmt.get(String(guildId), user.xp).c;
  const total = xpTotalStmt.get(String(guildId)).c;
  return {
    xp: user.xp ?? 0,
    messages: user.messages ?? 0,
    level: info.level,
    xpIntoLevel: info.xpIntoLevel,
    xpForNext: info.xpForNext,
    // Rang = nombre de membres avec strictement plus d'XP, +1 (null si le membre n'a pas de ligne).
    rank: row ? greater + 1 : null,
    totalMembers: total,
  };
}

export async function getLeaderboard(guildId, limit = 10) {
  const lim = Math.max(0, Math.floor(limit));
  const rows = xpBoardStmt.all(String(guildId), lim);
  return rows.map((r) => ({
    id: r.id,
    xp: r.xp ?? 0,
    messages: r.messages ?? 0,
    level: levelFromTotalXp(r.xp ?? 0).level,
  }));
}

// ---------- Admin ----------

// Definit directement l'XP totale d'un membre.
export async function setUserXp(guildId, userId, xp) {
  const user = getUserRow(guildId, userId) ?? blankUser();
  user.xp = Math.max(0, Math.floor(xp));
  saveUserRow(guildId, userId, user);
  return getUserStats(guildId, userId);
}

// Ajoute (ou retire si negatif) de l'XP a un membre.
export async function addUserXp(guildId, userId, delta) {
  const user = getUserRow(guildId, userId) ?? blankUser();
  user.xp = Math.max(0, (user.xp ?? 0) + Math.floor(delta));
  saveUserRow(guildId, userId, user);
  return getUserStats(guildId, userId);
}

// Definit l'XP correspondant a un niveau donne (debut du niveau).
export async function setUserLevel(guildId, userId, level) {
  return setUserXp(guildId, userId, totalXpForLevel(Math.max(0, Math.floor(level))));
}

// Remet a zero l'XP d'un membre, ou de tout le serveur si userId est null.
export async function resetLevels(guildId, userId = null) {
  if (userId) {
    const existed = Boolean(getUserRow(guildId, userId));
    xpDelUserStmt.run(String(guildId), String(userId));
    return existed;
  }
  xpDelGuildStmt.run(String(guildId));
  return true;
}
