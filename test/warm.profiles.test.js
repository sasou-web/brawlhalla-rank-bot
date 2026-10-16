import test from "node:test";
import assert from "node:assert/strict";
import { warmProfiles } from "../src/brawlhalla.js";
import { setProfileEntry } from "../src/profileStore.js";
import { setLink, removeLink } from "../src/store.js";

/**
 * Warm des profils : les membres liés sont déjà rafraîchis par le refresh des rôles, ils
 * ne doivent pas l'être une seconde fois ; deux cycles ne doivent jamais se superposer.
 */

test("warmProfiles : exclut les IDs liés et ignore un cycle qui chevauche", async () => {
  const realFetch = globalThis.fetch;
  const fetchedIds = new Set();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url) => {
    fetchedIds.add(new URL(String(url)).searchParams.get("brawlhalla_id"));
    await gate;
    return new Response("not found", { status: 404 });
  };
  try {
    await setProfileEntry("88000001", { name: "Lié" });
    await setProfileEntry("88000002", { name: "Consulté" });
    await setLink("warm-user", 88000001, "Lié");

    const first = warmProfiles();
    const second = await warmProfiles(); // le premier cycle est bloqué sur le fetch
    assert.equal(second.skipped, true);

    release();
    const r = await first;
    assert.ok(r.total >= 1 && r.total <= 50);
    assert.ok(fetchedIds.has("88000002"), "le profil consulté est rafraîchi");
    assert.equal(fetchedIds.has("88000001"), false, "le profil lié est laissé au refresh des rôles");
  } finally {
    globalThis.fetch = realFetch;
    await removeLink("warm-user");
  }
});
