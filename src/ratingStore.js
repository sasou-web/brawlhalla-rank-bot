import { loadDoc, saveDoc } from "./db.js";

const KEY = "ratings";

/**
 * Historique de rating par joueur, pour tracer une courbe de progression.
 * Persisté dans SQLite (clé "ratings"). Structure : { [brawlhallaId]: [ { ts, r1, r2, lvl, rank } ] }
 *   ts ms · r1 rating 1v1 · r2 rating 2v2 · lvl niveau · rank rang mondial 1v1
 * Un point max par jour, historique borné à MAX_POINTS.
 */
const MAX_POINTS = 365;

let cache = null;

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, {});
  return cache;
}

function save() {
  saveDoc(KEY, cache);
}

// Jour calendaire (UTC) d'un timestamp, pour dedoublonner par jour.
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Enregistre un point de rating pour un joueur. Remplace le point du jour s'il existe deja.
 * N'ecrit rien si le rating 1v1 ET 2v2 sont nuls (joueur non classe / donnee partielle).
 */
export async function recordRating(brawlhallaId, { rating1v1 = 0, rating2v2 = 0, level = 0, globalRank = 0 } = {}) {
  const r1 = Math.max(0, Math.floor(rating1v1 || 0));
  const r2 = Math.max(0, Math.floor(rating2v2 || 0));
  if (r1 === 0 && r2 === 0) return; // rien d'utile a tracer

  const c = await load();
  const key = String(brawlhallaId);
  const list = c[key] ?? (c[key] = []);
  const now = Date.now();
  const point = { ts: now, r1, r2, lvl: Math.floor(level || 0), rank: Math.floor(globalRank || 0) };

  const last = list[list.length - 1];
  if (last && dayKey(last.ts) === dayKey(now)) {
    list[list.length - 1] = point; // un seul point par jour : on garde le plus recent
  } else {
    list.push(point);
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
  }
  await save();
}

/**
 * Renvoie l'historique d'un joueur (tableau de points, du plus ancien au plus recent).
 */
export async function getRatingHistory(brawlhallaId) {
  const c = await load();
  return c[String(brawlhallaId)] ?? [];
}
