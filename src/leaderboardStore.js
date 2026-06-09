import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../data/leaderboard.json");

// Index local des joueurs classes (notre "mini base de donnees" facon Raybot/Corehalla).
// Structure : { syncedAt, players: { [brawlhallaId]: { id, username, tier, rating, region, ts } } }
// Permet une recherche INSTANTANEE par pseudo, sans dependre de l'API officielle (lente/502).
let cache = null;
let saveTimer = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(STORE_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") cache = { syncedAt: 0, players: {} };
    else throw err;
  }
  if (!cache.players) cache.players = {};
  return cache;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(STORE_PATH), { recursive: true });
      await writeFile(STORE_PATH, JSON.stringify(cache), "utf-8");
    } catch {
      /* best-effort */
    }
  }, 2000);
}

// Normalise un pseudo pour la comparaison (minuscules, accents retires, espaces compactes).
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ajoute/met a jour une liste de joueurs dans l'index local.
 * Chaque joueur : { id, username, tier, rating, region }.
 */
export async function upsertPlayers(players) {
  if (!players?.length) return;
  const c = await load();
  const now = Date.now();
  for (const p of players) {
    if (!p?.id) continue;
    c.players[String(p.id)] = {
      id: p.id,
      username: p.username ?? "?",
      tier: p.tier ?? null,
      rating: p.rating ?? 0,
      region: p.region ?? "?",
      ts: now,
    };
  }
  scheduleSave();
}

// Marque la fin d'une synchro complete du leaderboard.
export async function markSynced() {
  const c = await load();
  c.syncedAt = Date.now();
  scheduleSave();
}

/**
 * Recherche locale par pseudo. Renvoie les joueurs tries :
 * correspondance exacte d'abord, puis "commence par", puis "contient", chacun trie par rating.
 */
export async function searchLocalPlayers(name, limit = 50) {
  const c = await load();
  const q = normalize(name);
  if (!q) return [];

  const exact = [];
  const prefix = [];
  const contains = [];
  for (const p of Object.values(c.players)) {
    const u = normalize(p.username);
    if (u === q) exact.push(p);
    else if (u.startsWith(q)) prefix.push(p);
    else if (u.includes(q)) contains.push(p);
  }
  const byRating = (a, b) => (b.rating ?? 0) - (a.rating ?? 0);
  exact.sort(byRating);
  prefix.sort(byRating);
  contains.sort(byRating);
  return [...exact, ...prefix, ...contains].slice(0, limit);
}

// Renvoie un joueur de l'index par son brawlhalla_id (ou null).
export async function getLocalPlayer(brawlhallaId) {
  const c = await load();
  return c.players[String(brawlhallaId)] ?? null;
}

// Statistiques de l'index (pour /ping et les logs de demarrage).
export async function getIndexStats() {
  const c = await load();
  return { count: Object.keys(c.players).length, syncedAt: c.syncedAt || 0 };
}
