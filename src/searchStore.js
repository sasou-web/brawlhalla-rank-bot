import { readFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { db, DATA_DIR, runOnce } from "./db.js";

/**
 * Cache persistant des recherches par pseudo.
 *
 * Stocké dans la table dédiée `searches` (clé primaire query) :
 *   { query, ts, results (JSON du tableau de joueurs) }
 * Remplace l'ancien data/searches.json réécrit en entier : chaque mise en cache est un
 * UPSERT atomique au lieu d'un gros blob réécrit avec debounce.
 *
 * API conservée IDENTIQUE (async).
 */

const getStmt = db.prepare("SELECT ts, results FROM searches WHERE query = ?");
const upsertStmt = db.prepare(`
  INSERT INTO searches (query, ts, results) VALUES (@query, @ts, @results)
  ON CONFLICT(query) DO UPDATE SET ts = excluded.ts, results = excluded.results
`);

// ---------- Migration unique : ancien data/searches.json -> table searches ----------
migrateFromJson();
function migrateFromJson() {
  const p = resolve(DATA_DIR, "searches.json");
  let migrated = null;
  try {
    // Un échec annule tout, drapeau compris (voir runOnce) : nouvel essai au prochain démarrage.
    runOnce("searchesTable", () => {
      if (!existsSync(p)) return;
      const old = JSON.parse(readFileSync(p, "utf-8"));
      let n = 0;
      for (const [query, entry] of Object.entries(old || {})) {
        if (!entry || !Array.isArray(entry.results)) continue;
        upsertStmt.run({
          query,
          ts: Number(entry.ts) || Date.now(),
          results: JSON.stringify(entry.results),
        });
        n++;
      }
      migrated = n;
    });
  } catch (e) {
    console.warn(`Migration de searches.json échouée (laissée en JSON, nouvel essai au prochain démarrage) : ${e.message}`);
    return;
  }
  if (migrated === null) return;
  try {
    renameSync(p, `${p}.migrated`);
  } catch {
    /* best-effort */
  }
  console.log(`Migration searches.json -> table searches (${migrated} recherche(s)).`);
}

export async function getSearchEntry(queryLower) {
  const row = getStmt.get(queryLower);
  if (!row) return null;
  try {
    return { ts: row.ts, results: JSON.parse(row.results) };
  } catch {
    return null;
  }
}

export async function setSearchEntry(queryLower, results) {
  upsertStmt.run({ query: queryLower, ts: Date.now(), results: JSON.stringify(results) });
}
