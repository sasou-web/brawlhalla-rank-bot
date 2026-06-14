// Runner de tests : exécute `node --test` sur une base SQLite TEMPORAIRE et isolée
// (via BOT_DB_PATH), pour ne jamais toucher data/bot.db pendant les tests.
// (Nommé run-tests.js et non test.js pour ne pas être ramassé par le pattern de
//  découverte de `node --test`, ce qui provoquerait une récursion.)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "bhbot-test-"));
const dbPath = join(dir, "test.db");

// Les modules importent config.js, qui exige DISCORD_TOKEN/CLIENT_ID/GUILD_ID dès
// l'import (fail-fast au démarrage du bot). En CI (ou sans .env), ces variables sont
// absentes et l'import des tests planterait. On injecte des valeurs factices UNIQUEMENT
// pour les tests si elles ne sont pas déjà définies : la garde stricte reste active en prod.
const TEST_ENV_DEFAULTS = {
  DISCORD_TOKEN: "test-token",
  CLIENT_ID: "0",
  GUILD_ID: "0",
};
const env = { ...process.env, BOT_DB_PATH: dbPath };
for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!env[k]) env[k] = v;
}

// --test-concurrency=1 : execute les fichiers de test UN PAR UN. Ils partagent la meme base
// temporaire (BOT_DB_PATH) ; en parallele, plusieurs process ouvraient la base et lancaient
// le PRAGMA WAL simultanement -> "database is locked" intermittent. La serialisation supprime
// cette contention (les tests restent tres rapides). Le busy_timeout de db.js est un filet en plus.
const res = spawnSync(process.execPath, ["--test", "--test-concurrency=1"], {
  stdio: "inherit",
  env,
});

try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* nettoyage best-effort */
}

process.exit(res.status ?? 1);
