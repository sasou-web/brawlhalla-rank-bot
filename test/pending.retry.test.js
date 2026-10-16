import test from "node:test";
import assert from "node:assert/strict";
import { getPlayerProfile, retryPending } from "../src/brawlhalla.js";
import { loadPending } from "../src/pendingStore.js";

/**
 * File de récupération : un ID que l'API dit introuvable n'est pas une panne. Avant, il
 * restait en file (3 requêtes toutes les 30 s pendant 7 jours) et toute la file était
 * retraitée à chaque cycle. On vérifie le plafond par cycle et l'abandon après N 404.
 */

test("retryPending : au plus 5 profils par cycle, abandon des IDs introuvables", async () => {
  const realFetch = globalThis.fetch;
  let playerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/player/")) playerCalls++;
    return new Response("not found", { status: 404 });
  };
  try {
    const ids = Array.from({ length: 8 }, (_, i) => `990000${i}`);
    for (const id of ids) await assert.rejects(getPlayerProfile(id), (err) => err.empty === true);
    const queued = loadPending("profile");
    for (const id of ids) assert.ok(queued.includes(id), `${id} devrait être en file`);

    playerCalls = 0;
    await retryPending();
    assert.ok(playerCalls <= 5 * 4, `au plus 5 profils (4 appels chacun avec le 3v3) par cycle, vu ${playerCalls} appels`);
    // Un seul échec 404 : rien n'est encore abandonné.
    const afterOne = loadPending("profile");
    for (const id of ids) assert.ok(afterOne.includes(id), `${id} abandonné trop tôt`);

    for (let i = 0; i < 40 && ids.some((id) => loadPending("profile").includes(id)); i++) await retryPending();
    const left = loadPending("profile");
    for (const id of ids) assert.ok(!left.includes(id), `${id} toujours en file`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
