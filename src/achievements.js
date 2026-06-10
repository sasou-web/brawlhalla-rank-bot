import { db } from "./db.js";
import { tierIndex } from "./config.js";

/**
 * Achievements / quêtes : badges débloqués par les membres selon leurs accomplissements
 * (liaison, rank atteint, niveau XP, clips postés…). Stockés dans la table `achievements`
 * ((guild_id, user_id, ach_id)), avec des compteurs persistants dans `counters`.
 */

// Indice de tier le plus haut atteint (1v1 ou 2v2), -1 si aucun.
function bestTierIndex(stats) {
  return Math.max(tierIndex(stats.tier1v1), tierIndex(stats.tier2v2));
}

/**
 * Définitions. `test(stats)` est PURE. stats = {
 *   linked, tier1v1, tier2v2, level, globalRank, clips
 * }
 */
export const ACHIEVEMENTS = [
  { id: "linked", name: "Lié", emoji: "🔗", desc: "Relier son compte Brawlhalla", test: (s) => !!s.linked },
  { id: "gold", name: "Gold", emoji: "🥇", desc: "Atteindre Gold (1v1 ou 2v2)", test: (s) => bestTierIndex(s) >= tierIndex("Gold") },
  { id: "diamond", name: "Diamant", emoji: "💎", desc: "Atteindre Diamond", test: (s) => bestTierIndex(s) >= tierIndex("Diamond") },
  { id: "valhallan", name: "Valhallan", emoji: "🟣", desc: "Atteindre Valhallan", test: (s) => bestTierIndex(s) >= tierIndex("Valhallan") },
  { id: "top100", name: "Top 100", emoji: "🌍", desc: "Être classé top 100 mondial 1v1", test: (s) => s.globalRank > 0 && s.globalRank <= 100 },
  { id: "level10", name: "Niveau 10", emoji: "⭐", desc: "Atteindre le niveau 10 sur le serveur", test: (s) => (s.level || 0) >= 10 },
  { id: "level50", name: "Niveau 50", emoji: "🌟", desc: "Atteindre le niveau 50 sur le serveur", test: (s) => (s.level || 0) >= 50 },
  { id: "clips5", name: "Créateur", emoji: "🎬", desc: "Poster 5 clips", test: (s) => (s.clips || 0) >= 5 },
  { id: "clips25", name: "Vidéaste", emoji: "🎥", desc: "Poster 25 clips", test: (s) => (s.clips || 0) >= 25 },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Renvoie la liste des IDs d'achievements satisfaits par `stats` (fonction PURE). */
export function evaluateAchievements(stats, defs = ACHIEVEMENTS) {
  const out = [];
  for (const a of defs) {
    try {
      if (a.test(stats || {})) out.push(a.id);
    } catch {
      /* une définition robuste ne devrait jamais throw */
    }
  }
  return out;
}

// ---------- Stockage ----------

const unlockedStmt = db.prepare("SELECT ach_id AS id, unlocked_ts AS ts FROM achievements WHERE guild_id = ? AND user_id = ?");
const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO achievements (guild_id, user_id, ach_id, unlocked_ts) VALUES (?, ?, ?, ?)",
);

/** Map id -> ts des achievements débloqués par un membre. */
export function listUnlocked(guildId, userId) {
  const rows = unlockedStmt.all(String(guildId), String(userId));
  const map = new Map();
  for (const r of rows) map.set(r.id, r.ts);
  return map;
}

/**
 * Évalue `stats`, débloque les NOUVEAUX achievements et les renvoie (defs).
 * Best-effort. Renvoie [] si rien de nouveau.
 */
export function grantAchievements(guildId, userId, stats) {
  const satisfied = evaluateAchievements(stats);
  if (!satisfied.length) return [];
  const already = listUnlocked(guildId, userId);
  const now = Date.now();
  const fresh = [];
  const tx = db.transaction(() => {
    for (const id of satisfied) {
      if (already.has(id)) continue;
      const info = insertStmt.run(String(guildId), String(userId), id, now);
      if (info.changes > 0 && BY_ID.has(id)) fresh.push(BY_ID.get(id));
    }
  });
  tx();
  return fresh;
}

// ---------- Compteurs (clips postés, etc.) ----------

const getCounterStmt = db.prepare("SELECT val FROM counters WHERE guild_id = ? AND user_id = ? AND key = ?");
const incrCounterStmt = db.prepare(`
  INSERT INTO counters (guild_id, user_id, key, val) VALUES (@g, @u, @k, @by)
  ON CONFLICT(guild_id, user_id, key) DO UPDATE SET val = val + @by
`);

export function getCounter(guildId, userId, key) {
  return getCounterStmt.get(String(guildId), String(userId), key)?.val ?? 0;
}

export function incrCounter(guildId, userId, key, by = 1) {
  incrCounterStmt.run({ g: String(guildId), u: String(userId), k: key, by });
  return getCounter(guildId, userId, key);
}
