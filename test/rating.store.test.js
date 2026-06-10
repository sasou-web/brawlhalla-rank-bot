import test from "node:test";
import assert from "node:assert/strict";
import { recordRating, getRatingHistory } from "../src/ratingStore.js";

test("recordRating enregistre un point lisible", async () => {
  const id = "rt_player_1";
  await recordRating(id, { rating1v1: 1500, rating2v2: 1400, level: 42, globalRank: 7 });
  const hist = await getRatingHistory(id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].r1, 1500);
  assert.equal(hist[0].r2, 1400);
  assert.equal(hist[0].lvl, 42);
  assert.equal(hist[0].rank, 7);
  assert.equal(typeof hist[0].ts, "number");
});

test("un seul point par jour : le second écrasement met à jour", async () => {
  const id = "rt_player_2";
  await recordRating(id, { rating1v1: 1500 });
  await recordRating(id, { rating1v1: 1600 });
  const hist = await getRatingHistory(id);
  assert.equal(hist.length, 1); // même jour -> dédupliqué
  assert.equal(hist[0].r1, 1600); // valeur la plus récente
});

test("ignore les profils non classés (1v1 et 2v2 à 0)", async () => {
  const id = "rt_player_3";
  await recordRating(id, { rating1v1: 0, rating2v2: 0, level: 10 });
  const hist = await getRatingHistory(id);
  assert.equal(hist.length, 0);
});

test("historique vide pour un joueur inconnu", async () => {
  const hist = await getRatingHistory("rt_inconnu");
  assert.deepEqual(hist, []);
});
