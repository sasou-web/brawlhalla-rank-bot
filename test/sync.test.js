import test from "node:test";
import assert from "node:assert/strict";
import { syncAllMembers, syncMember, isSyncingAll } from "../src/sync.js";
import { roleName, regionRoleName, TOP_ROLE_NAME, TOP_SERVER_ROLE_NAME } from "../src/config.js";
import { managedRoleNames, updateTopServerRole } from "../src/roles.js";
import { buildPlayerProfile } from "../src/brawlhalla.js";
import { setLink, getLink, removeLink } from "../src/store.js";

// Serveur factice : rôles en mémoire (création = nouvel ID), aucun membre récupérable.
function fakeGuild({ failRolesFetch = false } = {}) {
  const roles = new Map();
  let n = 0;
  return {
    id: "g_sync",
    roles: {
      fetch: async () => {
        if (failRolesFetch) throw new Error("Discord 503");
        return roles;
      },
      cache: { find: (fn) => [...roles.values()].find(fn) },
      create: async ({ name }) => {
        const role = { id: `role_${++n}`, name, members: new Map() };
        roles.set(role.id, role);
        return role;
      },
    },
    members: { cache: new Map(), fetch: async () => { throw new Error("Unknown Member"); } },
    channels: { fetch: async () => null },
  };
}

// Membre factice : ses rôles sont des IDs dans un Set (ID = nom du rôle, cf. allRoles()).
function fakeMember(id, roleIds = []) {
  const owned = new Set(roleIds);
  return {
    id,
    user: { username: "Neo" },
    guild: { id: "g_sync", channels: { fetch: async () => null }, roles: { cache: { find: () => undefined } } },
    roles: {
      cache: { has: (rid) => owned.has(rid), filter: () => new Map() },
      add: async (list) => { for (const r of [].concat(list)) owned.add(r.id ?? r); },
      remove: async (list) => { for (const r of [].concat(list)) owned.delete(r.id ?? r); },
    },
  };
}
const allRoles = () => new Map([...managedRoleNames()].map((name) => [name, { id: name, name }]));

test("syncMember : 404 sur ranked, Région et Top 100 conservés depuis le lien", async () => {
  await setLink("i5-user", 555, "Neo", {
    tiers: { "1v1": "Diamond", "2v2": null }, rating1v1: 2100, rating2v2: 0, level: 80, globalRank: 50, region: "EU",
    rankedSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const member = fakeMember("i5-user", [roleName("1v1", "Diamond"), regionRoleName("EU"), TOP_ROLE_NAME]);
  const profile = buildPlayerProfile(555, { ranked: null, teamsData: { teams: { ranked_2v2: [] } }, all: { name: "Neo", level: 81 } });
  try {
    const r = await syncMember(member, 555, allRoles(), { profile });
    assert.deepEqual(r.removed, []);
    assert.equal(r.region, "EU");
    assert.equal(r.globalRank, 50);
    assert.equal(r.tiers["1v1"], "Diamond");
    assert.equal(r.level, 81);
  } finally {
    await removeLink("i5-user");
  }
});

test("syncMember : 404 sur /all, le niveau connu n'est pas écrasé par 0", async () => {
  await setLink("i5-user-2", 556, "Neo", {
    tiers: { "1v1": "Diamond", "2v2": null }, rating1v1: 2100, rating2v2: 0, level: 80, globalRank: 50, region: "EU",
  });
  const ranked = { name: "Neo", rating: 2100, tier: "Diamond", region: "EU", global_rank: 50 };
  const profile = buildPlayerProfile(556, { ranked, teamsData: { teams: { ranked_2v2: [] } }, all: null });
  try {
    const r = await syncMember(fakeMember("i5-user-2"), 556, allRoles(), { profile });
    assert.equal(r.level, 80);
    assert.equal((await getLink("i5-user-2")).level, 80);
  } finally {
    await removeLink("i5-user-2");
  }
});

test("syncMember : enregistre le pic de saison par mode, conservé si l'API ne répond pas", async () => {
  const ranked = { name: "Neo", rating: 1700, tier: "Platinum 1", region: "EU", peak_rating: 2050 };
  const teamsData = { teams: { ranked_2v2: [{ rating: 1400, tier: "Gold 1", peak_rating: 1700 }] } };
  try {
    await syncMember(fakeMember("i8-user"), 801, allRoles(), {
      profile: buildPlayerProfile(801, { ranked, teamsData, all: { level: 10 } }),
    });
    assert.deepEqual((await getLink("i8-user")).peakTiers, { "1v1": "Diamond", "2v2": "Platinum" });

    // 404 sur ranked et teams : les pics connus ne sont pas effacés.
    await syncMember(fakeMember("i8-user"), 801, allRoles(), {
      profile: buildPlayerProfile(801, { ranked: null, teamsData: null, all: { name: "Neo", level: 10 } }),
    });
    assert.deepEqual((await getLink("i8-user")).peakTiers, { "1v1": "Diamond", "2v2": "Platinum" });
  } finally {
    await removeLink("i8-user");
  }
});

test("updateTopServerRole : un membre parti ne prive pas le vrai n°1 de la couronne", async () => {
  await setLink("i6-gone", 601, "Parti", { rating1v1: 99_999 });
  await setLink("i6-here", 602, "Présent", { rating1v1: 99_998 });
  const crown = { id: "crown", name: TOP_SERVER_ROLE_NAME, members: new Map() };
  const here = {
    id: "i6-here",
    roles: {
      cache: new Set(),
      add: async (role) => { here.roles.cache.add(role.id); crown.members.set(here.id, here); },
      remove: async () => {},
    },
  };
  const guild = {
    roles: { fetch: async () => {}, cache: { find: (fn) => (fn(crown) ? crown : undefined) }, create: async () => crown },
    members: {
      cache: new Map(),
      fetch: async (id) => { if (id === "i6-here") return here; throw new Error("Unknown Member"); },
    },
  };
  try {
    const top = await updateTopServerRole(guild);
    assert.equal(top.topId, "i6-here");
    assert.ok(here.roles.cache.has("crown"));
    assert.ok(await getLink("i6-gone"), "la liaison du membre parti est conservée");
  } finally {
    await removeLink("i6-gone");
    await removeLink("i6-here");
  }
});

test("syncAllMembers : rôle supprimé puis recréé, la map partagée suit (même instance)", async () => {
  const shared = new Map([[roleName("1v1", "Gold"), { id: "fantome", name: roleName("1v1", "Gold") }]]);
  await syncAllMembers(fakeGuild(), shared);
  const gold = shared.get(roleName("1v1", "Gold"));
  assert.notEqual(gold.id, "fantome");
  assert.ok(shared.size > 1); // toute la map a été reconstruite
});

test("syncAllMembers : verrou unique, une seconde passe simultanée est refusée", async () => {
  const first = syncAllMembers(fakeGuild(), new Map());
  assert.equal(isSyncingAll(), true); // c'est ce que teste le refresh automatique (index.js)
  await assert.rejects(syncAllMembers(fakeGuild(), new Map()), /déjà en cours/);
  await first;
  assert.equal(isSyncingAll(), false);
});

test("syncAllMembers : Discord indisponible, on garde la map connue ; sans map, on lève", async () => {
  const shared = new Map([[roleName("1v1", "Gold"), { id: "connu", name: roleName("1v1", "Gold") }]]);
  await syncAllMembers(fakeGuild({ failRolesFetch: true }), shared);
  assert.equal(shared.get(roleName("1v1", "Gold")).id, "connu");
  await assert.rejects(syncAllMembers(fakeGuild({ failRolesFetch: true })), /Discord 503/);
});

test("syncMember : ranked absent depuis plus de 24 h (placements après reset) → plus de Top 100", async () => {
  await setLink("i5-old", 557, "Neo", {
    tiers: { "1v1": "Diamond", "2v2": null }, rating1v1: 2100, rating2v2: 0, level: 80, globalRank: 50, region: "EU",
    rankedSeenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const member = fakeMember("i5-old", [roleName("1v1", "Diamond"), regionRoleName("EU"), TOP_ROLE_NAME]);
  const profile = buildPlayerProfile(557, { ranked: null, teamsData: { teams: { ranked_2v2: [] } }, all: { name: "Neo", level: 81 } });
  try {
    const r = await syncMember(member, 557, allRoles(), { profile });
    assert.equal(r.globalRank, 0);
    assert.ok(r.removed.includes(TOP_ROLE_NAME));
    assert.equal(r.region, "EU");
  } finally {
    await removeLink("i5-old");
  }
});

test("syncMember : rankedSeenAt mis à jour quand ranked répond", async () => {
  const ranked = { name: "Neo", rating: 2100, tier: "Diamond", region: "EU", global_rank: 50 };
  const profile = buildPlayerProfile(558, { ranked, teamsData: { teams: { ranked_2v2: [] } }, all: { name: "Neo", level: 81 } });
  try {
    await syncMember(fakeMember("i5-seen"), 558, allRoles(), { profile });
    const seen = Date.parse((await getLink("i5-seen")).rankedSeenAt);
    assert.ok(Date.now() - seen < 60_000);
  } finally {
    await removeLink("i5-seen");
  }
});
