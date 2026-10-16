import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerProfile, shouldFetch3v3 } from "../src/brawlhalla.js";
import { syncMember, announcePromotions } from "../src/sync.js";
import { seasonRewardTier } from "../src/season.js";
import { roleName } from "../src/config.js";
import { managedRoleNames, seasonalRoleNames } from "../src/roles.js";
import { setLink, getLink, removeLink, clearSeason3v3 } from "../src/store.js";
import { recordRating, getRatingHistory } from "../src/ratingStore.js";
import { getSettings, setSetting } from "../src/settings.js";

// Réponse réelle de /player/stats?mode=ranked_3v3 (forme relevée sur l'API v1, 16/10/2026).
const RANKED3 = { brawlhalla_id: 777, name: "Neo", games: 50, wins: 30, rating: 1650, peak_rating: 1720, tier: "Gold 3", region: "EU" };
const RANKED1 = { name: "Neo", rating: 1500, tier: "Gold 2", region: "EU", global_rank: 0 };
const TEAMS = { teams: { ranked_2v2: [] } };
const ALL = { name: "Neo", level: 50 };

// Membre factice : rôles = IDs dans un Set (ID = nom du rôle, cf. allRoles()).
function fakeMember(id, roleIds = [], sent = null) {
  const owned = new Set(roleIds);
  const channel = { isTextBased: () => true, send: async (msg) => sent?.push(msg) };
  return {
    id,
    owned,
    user: { username: "Neo" },
    guild: { id: "g_3v3", channels: { fetch: async () => channel }, roles: { cache: { find: () => undefined } } },
    roles: {
      cache: { has: (rid) => owned.has(rid), filter: () => new Map() },
      add: async (list) => { for (const r of [].concat(list)) owned.add(r.id ?? r); },
      remove: async (list) => { for (const r of [].concat(list)) owned.delete(r.id ?? r); },
    },
  };
}
const allRoles = () => new Map([...managedRoleNames()].map((name) => [name, { id: name, name }]));

test("rôles 3v3 : gérés et saisonniers comme 1v1/2v2", () => {
  assert.equal(roleName("3v3", "Gold"), "3v3 Gold");
  assert.ok(managedRoleNames().has("3v3 Valhallan"));
  assert.ok(seasonalRoleNames().has("3v3 Tin"));
});

test("buildPlayerProfile : réponse ranked_3v3 → tier, rating, pic, games/wins 3v3", () => {
  const p = buildPlayerProfile(777, { ranked: RANKED1, teamsData: TEAMS, all: ALL, ranked3: RANKED3 });
  assert.equal(p.tiers["3v3"], "Gold");
  assert.equal(p.ratings["3v3"], 1650);
  assert.equal(p.peak3v3, 1720);
  assert.equal(p.games3v3, 50);
  assert.equal(p.wins3v3, 30);
  assert.equal(p.ranked3v3Available, true);
  assert.equal(p.tiers["1v1"], "Gold"); // le 1v1 n'est pas touché
});

test("buildPlayerProfile : ranked3 absent → pas de rank 3v3, ranked3v3Available=false", () => {
  const p = buildPlayerProfile(777, { ranked: RANKED1, teamsData: TEAMS, all: ALL, ranked3: null });
  assert.equal(p.tiers["3v3"], null);
  assert.equal(p.ratings["3v3"], 0);
  assert.equal(p.ranked3v3Available, false);
});

test("shouldFetch3v3 : non classé vérifié récemment = appel sauté, sinon appel", () => {
  const now = Date.now();
  assert.equal(shouldFetch3v3(null, now), true); // jamais vu
  assert.equal(shouldFetch3v3({ ratings: { "3v3": 0 } }, now), true); // jamais vérifié (cache d'avant)
  assert.equal(shouldFetch3v3({ ratings: { "3v3": 1650 }, ranked3v3CheckedAt: now }, now), true); // classé : suivi
  assert.equal(shouldFetch3v3({ ratings: { "3v3": 0 }, ranked3v3CheckedAt: now - 60_000 }, now), false);
  assert.equal(shouldFetch3v3({ ratings: { "3v3": 0 }, ranked3v3CheckedAt: now - 5 * 3600_000 }, now), true);
});

test("syncMember : reçoit 3v3 Gold, le garde sur un 404 ponctuel, le perd après 24 h", async () => {
  const id = "u3v3-carry";
  const member = fakeMember(id);
  try {
    const full = buildPlayerProfile(777, { ranked: RANKED1, teamsData: TEAMS, all: ALL, ranked3: RANKED3 });
    const r1 = await syncMember(member, 777, allRoles(), { profile: full });
    assert.ok(r1.added.includes("3v3 Gold"));
    const link = await getLink(id);
    assert.equal(link.rating3v3, 1650);
    assert.equal(link.peakTiers["3v3"], "Platinum"); // pic 1720 = Platinum
    assert.ok(link.ranked3v3SeenAt);

    // 404 sur ranked_3v3 juste après : rôle, rating et pic conservés.
    const no3 = buildPlayerProfile(777, { ranked: RANKED1, teamsData: TEAMS, all: ALL, ranked3: null });
    const r2 = await syncMember(member, 777, allRoles(), { profile: no3 });
    assert.equal(r2.tiers["3v3"], "Gold");
    assert.ok(!r2.removed.includes("3v3 Gold"));
    assert.equal((await getLink(id)).rating3v3, 1650);

    // Toujours rien, et le dernier rank 3v3 vu date de plus de 24 h : le rôle tombe.
    const old = await getLink(id);
    await setLink(id, 777, "Neo", { ...old, ranked3v3SeenAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    const r3 = await syncMember(member, 777, allRoles(), { profile: no3 });
    assert.equal(r3.tiers["3v3"], null);
    assert.ok(r3.removed.includes("3v3 Gold"));
    assert.equal((await getLink(id)).rating3v3, 0);
    assert.equal((await getLink(id)).peakTiers["3v3"], "Platinum"); // le pic de saison reste acquis
  } finally {
    await removeLink(id);
  }
});

test("announcePromotions : une promotion 3v3 seule est annoncée", async () => {
  const before = (await getSettings()).announceChannelId;
  await setSetting("announceChannelId", "c_announce_3v3");
  const sent = [];
  try {
    const member = fakeMember("u3v3-promo", [], sent);
    await announcePromotions(member, { "1v1": "Gold", "2v2": null, "3v3": "Gold" }, { "1v1": "Gold", "2v2": null, "3v3": "Platinum" });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /est passé \*\*Platinum\*\* en 3v3/);

    // Première apparition du 3v3 (aucun tier 3v3 avant) : pas d'annonce.
    await announcePromotions(member, { "1v1": "Gold" }, { "1v1": "Gold", "3v3": "Diamond" });
    assert.equal(sent.length, 1);
  } finally {
    await setSetting("announceChannelId", before ?? null);
  }
});

test("seasonRewardTier : le pic 3v3 compte pour le badge (décision A)", () => {
  assert.equal(seasonRewardTier({ "1v1": "Gold", "3v3": "Diamond" }), "Diamond");
  assert.equal(seasonRewardTier({ "1v1": "Gold", "2v2": null, "3v3": null }, { "3v3": "Platinum" }), "Platinum");
});

test("clearSeason3v3 : /reset-saison efface le pic 3v3 et le report du rank 3v3", async () => {
  const id = "u3v3-reset";
  await setLink(id, 778, "Neo", {
    tiers: { "1v1": "Gold", "3v3": "Diamond" },
    peakTiers: { "1v1": "Gold", "3v3": "Diamond" },
    ranked3v3SeenAt: new Date().toISOString(),
  });
  try {
    assert.ok((await clearSeason3v3()) >= 1);
    const link = await getLink(id);
    assert.equal(link.peakTiers["3v3"], null);
    assert.equal(link.peakTiers["1v1"], "Gold"); // les autres modes ne bougent pas
    assert.equal(link.ranked3v3SeenAt, null);
  } finally {
    await removeLink(id);
  }
});

test("recordRating : le rating 3v3 est historisé (r3), même seul", async () => {
  await recordRating("rt_3v3_only", { rating3v3: 1650 });
  const hist = await getRatingHistory("rt_3v3_only");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].r3, 1650);
  assert.equal(hist[0].r1, 0);
});
