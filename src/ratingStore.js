import { db, loadDoc, runOnce } from "./db.js";

/**
 * Historique de rating par joueur, pour tracer une courbe de progression.
 *
 * Stocké dans la table dédiée `rating_history` (clé primaire (brawlhalla_id, day_key)) :
 * un point max par jour, mis à jour de façon atomique (UPSERT) au lieu de réécrire un gros
 * blob JSON à chaque refresh. Historique borné à MAX_POINTS jours par joueur.
 *
 * ts ms · r1 rating 1v1 · r2 rating 2v2 · lvl niveau · rank rang mondial 1v1
 */
const MAX_POINTS = 365;

const upsertStmt = db.prepare(`
  INSERT INTO rating_history (brawlhalla_id, day_key, ts, r1, r2, lvl, rank)
  VALUES (@id, @day, @ts, @r1, @r2, @lvl, @rank)
  ON CONFLICT(brawlhalla_id, day_key) DO UPDATE SET
    ts = excluded.ts, r1 = excluded.r1, r2 = excluded.r2, lvl = excluded.lvl, rank = excluded.rank
`);
const historyStmt = db.prepare(
  "SELECT ts, r1, r2, lvl, rank FROM rating_history WHERE brawlhalla_id = ? ORDER BY ts ASC",
);
// Conserve les MAX_POINTS jours les plus récents, supprime le reste.
const pruneStmt = db.prepare(`
  DELETE FROM rating_history
  WHERE brawlhalla_id = @id AND day_key NOT IN (
    SELECT day_key FROM rating_history WHERE brawlhalla_id = @id ORDER BY ts DESC LIMIT @keep
  )
`);

// Jour calendaire (UTC) d'un timestamp, pour dédoublonner par jour.
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------- Migration unique : ancien doc JSON "ratings" -> table rating_history ----------
migrateFromJson();
function migrateFromJson() {
  if (!runOnce("ratingsTable")) return;
  const old = loadDoc("ratings", null);
  if (!old || typeof old !== "object") return;
  let migrated = 0;
  const tx = db.transaction(() => {
    for (const [id, points] of Object.entries(old)) {
      if (!Array.isArray(points)) continue;
      for (const p of points) {
        if (!p || typeof p.ts !== "number") continue;
        upsertStmt.run({
          id: String(id),
          day: dayKey(p.ts),
          ts: p.ts,
          r1: Math.floor(p.r1 || 0),
          r2: Math.floor(p.r2 || 0),
          lvl: Math.floor(p.lvl || 0),
          rank: Math.floor(p.rank || 0),
        });
        migrated++;
      }
    }
  });
  tx();
  if (migrated) console.log(`Migration ratings -> table rating_history (${migrated} point(s)).`);
}

/**
 * Enregistre un point de rating pour un joueur. Remplace le point du jour s'il existe déjà.
 * N'écrit rien si le rating 1v1 ET 2v2 sont nuls (joueur non classé / donnée partielle).
 */
export async function recordRating(brawlhallaId, { rating1v1 = 0, rating2v2 = 0, level = 0, globalRank = 0 } = {}) {
  const r1 = Math.max(0, Math.floor(rating1v1 || 0));
  const r2 = Math.max(0, Math.floor(rating2v2 || 0));
  if (r1 === 0 && r2 === 0) return; // rien d'utile à tracer

  const id = String(brawlhallaId);
  const now = Date.now();
  upsertStmt.run({
    id,
    day: dayKey(now),
    ts: now,
    r1,
    r2,
    lvl: Math.floor(level || 0),
    rank: Math.floor(globalRank || 0),
  });
  pruneStmt.run({ id, keep: MAX_POINTS });
}

/**
 * Renvoie l'historique d'un joueur (tableau de points, du plus ancien au plus récent).
 */
export async function getRatingHistory(brawlhallaId) {
  return historyStmt.all(String(brawlhallaId));
}
