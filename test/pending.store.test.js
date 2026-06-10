import test from "node:test";
import assert from "node:assert/strict";
import { addPending, removePending, loadPending, prunePending } from "../src/pendingStore.js";

test("addPending / loadPending : ajoute et liste par type", () => {
  addPending("profile", "111");
  addPending("profile", "222");
  addPending("search", "Diabolo");
  const profiles = loadPending("profile");
  assert.ok(profiles.includes("111") && profiles.includes("222"));
  assert.deepEqual(loadPending("search"), ["Diabolo"]);
});

test("addPending est idempotent (INSERT OR IGNORE)", () => {
  removePending("profile", "333");
  addPending("profile", "333");
  addPending("profile", "333");
  const count = loadPending("profile").filter((x) => x === "333").length;
  assert.equal(count, 1);
});

test("removePending retire l'élément récupéré", () => {
  addPending("search", "ToRemove");
  removePending("search", "ToRemove");
  assert.ok(!loadPending("search").includes("ToRemove"));
});

test("les types sont indépendants", () => {
  addPending("profile", "shared-key");
  removePending("search", "shared-key"); // ne doit pas toucher le profil
  assert.ok(loadPending("profile").includes("shared-key"));
});

test("prunePending supprime les éléments plus vieux que le seuil", async () => {
  addPending("profile", "old-1");
  addPending("search", "old-2");
  await new Promise((r) => setTimeout(r, 5)); // laisse le temps passer
  prunePending(1); // purge tout ce qui a plus de 1 ms -> nos items
  assert.ok(!loadPending("profile").includes("old-1"));
  assert.ok(!loadPending("search").includes("old-2"));
});
