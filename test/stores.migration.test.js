import test from "node:test";
import assert from "node:assert/strict";

import { getProfileEntry, setProfileEntry, getWarmIds } from "../src/profileStore.js";
import { getSearchEntry, setSearchEntry } from "../src/searchStore.js";
import {
  upsertPlayers,
  markSynced,
  searchLocalPlayers,
  getLocalPlayer,
  getIndexStats,
} from "../src/leaderboardStore.js";

// ---------- profileStore ----------

test("profileStore : set puis get renvoie ts/lastAccess/data", async () => {
  const id = "pf_1";
  await setProfileEntry(id, { name: "Alice", rating: 1500 });
  const entry = await getProfileEntry(id);
  assert.ok(entry);
  assert.deepEqual(entry.data, { name: "Alice", rating: 1500 });
  assert.equal(typeof entry.ts, "number");
  assert.equal(typeof entry.lastAccess, "number");
});

test("profileStore : profil inconnu => null", async () => {
  assert.equal(await getProfileEntry("pf_inconnu"), null);
});

test("profileStore : getWarmIds ne renvoie que les profils récents", async () => {
  const recent = "pf_warm_recent";
  await setProfileEntry(recent, { name: "Bob" });
  const warm = await getWarmIds();
  assert.ok(warm.includes(recent));
  // Une très petite fenêtre exclut un profil dont l'accès date d'avant.
  const none = await getWarmIds(-1);
  assert.equal(none.includes(recent), false);
});

// ---------- searchStore ----------

test("searchStore : set puis get renvoie ts/results", async () => {
  const key = "zoria";
  const results = [{ id: 1, username: "Zoria", rating: 2000 }];
  await setSearchEntry(key, results);
  const entry = await getSearchEntry(key);
  assert.ok(entry);
  assert.deepEqual(entry.results, results);
  assert.equal(typeof entry.ts, "number");
});

test("searchStore : recherche inconnue => null", async () => {
  assert.equal(await getSearchEntry("rien_du_tout"), null);
});

// ---------- leaderboardStore ----------

test("leaderboardStore : upsert + getLocalPlayer", async () => {
  await upsertPlayers([{ id: "lb_1", username: "Hero", tier: "Diamond", rating: 2100, region: "EU" }]);
  const p = await getLocalPlayer("lb_1");
  assert.equal(p.username, "Hero");
  assert.equal(p.rating, 2100);
  assert.equal(p.region, "EU");
});

test("leaderboardStore : recherche exact > prefix > contains, triée par rating", async () => {
  await upsertPlayers([
    { id: "s_exact", username: "Maki", rating: 100 },
    { id: "s_prefix1", username: "Makito", rating: 500 },
    { id: "s_prefix2", username: "Makimura", rating: 900 },
    { id: "s_contains", username: "XxMakixX", rating: 9999 },
  ]);
  const res = await searchLocalPlayers("Maki", 10);
  // Exact d'abord (malgré son rating faible), puis prefix par rating desc, puis contains.
  assert.equal(res[0].username, "Maki");
  assert.equal(res[1].username, "Makimura"); // 900 > 500
  assert.equal(res[2].username, "Makito");
  assert.equal(res[3].username, "XxMakixX");
});

test("leaderboardStore : recherche insensible aux accents/casse", async () => {
  await upsertPlayers([{ id: "acc_1", username: "Élodie", rating: 300 }]);
  const res = await searchLocalPlayers("elodie", 5);
  assert.ok(res.some((p) => p.id === "acc_1"));
});

test("leaderboardStore : jokers LIKE traités littéralement", async () => {
  await upsertPlayers([
    { id: "lk_1", username: "100% Pro", rating: 10 },
    { id: "lk_2", username: "Random", rating: 20 },
  ]);
  const res = await searchLocalPlayers("100%", 10);
  assert.ok(res.some((p) => p.id === "lk_1"));
  assert.equal(res.some((p) => p.id === "lk_2"), false);
});

test("leaderboardStore : getIndexStats reflète markSynced", async () => {
  await upsertPlayers([{ id: "stat_1", username: "Stat", rating: 1 }]);
  await markSynced();
  const stats = await getIndexStats();
  assert.ok(stats.count >= 1);
  assert.ok(stats.syncedAt > 0);
});

test("leaderboardStore : query vide => []", async () => {
  assert.deepEqual(await searchLocalPlayers("   ", 5), []);
});
