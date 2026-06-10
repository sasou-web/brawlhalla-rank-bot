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

const res = spawnSync(process.execPath, ["--test"], {
  stdio: "inherit",
  env: { ...process.env, BOT_DB_PATH: dbPath },
});

try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* nettoyage best-effort */
}

process.exit(res.status ?? 1);
