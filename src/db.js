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
 * Les caches reconstruisibles (profils, recherches, leaderboard) ont aussi migré en SQLite,
 * dans des tables dédiées (écritures atomiques par ligne, plus de gros blob JSON réécrit).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// Base par defaut data/bot.db, surchargeable via BOT_DB_PATH (tests isoles).
const DB_PATH = process.env.BOT_DB_PATH ? resolve(process.env.BOT_DB_PATH) : resolve(__dirname, "../data/bot.db");
// Le dossier de données suit TOUJOURS l'emplacement de la base : en test (BOT_DB_PATH ->
// dossier temporaire) aucun JSON réel n'est lu/renommé, donc zéro pollution des data/ réelles.
const DATA_DIR = dirname(DB_PATH);

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
// Attend (jusqu'a 5s) si la base est momentanement verrouillee au lieu d'echouer
// immediatement ("database is locked"). Utile quand plusieurs process ouvrent la meme base
// (ex: fichiers de test en parallele, ou un script ponctuel pendant que le bot tourne).
db.pragma("busy_timeout = 5000");
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

  -- Cache des profils joueurs (anciennement data/profiles.json). 'data' = JSON du profil.
  CREATE TABLE IF NOT EXISTS profiles (
    brawlhalla_id TEXT PRIMARY KEY,
    ts            INTEGER NOT NULL,
    last_access   INTEGER NOT NULL,
    data          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_access ON profiles(last_access);

  -- Cache des recherches par pseudo (anciennement data/searches.json). 'results' = JSON.
  CREATE TABLE IF NOT EXISTS searches (
    query   TEXT PRIMARY KEY,
    ts      INTEGER NOT NULL,
    results TEXT NOT NULL
  );

  -- Index local des joueurs classes (anciennement data/leaderboard.json). 'norm' = pseudo
  -- normalise (minuscules/sans accents) pour la recherche; index sur norm et rating.
  CREATE TABLE IF NOT EXISTS leaderboard (
    brawlhalla_id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '?',
    norm     TEXT NOT NULL DEFAULT '',
    tier     TEXT,
    rating   INTEGER NOT NULL DEFAULT 0,
    region   TEXT,
    ts       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_leaderboard_norm ON leaderboard(norm);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_rating ON leaderboard(rating DESC);
`);

// ---------- Évolution du schéma (PRAGMA user_version) ----------
// `CREATE TABLE IF NOT EXISTS` ne touche JAMAIS une table existante : une colonne ajoutée
// dans un CREATE (ici ou dans un module) n'existe pas sur la base de prod, et le premier
// `db.prepare` qui l'utilise fait planter le bot au démarrage. Toute évolution d'une table
// existante = mettre à jour son CREATE (bases neuves) ET ajouter une étape À LA FIN de cette
// liste (une étape déployée ne se modifie ni ne se réordonne plus). L'étape i amène la base
// à user_version = i + 1. Exemple :
//   (d) => addColumn(d, "xp", "streak INTEGER NOT NULL DEFAULT 0"),
const SCHEMA_STEPS = [];

/**
 * Ajoute une colonne si elle manque. Idempotent : sans effet si elle existe déjà (base neuve,
 * dont le CREATE l'a) ou si la table n'existe pas encore (elle sera créée plus tard par son
 * module, avec la colonne dans son CREATE).
 */
export function addColumn(database, table, columnDef) {
  const cols = database.pragma(`table_info(${table})`);
  if (!cols.length) return;
  const name = columnDef.trim().split(/\s+/)[0];
  if (cols.some((c) => c.name === name)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
}

/**
 * Applique les étapes de schéma manquantes, chacune dans une transaction avec sa montée de
 * user_version : une étape en échec est annulée en entier et rejouée au démarrage suivant.
 * Renvoie la version finale.
 */
export function migrateSchema(database, steps) {
  let version = database.pragma("user_version", { simple: true });
  if (version > steps.length) {
    console.warn(`Schéma de la base en v${version}, plus récent que ce code (v${steps.length}) : retour à une version antérieure ?`);
  }
  while (version < steps.length) {
    const next = version + 1;
    database.transaction(() => {
      steps[next - 1](database);
      database.pragma(`user_version = ${next}`);
    })();
    version = next;
    console.log(`Schéma de la base migré en v${version}.`);
  }
  return version;
}
migrateSchema(db, SCHEMA_STEPS);

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

/** Dossier des données (= dossier de la base). Sert aux migrations de fichiers JSON hérités. */
export { DATA_DIR };

/**
 * Ferme proprement la base : checkpoint du WAL (pour ne rien laisser dans le -wal) puis close.
 * À appeler lors d'un arrêt maîtrisé (SIGINT/SIGTERM). Idempotent / best-effort.
 */
export function closeDb() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* best-effort */
  }
  try {
    db.close();
  } catch {
    /* best-effort */
  }
}

/**
 * Migration de données unique : exécute `fn` (SYNCHRONE) puis pose le drapeau `name` (kv
 * "_migrations"), le tout dans UNE transaction. Si `fn` lève, rien n'est conservé, drapeau
 * compris : l'erreur remonte à l'appelant et la migration est rejouée au démarrage suivant
 * (posé avant le travail, le drapeau faisait perdre pour toujours une migration en échec).
 * Renvoie true si la migration vient de tourner, false si elle était déjà faite.
 */
export function runOnce(name, fn) {
  return db.transaction(() => {
    if (loadDoc("_migrations", {})[name]) return false;
    fn();
    saveDoc("_migrations", { ...loadDoc("_migrations", {}), [name]: true });
    return true;
  })();
}
