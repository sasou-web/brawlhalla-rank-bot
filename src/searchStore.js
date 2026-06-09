import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../data/searches.json");

// Cache persistant des recherches par pseudo : { [queryLower]: { ts, results } }
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

export async function getSearchEntry(queryLower) {
  const c = await load();
  return c[queryLower] ?? null;
}

export async function setSearchEntry(queryLower, results) {
  const c = await load();
  c[queryLower] = { ts: Date.now(), results };
  scheduleSave();
}
