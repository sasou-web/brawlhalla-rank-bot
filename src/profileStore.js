import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../data/profiles.json");

// Cache persistant des profils joueurs : { [brawlhallaId]: { ts, lastAccess, data } }
let cache = null;
let saveTimer = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(STORE_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") cache = {};
    else throw err;
  }
  return cache;
}

// Ecriture differee (regroupe les rafales d'updates du warmer en une seule sauvegarde).
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(STORE_PATH), { recursive: true });
      await writeFile(STORE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    } catch {
      /* best-effort */
    }
  }, 2000);
}

export async function getProfileEntry(brawlhallaId) {
  const c = await load();
  const entry = c[String(brawlhallaId)];
  if (entry) {
    entry.lastAccess = Date.now();
    scheduleSave();
  }
  return entry ?? null;
}

export async function setProfileEntry(brawlhallaId, data) {
  const c = await load();
  c[String(brawlhallaId)] = { ts: Date.now(), lastAccess: Date.now(), data };
  scheduleSave();
}

// Renvoie les ids des profils a garder chauds (accedes recemment).
export async function getWarmIds(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const c = await load();
  const now = Date.now();
  return Object.keys(c).filter((id) => now - (c[id].lastAccess ?? 0) < maxAgeMs);
}
