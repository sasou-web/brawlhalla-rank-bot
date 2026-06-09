import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Couche de persistance SQLite (document store).
 *
 * Les données persistantes du bot (liaisons, XP, réglages, tournoi, configs des modules…)
 * sont stockées dans UNE base `data/bot.db`, table `kv (key, value)` où `value` est du JSON.
 * Ça remplace les anciens `data/*.json` : transactions atomiques (zéro corruption),
 * un seul fichier à sauvegarder, et base requêtable si besoin plus tard.
 *
 * API volontairement simple et SYNCHRONE (better-sqlite3 est synchrone) :
 *   loadDoc(key, fallback) / saveDoc(key, value)
 * Les caches reconstruisibles (profils, recherches, leaderboard) restent en JSON.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const DB_PATH = resolve(DATA_DIR, "bot.db");

// Clé logique -> ancien fichier JSON (pour la migration unique).
const JSON_MIGRATION = {
  links: "links.json",
  settings: "settings.json",
  levels: "levels.json",
  ratings: "ratings.json",
  tiktok: "tiktok.json",
  clips: "clips.json",
  guessrank: "guessrank.json",
  tempvoice: "tempvoice.json",
  welcome: "welcome.json",
  tournament: "tournament.json",
};

mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // robustesse + lectures concurrentes
db.pragma("synchronous = NORMAL");
db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
const setStmt = db.prepare(
  "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

// Migration unique JSON -> SQLite. N'écrase jamais une clé déjà présente en base.
// Les fichiers JSON d'origine sont conservés (renommés .migrated) comme filet de sécurité.
function migrate() {
  for (const [key, file] of Object.entries(JSON_MIGRATION)) {
    if (getStmt.get(key)) continue; // déjà en base
    const p = resolve(DATA_DIR, file);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      JSON.parse(raw); // valide le JSON avant import
      setStmt.run(key, raw);
      try {
        renameSync(p, `${p}.migrated`);
      } catch {
        /* renommage best-effort : la donnée est déjà en base de toute façon */
      }
      console.log(`Migration ${file} -> SQLite (clé "${key}").`);
    } catch (e) {
      console.warn(`Migration de ${file} échouée (laissée en JSON) : ${e.message}`);
    }
  }
}
migrate();
console.log("Base SQLite prête (data/bot.db).");

function clone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

/** Lit un document JSON par clé. Renvoie une copie de `fallback` si absent/illisible. */
export function loadDoc(key, fallback) {
  const row = getStmt.get(key);
  if (!row) return clone(fallback);
  try {
    return JSON.parse(row.value);
  } catch {
    return clone(fallback);
  }
}

/** Écrit (upsert) un document JSON sous une clé. */
export function saveDoc(key, value) {
  setStmt.run(key, JSON.stringify(value));
}
