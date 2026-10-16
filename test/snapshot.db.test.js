import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotDb, snapshotsToPrune, KEEP } from "../scripts/snapshot-db.js";

// Instantané pris par update.sh avant une mise à jour (scripts/snapshot-db.js).
// Tout se passe dans un dossier temporaire : ni data/bot.db ni backups/ ne sont touchés.

test("snapshotsToPrune : garde les KEEP plus récents, ignore les autres fichiers", () => {
  const names = [
    "README",
    "bot_2026-01-01_04-00-00.db.gz",
    ...Array.from({ length: 8 }, (_, i) => `pre-update_2026-01-0${i + 1}_10-00-00_abc${i}.db`),
  ];
  const pruned = snapshotsToPrune(names, KEEP);
  assert.equal(pruned.length, 8 - KEEP);
  assert.deepEqual(pruned.sort(), [
    "pre-update_2026-01-01_10-00-00_abc0.db",
    "pre-update_2026-01-02_10-00-00_abc1.db",
    "pre-update_2026-01-03_10-00-00_abc2.db",
  ]);
  assert.deepEqual(snapshotsToPrune(["README", "bot_x.db.gz"]), []);
});

test("snapshotDb : copie cohérente d'une base WAL ouverte, puis rotation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xk-snapshot-"));
  let live;
  try {
    const src = join(dir, "bot.db");
    const out = join(dir, "backups");
    // Base « live » laissée ouverte, en WAL, avec des écritures non checkpointées (le bot tourne).
    live = new Database(src);
    live.pragma("journal_mode = WAL");
    live.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    live.prepare("INSERT INTO kv VALUES (?, ?)").run("links", '{"1":"2"}');

    const dest = await snapshotDb({ src, dir: out, label: "abc1234", now: new Date(2026, 0, 2, 3, 4, 5) });
    assert.equal(dest, join(out, "pre-update_2026-01-02_03-04-05_abc1234.db"));
    const copy = new Database(dest, { readonly: true, fileMustExist: true });
    assert.equal(copy.prepare("SELECT value FROM kv WHERE key = 'links'").get().value, '{"1":"2"}');
    // Fichier autonome : pas de mode WAL hérité (sinon -wal/-shm orphelins après rotation).
    assert.equal(copy.pragma("journal_mode", { simple: true }), "delete");
    copy.close();

    // Un fichier étranger dans backups/ ne doit jamais être supprimé par la rotation.
    writeFileSync(join(out, "bot_2026-01-01_04-00-00.db.gz"), "");
    for (let d = 3; d <= 9; d++) await snapshotDb({ src, dir: out, now: new Date(2026, 0, d) });
    const left = readdirSync(out).filter((n) => n.startsWith("pre-update_"));
    assert.equal(left.length, KEEP);
    assert.ok(left.includes("pre-update_2026-01-09_00-00-00.db"));
    assert.ok(!left.includes("pre-update_2026-01-02_03-04-05_abc1234.db"));
    assert.ok(existsSync(join(out, "bot_2026-01-01_04-00-00.db.gz")));
  } finally {
    live?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshotDb : sans base, ne crée rien et renvoie null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xk-snapshot-"));
  try {
    const out = join(dir, "backups");
    assert.equal(await snapshotDb({ src: join(dir, "absente.db"), dir: out }), null);
    assert.equal(existsSync(out), false);
    assert.equal(existsSync(join(dir, "absente.db")), false); // pas de base vide créée
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
