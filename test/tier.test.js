import test from "node:test";
import assert from "node:assert/strict";

// config.js exige ces variables au chargement : on les fixe en factice pour les tests.
process.env.DISCORD_TOKEN ||= "test";
process.env.CLIENT_ID ||= "test";
process.env.GUILD_ID ||= "test";

const { baseTier, tierFromRating, resolveBaseTier } = await import("../src/brawlhalla.js");
const { tierIndex, highestTier } = await import("../src/config.js");

test("baseTier extrait le tier de base", () => {
  assert.equal(baseTier("Gold 4"), "Gold");
  assert.equal(baseTier("Diamond"), "Diamond");
  assert.equal(baseTier("Inconnu"), null);
  assert.equal(baseTier(null), null);
});

test("tierFromRating respecte les seuils", () => {
  assert.equal(tierFromRating(2100), "Diamond"); // >= 2000
  assert.equal(baseTier(tierFromRating(1700)), "Platinum");
  assert.equal(baseTier(tierFromRating(750)), "Tin");
});

test("resolveBaseTier : non classé, Valhallan, et tier fourni", () => {
  assert.equal(resolveBaseTier(0, null), null);
  assert.equal(resolveBaseTier(-5, "Gold 1"), null);
  assert.equal(resolveBaseTier(2500, null), "Valhallan"); // tier vide + gros rating
  assert.equal(resolveBaseTier(1700, "Platinum 1"), "Platinum");
  assert.equal(resolveBaseTier(1300, "Silver 5"), "Silver");
});

test("tierIndex ordonne du plus bas au plus haut", () => {
  assert.equal(tierIndex("Tin"), 0);
  assert.equal(tierIndex("Valhallan"), 6);
  assert.equal(tierIndex(null), -1);
  assert.ok(tierIndex("Diamond") > tierIndex("Gold"));
});

test("highestTier renvoie le meilleur des deux modes", () => {
  assert.equal(highestTier({ "1v1": "Gold", "2v2": "Diamond" }), "Diamond");
  assert.equal(highestTier({ "1v1": "Bronze", "2v2": null }), "Bronze");
  assert.equal(highestTier({}), null);
});
