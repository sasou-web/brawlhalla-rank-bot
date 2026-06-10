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
// Base par defaut data/bot.db, surchargeable via BOT_DB_PATH (tests isoles).
const DB_PATH = process.env.BOT_DB_PATH ? resolve(process.env.BOT_DB_PATH) : resolve(DATA_DIR, "bot.db");

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

// Tables dediees aux donnees a FORTE ecriture (au lieu de reecrire un gros blob JSON
// a chaque message/refresh). Operations atomiques par ligne, index pour les classements.
db.exec(`
  CREATE TABLE IF NOT EXISTS xp (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    xp       INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    last_ts  INTEGER NOT NULL DEFAULT 0,
    day_key  TEXT NOT NULL DEFAULT '',
    day_xp   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_xp_guild_xp ON xp(guild_id, xp DESC);

  CREATE TABLE IF NOT EXISTS rating_history (
    brawlhalla_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    ts   INTEGER NOT NULL,
    r1   INTEGER NOT NULL DEFAULT 0,
    r2   INTEGER NOT NULL DEFAULT 0,
    lvl  INTEGER NOT NULL DEFAULT 0,
    rank INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (brawlhalla_id, day_key)
  );
  CREATE INDEX IF NOT EXISTS idx_rating_player_ts ON rating_history(brawlhalla_id, ts);

  CREATE TABLE IF NOT EXISTS achievements (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    ach_id   TEXT NOT NULL,
    unlocked_ts INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, ach_id)
  );

  CREATE TABLE IF NOT EXISTS counters (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    key      TEXT NOT NULL,
    val      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, key)
  );
`);

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
console.log(`Base SQLite prête (${DB_PATH}).`);

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

/** Handle SQLite brut (better-sqlite3), pour les modules qui gèrent leurs tables dédiées. */
export { db };

/**
 * Garde de migration unique : renvoie true la PREMIÈRE fois qu'on appelle ce nom,
 * puis false ensuite (le flag est persisté dans la table kv sous "_migrations").
 */
export function runOnce(name) {
  const flags = loadDoc("_migrations", {});
  if (flags[name]) return false;
  flags[name] = true;
  saveDoc("_migrations", flags);
  return true;
}
