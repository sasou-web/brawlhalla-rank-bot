import test from "node:test";
import assert from "node:assert/strict";
import {
  gloryFromWins,
  gloryFromBestRating,
  estimateGlory,
  planLeaderboardSync,
} from "../src/brawlhalla.js";

test("gloryFromWins : 20/victoire jusqu'à 150, puis formule log", () => {
  assert.equal(gloryFromWins(0), 0);
  assert.equal(gloryFromWins(100), 2000);
  assert.equal(gloryFromWins(150), 3000);
  assert.ok(gloryFromWins(300) > gloryFromWins(150)); // croissant au-delà du seuil
});

test("gloryFromBestRating : palier bas = 250", () => {
  assert.equal(gloryFromBestRating(1000), 250);
  assert.equal(gloryFromBestRating(0), 250);
  // Monotonie générale entre paliers.
  assert.ok(gloryFromBestRating(2000) > gloryFromBestRating(1500));
});

test("estimateGlory : agrège 1v1 + équipes et combine wins/rating", () => {
  const profile = {
    peak1v1: 1500,
    legendsRanked: [{ games: 20, wins: 12, peak_rating: 1500 }],
    teams: [{ games: 5, wins: 3, peak_rating: 1400 }],
  };
  const g = estimateGlory(profile);
  assert.equal(g.totalGames, 25);
  assert.equal(g.totalWins, 15);
  assert.equal(g.bestRating, 1500);
  assert.equal(g.totalGlory, gloryFromWins(15) + gloryFromBestRating(1500));
});

test("estimateGlory : null en dessous de 10 games classées", () => {
  const profile = {
    peak1v1: 1000,
    legendsRanked: [{ games: 3, wins: 1, peak_rating: 1000 }],
    teams: [],
  };
  assert.equal(estimateGlory(profile), null);
});

test("planLeaderboardSync : pages chaudes + rotation profonde", () => {
  const a = planLeaderboardSync({ maxPages: 5, shallowPages: 2, deepChunk: 2, knownMaxPage: 0, deepCursor: 0 });
  assert.deepEqual(a.pages, [1, 2, 3, 4]);
  assert.equal(a.nextCursor, 2);

  // Cycle suivant : reprend la rotation et boucle pour couvrir le reste.
  const b = planLeaderboardSync({ maxPages: 5, shallowPages: 2, deepChunk: 2, knownMaxPage: 0, deepCursor: a.nextCursor });
  assert.deepEqual(b.pages, [1, 2, 5, 3]);
  // Union des pages profondes sur 2 cycles = couverture complète {3,4,5}.
  const deep = new Set([...a.pages.slice(2), ...b.pages.slice(2)]);
  assert.deepEqual([...deep].sort((x, y) => x - y), [3, 4, 5]);
});

test("planLeaderboardSync : sans bloc profond, seulement les pages chaudes", () => {
  const r = planLeaderboardSync({ maxPages: 5, shallowPages: 2, deepChunk: 0, knownMaxPage: 0, deepCursor: 0 });
  assert.deepEqual(r.pages, [1, 2]);
});

test("planLeaderboardSync : knownMaxPage borne la zone profonde", () => {
  const r = planLeaderboardSync({ maxPages: 500, shallowPages: 2, deepChunk: 10, knownMaxPage: 3, deepCursor: 0 });
  assert.deepEqual(r.pages, [1, 2, 3]); // cap=3 -> une seule page profonde
});

test("planLeaderboardSync : shallow >= total => pas de zone profonde", () => {
  const r = planLeaderboardSync({ maxPages: 2, shallowPages: 5, deepChunk: 10, knownMaxPage: 0, deepCursor: 0 });
  assert.deepEqual(r.pages, [1, 2]);
});

import { mapRankingEntry, buildPlayerProfile } from "../src/brawlhalla.js";

test("mapRankingEntry : forme imbriquée (players[0])", () => {
  const r = { tier: "Gold 2", rating: 1500, region: "EU", players: [{ id: 42, username: "Neo" }] };
  assert.deepEqual(mapRankingEntry(r), { id: 42, username: "Neo", tier: "Gold 2", rating: 1500, region: "EU" });
});

test("mapRankingEntry : forme à plat (brawlhalla_id / name)", () => {
  const r = { brawlhalla_id: 7, name: "Flat", tier: "Silver 1", rating: 1130, region: "US-E" };
  assert.deepEqual(mapRankingEntry(r), { id: 7, username: "Flat", tier: "Silver 1", rating: 1130, region: "US-E" });
});

test("mapRankingEntry : valeurs par défaut quand champs absents", () => {
  const m = mapRankingEntry({ players: [{ id: 1 }] });
  assert.equal(m.username, "?");
  assert.equal(m.tier, null);
  assert.equal(m.rating, 0);
  assert.equal(m.region, "?");
});

test("buildPlayerProfile : consolide ranked + teams + all, choisit la meilleure équipe 2v2", () => {
  const ranked = {
    name: "Neo", rating: 1700, tier: "Platinum 1", region: "EU", global_rank: 12,
    peak_rating: 1750, games: 100, wins: 60,
    legends: [{ legend_id: 3, games: 50, wins: 30, peak_rating: 1700 }],
  };
  const teamsData = {
    teams: { ranked_2v2: [
      { rating: 1400, tier: "Gold 5", games: 20, wins: 10, peak_rating: 1450 },
      { rating: 1600, tier: "Platinum 1", games: 30, wins: 18, peak_rating: 1650 }, // meilleure
    ] },
  };
  const all = { level: 55, games: 500, wins: 280, legends: [{ legend_id: 3, games: 200, wins: 120 }] };

  const p = buildPlayerProfile(123, { ranked, teamsData, all, partial: false });
  assert.equal(p.brawlhallaId, 123);
  assert.equal(p.name, "Neo");
  assert.equal(p.level, 55);
  assert.equal(p.region, "EU");
  assert.equal(p.globalRank, 12);
  assert.equal(p.ratings["1v1"], 1700);
  assert.equal(p.tiers["1v1"], "Platinum");
  assert.equal(p.ratings["2v2"], 1600); // équipe au plus haut rating
  assert.equal(p.tiers["2v2"], "Platinum");
  assert.equal(p.best2v2.rating, 1600);
  assert.equal(p.totalGames, 500);
  assert.equal(p.legendsRanked.length, 1);
  assert.equal(p.legendsAll.length, 1);
  assert.equal(p.partial, false);
});

test("buildPlayerProfile : non classé / données manquantes", () => {
  const p = buildPlayerProfile(9, { ranked: { name: "Rookie", rating: 0, region: "US-W" }, teamsData: null, all: null, partial: true });
  assert.equal(p.tiers["1v1"], null); // rating 0 -> non classé
  assert.equal(p.tiers["2v2"], null);
  assert.equal(p.ratings["2v2"], 0);
  assert.deepEqual(p.teams, []);
  assert.equal(p.best2v2, null);
  assert.equal(p.level, 0);
  assert.equal(p.partial, true);
});

test("buildPlayerProfile : Valhallan déduit quand tier vide mais rating élevé", () => {
  const p = buildPlayerProfile(1, { ranked: { name: "Pro", rating: 2100, tier: "", region: "EU" } });
  assert.equal(p.tiers["1v1"], "Valhallan");
});

test("buildPlayerProfile : nom replié sur /all si absent du ranked", () => {
  const p = buildPlayerProfile(1, { ranked: { rating: 1300, tier: "Silver 5", region: "EU" }, all: { name: "FromAll", level: 10 } });
  assert.equal(p.name, "FromAll");
  assert.equal(p.level, 10);
});
