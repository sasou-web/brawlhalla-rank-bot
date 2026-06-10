import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAchievements, ACHIEVEMENTS } from "../src/achievements.js";

test("aucun accomplissement => aucun succès", () => {
  assert.deepEqual(evaluateAchievements({}), []);
});

test("liaison débloque 'linked'", () => {
  assert.deepEqual(evaluateAchievements({ linked: true }), ["linked"]);
});

test("tier débloque les paliers atteints (cumulatif)", () => {
  const ids = evaluateAchievements({ tier1v1: "Diamond" });
  assert.ok(ids.includes("gold"));
  assert.ok(ids.includes("diamond"));
  assert.ok(!ids.includes("valhallan"));
});

test("le meilleur des deux modes compte pour le tier", () => {
  const ids = evaluateAchievements({ tier1v1: "Silver", tier2v2: "Valhallan" });
  assert.ok(ids.includes("gold"));
  assert.ok(ids.includes("diamond"));
  assert.ok(ids.includes("valhallan"));
});

test("top 100 mondial", () => {
  assert.ok(evaluateAchievements({ globalRank: 50 }).includes("top100"));
  assert.ok(!evaluateAchievements({ globalRank: 0 }).includes("top100"));
  assert.ok(!evaluateAchievements({ globalRank: 200 }).includes("top100"));
});

test("paliers de niveau", () => {
  assert.ok(evaluateAchievements({ level: 10 }).includes("level10"));
  assert.ok(!evaluateAchievements({ level: 10 }).includes("level50"));
  assert.ok(evaluateAchievements({ level: 60 }).includes("level50"));
});

test("paliers de clips", () => {
  assert.ok(evaluateAchievements({ clips: 5 }).includes("clips5"));
  assert.ok(!evaluateAchievements({ clips: 5 }).includes("clips25"));
  assert.ok(evaluateAchievements({ clips: 30 }).includes("clips25"));
});

test("toutes les définitions ont id/name/emoji/test", () => {
  for (const a of ACHIEVEMENTS) {
    assert.equal(typeof a.id, "string");
    assert.equal(typeof a.name, "string");
    assert.equal(typeof a.emoji, "string");
    assert.equal(typeof a.test, "function");
  }
});
