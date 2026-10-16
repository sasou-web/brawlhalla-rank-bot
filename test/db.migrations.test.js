import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runOnce, loadDoc, saveDoc, migrateSchema, addColumn } from "../src/db.js";

// ---------- runOnce : migrations de données uniques ----------

test("runOnce : exécute le travail une seule fois", () => {
  let calls = 0;
  assert.equal(runOnce("test_once_ok", () => calls++), true);
  assert.equal(runOnce("test_once_ok", () => calls++), false);
  assert.equal(calls, 1);
  assert.equal(loadDoc("_migrations", {}).test_once_ok, true);
});

test("runOnce : un échec annule le travail ET le drapeau, la migration est rejouée", () => {
  assert.throws(
    () =>
      runOnce("test_once_fail", () => {
        saveDoc("test_once_partial", { ecrit: true });
        throw new Error("donnée mal formée");
      }),
    /donnée mal formée/,
  );
  assert.equal(loadDoc("test_once_partial", null), null); // écriture partielle annulée
  assert.equal(loadDoc("_migrations", {}).test_once_fail, undefined);

  let replayed = false;
  assert.equal(runOnce("test_once_fail", () => (replayed = true)), true);
  assert.equal(replayed, true);
});

test("runOnce : les drapeaux des autres migrations sont conservés", () => {
  runOnce("test_once_a", () => {});
  runOnce("test_once_b", () => {});
  const flags = loadDoc("_migrations", {});
  assert.equal(flags.test_once_a, true);
  assert.equal(flags.test_once_b, true);
});

// ---------- migrateSchema / addColumn : évolution du schéma (base en mémoire) ----------

test("migrateSchema : applique les étapes manquantes une seule fois, user_version suit", () => {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE xp (user_id TEXT PRIMARY KEY, xp INTEGER NOT NULL DEFAULT 0)");
  d.prepare("INSERT INTO xp (user_id, xp) VALUES ('u1', 42)").run();
  const steps = [(db) => addColumn(db, "xp", "streak INTEGER NOT NULL DEFAULT 0")];

  assert.equal(migrateSchema(d, steps), 1);
  assert.equal(d.pragma("user_version", { simple: true }), 1);
  assert.deepEqual(d.prepare("SELECT xp, streak FROM xp WHERE user_id = 'u1'").get(), { xp: 42, streak: 0 });

  let again = 0;
  assert.equal(migrateSchema(d, [() => again++]), 1); // déjà en v1 : rien n'est rejoué
  assert.equal(again, 0);
  d.close();
});

test("migrateSchema : une étape en échec est annulée en entier, les précédentes restent", () => {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE t (a INTEGER)");
  const steps = [
    (db) => addColumn(db, "t", "b INTEGER"),
    (db) => {
      addColumn(db, "t", "c INTEGER");
      throw new Error("étape 2 cassée");
    },
  ];
  assert.throws(() => migrateSchema(d, steps), /étape 2 cassée/);
  assert.equal(d.pragma("user_version", { simple: true }), 1);
  const cols = d.pragma("table_info(t)").map((c) => c.name);
  assert.deepEqual(cols, ["a", "b"]); // la colonne c de l'étape annulée n'existe pas
  d.close();
});

test("migrateSchema : liste vide (état actuel) = aucun effet sur la base", () => {
  const d = new Database(":memory:");
  assert.equal(migrateSchema(d, []), 0);
  assert.equal(d.pragma("user_version", { simple: true }), 0);
  d.close();
});

test("addColumn : idempotent, et sans effet si la table n'existe pas encore", () => {
  const d = new Database(":memory:");
  addColumn(d, "absente", "x INTEGER"); // créée plus tard par son module : pas d'erreur
  d.exec("CREATE TABLE t (a INTEGER, b TEXT NOT NULL DEFAULT '')");
  addColumn(d, "t", "b TEXT NOT NULL DEFAULT ''"); // déjà là (base neuve)
  addColumn(d, "t", "c INTEGER");
  addColumn(d, "t", "c INTEGER");
  assert.deepEqual(d.pragma("table_info(t)").map((c) => c.name), ["a", "b", "c"]);
  d.close();
});
