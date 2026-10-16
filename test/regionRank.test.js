import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerProfile, regionRankOf } from "../src/brawlhalla.js";
import { syncMember, entersTopRegion, announceTopRegion } from "../src/sync.js";
import { HOME_REGION, TOP_REGION_ROLE_NAME, parseHomeRegion, regionRoleName } from "../src/config.js";
import { applyMemberRoles, managedRoleNames, seasonalRoleNames } from "../src/roles.js";
import { evaluateAchievements } from "../src/achievements.js";
import { setLink, getLink, removeLink } from "../src/store.js";
import { getSettings, setSetting } from "../src/settings.js";

// Une région qui n'est pas la région maison (HOME_REGION vaut EU sauf .env local).
const OTHER = HOME_REGION === "US-E" ? "EU" : "US-E";
const TEAMS = { teams: { ranked_2v2: [] } };
const ALL = { name: "Neo", level: 50 };
// Forme de /player/stats?mode=ranked_1v1 (dev.brawlhalla.com : region_ranks = [{ region, rank }]).
const ranked = (regionRank, region = HOME_REGION) => ({
  name: "Neo",
  rating: 2400,
  tier: "Diamond",
  region,
  global_rank: 900,
  region_ranks: regionRank ? [{ region: "SEA", rank: 3 }, { region, rank: regionRank }, { region: "BRZ", rank: 12 }] : [],
});

// Membre factice : rôles = IDs dans un Set (ID = nom du rôle, cf. allRoles()).
function fakeMember(id, roleIds = [], sent = null) {
  const owned = new Set(roleIds);
  const channel = { isTextBased: () => true, send: async (msg) => sent?.push(msg) };
  return {
    id,
    owned,
    user: { username: "Neo" },
    guild: { id: "g_region", channels: { fetch: async () => channel }, roles: { cache: { find: () => undefined } } },
    roles: {
      cache: { has: (rid) => owned.has(rid), filter: () => new Map() },
      add: async (list) => { for (const r of [].concat(list)) owned.add(r.id ?? r); },
      remove: async (list) => { for (const r of [].concat(list)) owned.delete(r.id ?? r); },
    },
  };
}
const allRoles = () => new Map([...managedRoleNames()].map((name) => [name, { id: name, name }]));

// Salon d'annonces factice le temps du test.
async function withAnnounceChannel(fn) {
  const before = (await getSettings()).announceChannelId;
  await setSetting("announceChannelId", "c_announce_region");
  try {
    await fn();
  } finally {
    await setSetting("announceChannelId", before ?? null);
  }
}

test("parseHomeRegion : code valide normalisé, inconnu ou vide = EU", () => {
  assert.equal(parseHomeRegion("eu"), "EU");
  assert.equal(parseHomeRegion(" us-e "), "US-E");
  assert.equal(parseHomeRegion(""), "EU");
  assert.equal(parseHomeRegion(undefined), "EU");
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(parseHomeRegion("XX"), "EU");
  } finally {
    console.warn = warn;
  }
  assert.equal(TOP_REGION_ROLE_NAME, `Top 100 ${HOME_REGION} (1v1)`);
});

test("buildPlayerProfile : rang de la région du joueur parmi plusieurs régions", () => {
  assert.equal(buildPlayerProfile(1, { ranked: ranked(57), teamsData: TEAMS, all: ALL }).regionRank, 57);
  assert.equal(buildPlayerProfile(1, { ranked: ranked(8, OTHER), teamsData: TEAMS, all: ALL }).regionRank, 8);
  // Non classé (region_ranks vide), ranked absent, rang en chaîne ou invalide.
  assert.equal(buildPlayerProfile(1, { ranked: ranked(0), teamsData: TEAMS, all: ALL }).regionRank, 0);
  assert.equal(buildPlayerProfile(1, { ranked: null, teamsData: TEAMS, all: ALL }).regionRank, 0);
  assert.equal(regionRankOf({ region: "EU", region_ranks: [{ region: "EU", rank: "42" }] }), 42);
  assert.equal(regionRankOf({ region: "EU", region_ranks: [{ region: "EU", rank: "?" }] }), 0);
  assert.equal(regionRankOf({ region: "EU", region_ranks: "EU" }), 0);
});

test("rôle Top 100 régional : géré et saisonnier", () => {
  assert.ok(managedRoleNames().has(TOP_REGION_ROLE_NAME));
  assert.ok(seasonalRoleNames().has(TOP_REGION_ROLE_NAME));
});

test("applyMemberRoles : Top 100 régional à #100, pas à #101 ni hors région maison, retiré à la sortie", async () => {
  const roles = allRoles();
  const m = fakeMember("u-region-roles");
  const apply = (region, regionRank) => applyMemberRoles(m, { tiers: {}, region, regionRank }, roles);

  await apply(HOME_REGION, 100);
  assert.ok(m.owned.has(TOP_REGION_ROLE_NAME));

  const out = await apply(HOME_REGION, 101);
  assert.ok(!m.owned.has(TOP_REGION_ROLE_NAME));
  assert.ok(out.removed.includes(TOP_REGION_ROLE_NAME));

  await apply(OTHER, 1);
  assert.ok(!m.owned.has(TOP_REGION_ROLE_NAME));
  assert.ok(m.owned.has(regionRoleName(OTHER)));

  await apply(HOME_REGION, 0);
  assert.ok(!m.owned.has(TOP_REGION_ROLE_NAME));
});

test("entersTopRegion : seulement à l'entrée dans le top 100", () => {
  assert.equal(entersTopRegion(0, 50), true);
  assert.equal(entersTopRegion(150, 90), true);
  assert.equal(entersTopRegion(101, 100), true);
  assert.equal(entersTopRegion(50, 40), false);
  assert.equal(entersTopRegion(50, 0), false);
  assert.equal(entersTopRegion(0, 101), false);
});

test("announceTopRegion : annonce l'entrée (ping du seul membre), rien sinon", async () => {
  const sent = [];
  await withAnnounceChannel(async () => {
    const m = fakeMember("u-region-announce", [], sent);
    await announceTopRegion(m, 0, 57);
    await announceTopRegion(m, 57, 40);
    await announceTopRegion(m, 150, 120);
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, new RegExp(`entre dans le \\*\\*Top 100 ${HOME_REGION}\\*\\* \\(#57\\)`));
  assert.deepEqual(sent[0].allowedMentions, { users: ["u-region-announce"] });
});

test("syncMember : rôle, stockage et annonce à l'entrée dans le Top 100 régional", async () => {
  const id = "u-region-sync";
  const sent = [];
  await setLink(id, 901, "Neo", { tiers: { "1v1": "Diamond" }, region: HOME_REGION, regionRank: 180 });
  try {
    await withAnnounceChannel(async () => {
      const m = fakeMember(id, [], sent);
      const r = await syncMember(m, 901, allRoles(), {
        profile: buildPlayerProfile(901, { ranked: ranked(57), teamsData: TEAMS, all: ALL }),
      });
      assert.equal(r.regionRank, 57);
      assert.ok(m.owned.has(TOP_REGION_ROLE_NAME));
      assert.equal((await getLink(id)).regionRank, 57);

      // Progression dans le top : pas de nouvelle annonce.
      await syncMember(m, 901, allRoles(), {
        profile: buildPlayerProfile(901, { ranked: ranked(40), teamsData: TEAMS, all: ALL }),
      });
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /#57/);
  } finally {
    await removeLink(id);
  }
});

test("syncMember : lien sans rang régional enregistré = rattrapage silencieux", async () => {
  const id = "u-region-legacy";
  const sent = [];
  await setLink(id, 902, "Neo", { tiers: { "1v1": "Diamond" }, region: HOME_REGION, globalRank: 900 });
  try {
    await withAnnounceChannel(async () => {
      const m = fakeMember(id, [], sent);
      await syncMember(m, 902, allRoles(), {
        profile: buildPlayerProfile(902, { ranked: ranked(12), teamsData: TEAMS, all: ALL }),
      });
      assert.ok(m.owned.has(TOP_REGION_ROLE_NAME));
    });
    assert.equal(sent.length, 0);
  } finally {
    await removeLink(id);
  }
});

test("syncMember : 404 ponctuel sur ranked, Top 100 régional conservé moins de 24 h", async () => {
  const id = "u-region-404";
  const profile = buildPlayerProfile(903, { ranked: null, teamsData: TEAMS, all: ALL });
  try {
    await setLink(id, 903, "Neo", {
      tiers: { "1v1": "Diamond" }, region: HOME_REGION, regionRank: 30,
      rankedSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const m = fakeMember(id, [TOP_REGION_ROLE_NAME, regionRoleName(HOME_REGION)]);
    const r = await syncMember(m, 903, allRoles(), { profile });
    assert.equal(r.regionRank, 30);
    assert.ok(m.owned.has(TOP_REGION_ROLE_NAME));

    // Ranked absent depuis plus de 24 h (placements après un reset) : le rôle tombe.
    await setLink(id, 903, "Neo", {
      tiers: { "1v1": "Diamond" }, region: HOME_REGION, regionRank: 30,
      rankedSeenAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    const r2 = await syncMember(m, 903, allRoles(), { profile });
    assert.equal(r2.regionRank, 0);
    assert.ok(!m.owned.has(TOP_REGION_ROLE_NAME));
  } finally {
    await removeLink(id);
  }
});

test("succès Top 100 régional : région maison et rang 1..100 seulement", () => {
  const ach = `top100${HOME_REGION.toLowerCase()}`;
  assert.ok(evaluateAchievements({ region: HOME_REGION, regionRank: 100 }).includes(ach));
  assert.ok(!evaluateAchievements({ region: HOME_REGION, regionRank: 101 }).includes(ach));
  assert.ok(!evaluateAchievements({ region: HOME_REGION, regionRank: 0 }).includes(ach));
  assert.ok(!evaluateAchievements({ region: OTHER, regionRank: 5 }).includes(ach));
});
