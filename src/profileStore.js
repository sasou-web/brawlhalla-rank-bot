import { readFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { db, DATA_DIR, runOnce } from "./db.js";

/**
 * Cache persistant des profils joueurs.
 *
 * Stocké dans la table dédiée `profiles` (clé primaire brawlhalla_id) :
 *   { brawlhalla_id, ts, last_access, data (JSON du profil) }
 * Remplace l'ancien data/profiles.json réécrit en entier (avec debounce 2 s) à chaque
 * accès/refresh : chaque update est désormais un UPSERT atomique O(1), zéro corruption.
 *
 * API conservée IDENTIQUE (async) pour ne rien casser côté brawlhalla.js.
 */

const getStmt = db.prepare("SELECT ts, last_access AS lastAccess, data FROM profiles WHERE brawlhalla_id = ?");
const touchStmt = db.prepare("UPDATE profiles SET last_access = ? WHERE brawlhalla_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO profiles (brawlhalla_id, ts, last_access, data)
  VALUES (@id, @ts, @lastAccess, @data)
  ON CONFLICT(brawlhalla_id) DO UPDATE SET
    ts = excluded.ts, last_access = excluded.last_access, data = excluded.data
`);
const warmStmt = db.prepare("SELECT brawlhalla_id AS id FROM profiles WHERE last_access >= ?");

// ---------- Migration unique : ancien data/profiles.json -> table profiles ----------
migrateFromJson();
function migrateFromJson() {
  if (!runOnce("profilesTable")) return;
  const p = resolve(DATA_DIR, "profiles.json");
  if (!existsSync(p)) return;
  let migrated = 0;
  try {
    const old = JSON.parse(readFileSync(p, "utf-8"));
    const tx = db.transaction(() => {
      for (const [id, entry] of Object.entries(old || {})) {
        if (!entry || typeof entry !== "object" || entry.data === undefined) continue;
        const ts = Number(entry.ts) || Date.now();
        upsertStmt.run({
          id: String(id),
          ts,
          lastAccess: Number(entry.lastAccess) || ts,
          data: JSON.stringify(entry.data),
        });
        migrated++;
      }
    });
    tx();
    try {
      renameSync(p, `${p}.migrated`);
    } catch {
      /* best-effort : la donnée est déjà en base */
    }
    console.log(`Migration profiles.json -> table profiles (${migrated} profil(s)).`);
  } catch (e) {
    console.warn(`Migration de profiles.json échouée (laissée en JSON) : ${e.message}`);
  }
}

export async function getProfileEntry(brawlhallaId) {
  const row = getStmt.get(String(brawlhallaId));
  if (!row) return null;
  const now = Date.now();
  touchStmt.run(now, String(brawlhallaId));
  try {
    return { ts: row.ts, lastAccess: now, data: JSON.parse(row.data) };
  } catch {
    return null;
  }
}

export async function setProfileEntry(brawlhallaId, data) {
  const now = Date.now();
  upsertStmt.run({
    id: String(brawlhallaId),
    ts: now,
    lastAccess: now,
    data: JSON.stringify(data),
  });
}

// Renvoie les ids des profils a garder chauds (accedes recemment).
export async function getWarmIds(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  return warmStmt.all(cutoff).map((r) => r.id);
}
