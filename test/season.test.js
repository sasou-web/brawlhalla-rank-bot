import test from "node:test";
import assert from "node:assert/strict";
import { seasonRewardTier } from "../src/season.js";

test("seasonRewardTier : récompense le pic de la saison, pas le tier du jour", () => {
  // Diamond en milieu de saison, termine Platinum : badge Diamond.
  assert.equal(seasonRewardTier({ "1v1": "Platinum", "2v2": "Gold" }, { "1v1": "Diamond", "2v2": "Gold" }), "Diamond");
  // Tier courant au-dessus du pic connu (ex. Valhallan, non déductible du rating seul).
  assert.equal(seasonRewardTier({ "1v1": "Valhallan" }, { "1v1": "Diamond" }), "Valhallan");
});

test("seasonRewardTier : sans pic enregistré, repli sur le tier courant", () => {
  assert.equal(seasonRewardTier({ "1v1": "Gold", "2v2": "Silver" }), "Gold");
  assert.equal(seasonRewardTier({ "1v1": null, "2v2": "Silver" }, undefined), "Silver");
  assert.equal(seasonRewardTier(null, null), null);
});
