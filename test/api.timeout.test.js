import test from "node:test";
import assert from "node:assert/strict";
import { getRankings, pingApi } from "../src/brawlhalla.js";

// Sans délai max, une connexion muette tenait un slot du limiteur jusqu'à 5 min (undici).
test("chaque requête vers l'API Brawlhalla porte un délai max (AbortSignal)", async () => {
  const realFetch = globalThis.fetch;
  const signals = [];
  globalThis.fetch = async (_url, opts = {}) => {
    signals.push(opts.signal);
    return new Response(JSON.stringify({ rankings: [] }), { status: 200 });
  };
  try {
    await getRankings("1v1", "ALL", 1, 10);
    await pingApi();
    assert.equal(signals.length, 3);
    for (const s of signals) assert.ok(s instanceof AbortSignal && !s.aborted);
  } finally {
    globalThis.fetch = realFetch;
  }
});
