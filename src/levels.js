import { SERVER_LEVEL_TIERS } from "./config.js";
import { loadDoc, saveDoc } from "./db.js";

const KEY = "levels";

/**
 * Structure (clé SQLite "levels") :
 * {
 *   guilds: {
 *     [guildId]: {
 *       config: { enabled, cooldownSec, minXp, maxXp, announceChannelId, rewards: { [level]: roleId } },
 *       users:  { [userId]: { xp, messages, lastTs } }
 *     }
 *   }
 * }
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

let cache = null;
let saveTimer = null;
// Chaine d'ecritures : garantit que deux sauvegardes ne s'executent jamais en parallele
// (sinon risque de fichier corrompu). Chaque ecriture serialise l'etat le plus recent du cache.
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

// Persistance SQLite (transaction atomique côté db.js).
async function doWrite() {
  saveDoc(KEY, cache);
}

// Met en file une ecriture. Les ecritures s'enchainent sans se chevaucher.
function enqueueWrite() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

// Ecriture differee : regroupe les rafales d'updates (messages) en une seule sauvegarde.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    enqueueWrite().catch(() => {});
  }, 5000);
}

// Sauvegarde immediate et attendue (commandes admin : on veut une persistance sure).
async function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await enqueueWrite();
}

async function getGuild(guildId) {
  const c = await load();
  if (!c.guilds[guildId]) {
    c.guilds[guildId] = { config: { ...DEFAULT_CONFIG }, users: {} };
  }
  // Complete la config avec d'eventuelles nouvelles cles par defaut.
  c.guilds[guildId].config = { ...DEFAULT_CONFIG, ...c.guilds[guildId].config };
  if (!c.guilds[guildId].users) c.guilds[guildId].users = {};
  return c.guilds[guildId];
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
// Renvoie { desired: string[], all: string[] } :
//  - all    : tous les roleId de recompense configures (pour savoir lesquels nettoyer)
//  - desired : ceux que le membre devrait avoir a ce niveau
// Respecte stackRewards (cumul de tous les paliers atteints, ou seulement le plus haut).
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
    // Un seul role : celui du palier atteint le plus eleve.
    const top = reached[reached.length - 1];
    desired = top ? [top.roleId] : [];
  }
  // Dedoublonne (deux niveaux peuvent pointer le meme role).
  return { desired: [...new Set(desired)], all: [...new Set(all)] };
}

// ---------- Gain d'XP ----------

// Jour calendaire (UTC) pour le suivi du cap journalier.
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Applique le plafond d'XP/jour : reset si nouveau jour, puis borne le gain au reste autorise.
// Met a jour user.dayKey / user.dayXp. Renvoie le gain effectif (>= 0).
function applyDailyCap(g, user, gain) {
  const cap = Math.max(0, Math.floor(g.config.dailyXpCap || 0));
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

/**
 * Calcule le multiplicateur d'XP a appliquer pour un gain, selon la config :
 *  - 0 si le salon est dans noXpChannels (aucune XP)
 *  - x weekendBonus le week-end (samedi/dimanche)
 *  - x boosterMultiplier si le membre a le role bonus
 * @param ctx { channelId?, roleIds?: string[] }
 */
export async function computeXpMultiplier(guildId, { channelId = "", roleIds = [] } = {}) {
  const g = await getGuild(guildId);
  const cfg = g.config;

  if (channelId && Array.isArray(cfg.noXpChannels) && cfg.noXpChannels.includes(channelId)) return 0;

  let mult = 1;
  const day = new Date().getUTCDay(); // 0 = dimanche, 6 = samedi
  if ((day === 0 || day === 6) && cfg.weekendBonus > 1) mult *= cfg.weekendBonus;
  if (cfg.boosterRoleId && roleIds.includes(cfg.boosterRoleId) && cfg.boosterMultiplier > 1) {
    mult *= cfg.boosterMultiplier;
  }
  return mult;
}

/**
 * Comptabilise un message d'un membre.
 * Renvoie null si en cooldown / desactive, sinon { level, leveledUp, oldLevel, xp }.
 */
export async function addMessageXp(guildId, userId, multiplier = 1) {
  const g = await getGuild(guildId);
  if (!g.config.enabled) return null;
  if (multiplier <= 0) return null; // salon sans XP

  const now = Date.now();
  const user = g.users[userId] ?? { xp: 0, messages: 0, lastTs: 0 };
  const cooldownMs = Math.max(0, g.config.cooldownSec) * 1000;
  if (now - (user.lastTs ?? 0) < cooldownMs) {
    // Toujours compter le message, mais pas d'XP en periode de cooldown.
    user.messages += 1;
    g.users[userId] = user;
    scheduleSave();
    return null;
  }

  const oldLevel = levelFromTotalXp(user.xp).level;
  const min = Math.min(g.config.minXp, g.config.maxXp);
  const max = Math.max(g.config.minXp, g.config.maxXp);
  const baseGain = Math.floor(Math.random() * (max - min + 1)) + min;
  const gain = applyDailyCap(g, user, Math.max(0, Math.round(baseGain * multiplier)));

  user.xp += gain;
  user.messages += 1;
  user.lastTs = now;
  g.users[userId] = user;

  const newLevel = levelFromTotalXp(user.xp).level;
  scheduleSave();

  return {
    leveledUp: newLevel > oldLevel,
    oldLevel,
    level: newLevel,
    xp: user.xp,
    gain,
  };
}

// Accorde une quantite fixe d'XP (utilise pour le vocal, sans cooldown).
// Renvoie { leveledUp, oldLevel, level, xp } ou null si XP desactivee.
export async function addVoiceXp(guildId, userId, amount, multiplier = 1) {
  const g = await getGuild(guildId);
  if (!g.config.enabled || !g.config.voiceEnabled) return null;
  if (amount <= 0 || multiplier <= 0) return null;

  const user = g.users[userId] ?? { xp: 0, messages: 0, lastTs: 0 };
  const oldLevel = levelFromTotalXp(user.xp).level;
  const gain = applyDailyCap(g, user, Math.max(0, Math.round(amount * multiplier)));
  user.xp += gain;
  g.users[userId] = user;

  const newLevel = levelFromTotalXp(user.xp).level;
  scheduleSave();

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
 * Construit l'embed d'annonce de montee de niveau pour un membre.
 * @param stats (optionnel) { rank, totalMembers, xp, xpIntoLevel, xpForNext } pour la barre/les champs.
 * Renvoie { embed, tierCrossed } :
 *   - tierCrossed : le palier (SERVER_LEVEL_TIERS) franchi durant cette montee, ou null.
 * Un palier est franchi si son niveau est dans l'intervalle (oldLevel, level].
 */
export function buildLevelUpAnnounce(guild, member, level, oldLevel, stats = null) {
  const tierCrossed = SERVER_LEVEL_TIERS.find((t) => t.level > (oldLevel ?? level - 1) && t.level <= level) || null;
  const reachedTier = [...SERVER_LEVEL_TIERS].reverse().find((t) => t.level <= level) || null;
  const color = (tierCrossed ?? reachedTier)?.color ?? 0xfee75c;
  const avatar = member.displayAvatarURL({ extension: "png", size: 128 });

  // En-tete compact : avatar + pseudo + niveau/palier sur une seule ligne.
  const author = {
    name: tierCrossed
      ? `🏆 ${member.displayName} • ${tierCrossed.name} débloqué !`
      : `⚡ ${member.displayName} • Niveau ${level}`,
    icon_url: avatar,
  };

  const congrats = tierCrossed
    ? `🎉 GG <@${member.id}>, tu franchis le palier **${tierCrossed.name}** ! 🔥`
    : `Bien joué <@${member.id}>, tu passes **niveau ${level}** ✨`;

  // Ligne de stats discrete (petit texte) : barre + XP + rang, tout sur une ligne.
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
  const g = await getGuild(guildId);
  const user = g.users[userId] ?? { xp: 0, messages: 0, lastTs: 0 };
  const info = levelFromTotalXp(user.xp);
  // Rang du membre dans le serveur (par XP decroissante).
  const sorted = Object.entries(g.users).sort((a, b) => (b[1].xp ?? 0) - (a[1].xp ?? 0));
  const rank = sorted.findIndex(([id]) => id === userId) + 1;
  return {
    xp: user.xp ?? 0,
    messages: user.messages ?? 0,
    level: info.level,
    xpIntoLevel: info.xpIntoLevel,
    xpForNext: info.xpForNext,
    rank: rank > 0 ? rank : null,
    totalMembers: sorted.length,
  };
}

export async function getLeaderboard(guildId, limit = 10) {
  const g = await getGuild(guildId);
  return Object.entries(g.users)
    .map(([id, u]) => ({ id, xp: u.xp ?? 0, messages: u.messages ?? 0, level: levelFromTotalXp(u.xp ?? 0).level }))
    .filter((e) => e.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

// ---------- Admin ----------

// Definit directement l'XP totale d'un membre.
export async function setUserXp(guildId, userId, xp) {
  const g = await getGuild(guildId);
  const user = g.users[userId] ?? { xp: 0, messages: 0, lastTs: 0 };
  user.xp = Math.max(0, Math.floor(xp));
  g.users[userId] = user;
  await saveNow();
  return getUserStats(guildId, userId);
}

// Ajoute (ou retire si negatif) de l'XP a un membre.
export async function addUserXp(guildId, userId, delta) {
  const g = await getGuild(guildId);
  const user = g.users[userId] ?? { xp: 0, messages: 0, lastTs: 0 };
  user.xp = Math.max(0, (user.xp ?? 0) + Math.floor(delta));
  g.users[userId] = user;
  await saveNow();
  return getUserStats(guildId, userId);
}

// Definit l'XP correspondant a un niveau donne (debut du niveau).
export async function setUserLevel(guildId, userId, level) {
  return setUserXp(guildId, userId, totalXpForLevel(Math.max(0, Math.floor(level))));
}

// Remet a zero l'XP d'un membre, ou de tout le serveur si userId est null.
export async function resetLevels(guildId, userId = null) {
  const g = await getGuild(guildId);
  if (userId) {
    const existed = Boolean(g.users[userId]);
    delete g.users[userId];
    await saveNow();
    return existed;
  }
  g.users = {};
  await saveNow();
  return true;
}
