import { readFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { db, DATA_DIR, loadDoc, saveDoc, runOnce } from "./db.js";

/**
 * Index local des joueurs classes (notre "mini base de donnees" facon Raybot/Corehalla).
 *
 * Stocké dans la table dédiée `leaderboard` (clé primaire brawlhalla_id) au lieu d'un gros
 * data/leaderboard.json (~25k entrées) réécrit en entier à chaque page synchronisée :
 *   { brawlhalla_id, username, norm, tier, rating, region, ts }
 * - `norm` = pseudo normalisé (minuscules, sans accents) : la recherche se fait en SQL
 *   (index sur norm), pas en scannant 25k entrées en mémoire JS.
 * - `syncedAt` (fin de synchro complète) vit dans la table kv via loadDoc/saveDoc.
 *
 * API conservée IDENTIQUE (async).
 */

const SYNCED_KEY = "leaderboardSyncedAt";

const upsertStmt = db.prepare(`
  INSERT INTO leaderboard (brawlhalla_id, username, norm, tier, rating, region, ts)
  VALUES (@id, @username, @norm, @tier, @rating, @region, @ts)
  ON CONFLICT(brawlhalla_id) DO UPDATE SET
    username = excluded.username, norm = excluded.norm, tier = excluded.tier,
    rating = excluded.rating, region = excluded.region, ts = excluded.ts
`);
const upsertMany = db.transaction((rows) => {
  for (const r of rows) upsertStmt.run(r);
});

// Recherche : exact (norm = q) d'abord, puis "commence par", puis "contient" ; chaque
// bucket trié par rating décroissant. WHERE norm LIKE '%q%' capture les 3 buckets, le
// CASE les classe. Reproduit EXACTEMENT l'ancien tri en mémoire.
const searchStmt = db.prepare(`
  SELECT brawlhalla_id AS id, username, tier, rating, region, ts,
    CASE
      WHEN norm = @q THEN 0
      WHEN norm LIKE @prefix ESCAPE '\\' THEN 1
      ELSE 2
    END AS bucket
  FROM leaderboard
  WHERE norm LIKE @contains ESCAPE '\\'
  ORDER BY bucket ASC, rating DESC
  LIMIT @limit
`);
const getStmt = db.prepare(
  "SELECT brawlhalla_id AS id, username, tier, rating, region, ts FROM leaderboard WHERE brawlhalla_id = ?",
);
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM leaderboard");

// Normalise un pseudo pour la comparaison (minuscules, accents retires, espaces compactes).
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Échappe les jokers LIKE (% _ \) pour une recherche littérale (ESCAPE '\').
function escapeLike(s) {
  return s.replace(/[\\%_]/g, "\\$&");
}

// Transforme un joueur entrant en ligne de table (champs normalisés/par défaut).
function toRow(p, now) {
  return {
    id: String(p.id),
    username: p.username ?? "?",
    norm: normalize(p.username ?? "?"),
    tier: p.tier ?? null,
    rating: Math.floor(p.rating ?? 0),
    region: p.region ?? "?",
    ts: now,
  };
}

// ---------- Migration unique : ancien data/leaderboard.json -> table leaderboard ----------
migrateFromJson();
function migrateFromJson() {
  if (!runOnce("leaderboardTable")) return;
  const p = resolve(DATA_DIR, "leaderboard.json");
  if (!existsSync(p)) return;
  let migrated = 0;
  try {
    const old = JSON.parse(readFileSync(p, "utf-8"));
    const players = old?.players && typeof old.players === "object" ? Object.values(old.players) : [];
    const now = Date.now();
    const rows = players
      .filter((pl) => pl?.id != null)
      .map((pl) => ({
        id: String(pl.id),
        username: pl.username ?? "?",
        norm: normalize(pl.username ?? "?"),
        tier: pl.tier ?? null,
        rating: Math.floor(pl.rating ?? 0),
        region: pl.region ?? "?",
        ts: Number(pl.ts) || now,
      }));
    upsertMany(rows);
    migrated = rows.length;
    if (Number(old?.syncedAt)) saveDoc(SYNCED_KEY, Number(old.syncedAt));
    try {
      renameSync(p, `${p}.migrated`);
    } catch {
      /* best-effort */
    }
    console.log(`Migration leaderboard.json -> table leaderboard (${migrated} joueur(s)).`);
  } catch (e) {
    console.warn(`Migration de leaderboard.json échouée (laissée en JSON) : ${e.message}`);
  }
}

/**
 * Ajoute/met a jour une liste de joueurs dans l'index local.
 * Chaque joueur : { id, username, tier, rating, region }.
 */
export async function upsertPlayers(players) {
  if (!players?.length) return;
  const now = Date.now();
  const rows = players.filter((p) => p?.id != null).map((p) => toRow(p, now));
  if (rows.length) upsertMany(rows);
}

// Marque la fin d'une synchro complete du leaderboard.
export async function markSynced() {
  saveDoc(SYNCED_KEY, Date.now());
}

/**
 * Recherche locale par pseudo. Renvoie les joueurs tries :
 * correspondance exacte d'abord, puis "commence par", puis "contient", chacun trie par rating.
 */
export async function searchLocalPlayers(name, limit = 50) {
  const q = normalize(name);
  if (!q) return [];
  const esc = escapeLike(q);
  const rows = searchStmt.all({
    q,
    prefix: `${esc}%`,
    contains: `%${esc}%`,
    limit: Math.max(0, Math.floor(limit)),
  });
  // Retire la colonne technique `bucket` (forme identique à l'ancien store).
  return rows.map(({ bucket, ...p }) => p);
}

// Renvoie un joueur de l'index par son brawlhalla_id (ou null).
export async function getLocalPlayer(brawlhallaId) {
  return getStmt.get(String(brawlhallaId)) ?? null;
}

// Statistiques de l'index (pour /ping et les logs de demarrage).
export async function getIndexStats() {
  return { count: countStmt.get().n, syncedAt: loadDoc(SYNCED_KEY, 0) || 0 };
}
