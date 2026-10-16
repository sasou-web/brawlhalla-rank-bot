import test from "node:test";
import assert from "node:assert/strict";
import { rankedXpDelta, rankedCountersFromProfile, gameXpSettings, gameXpDayKey } from "../src/rankedXp.js";
import { syncMember } from "../src/sync.js";
import { managedRoleNames } from "../src/roles.js";
import { buildPlayerProfile } from "../src/brawlhalla.js";
import { getLink, removeLink, setLink } from "../src/store.js";
import { getUserStats, resetLevels, setLevelConfig } from "../src/levels.js";
import { getCounter } from "../src/achievements.js";

const ON = gameXpSettings({ gameXpEnabled: true, xpPerRankedGame: 5, xpPerRankedWin: 10, gameXpDailyCap: 300, gameXpModes: ["1v1", "2v2", "3v3"] });
const c = (games, wins) => ({ games, wins });

test("rankedXpDelta : base vide → re-base sans XP", () => {
  const r = rankedXpDelta(null, { "1v1": c(40, 20), "2v2": c(10, 5), "3v3": null }, ON);
  assert.equal(r.xp, 0);
  assert.equal(r.rebaseline, true);
  assert.deepEqual(r.counters, { "1v1": c(40, 20), "2v2": c(10, 5) });
});

test("rankedXpDelta : +3 parties / +2 victoires → 3·5 + 2·10 = 35", () => {
  const r = rankedXpDelta({ "1v1": c(40, 20) }, { "1v1": c(43, 22), "2v2": null, "3v3": null }, ON);
  assert.equal(r.games, 3);
  assert.equal(r.wins, 2);
  assert.equal(r.xp, 35);
  assert.equal(r.rebaseline, false);
});

test("rankedXpDelta : delta négatif (nouvelle saison) → 0 XP et re-base", () => {
  const r = rankedXpDelta({ "1v1": c(300, 160) }, { "1v1": c(4, 3), "2v2": null, "3v3": null }, ON);
  assert.equal(r.xp, 0);
  assert.equal(r.rebaseline, true);
  assert.deepEqual(r.counters["1v1"], c(4, 3));
});

test("rankedXpDelta : plafond journalier atteint → 0, entamé → borné", () => {
  const prev = { "1v1": c(0, 0) };
  const next = { "1v1": c(30, 30), "2v2": null, "3v3": null };
  assert.equal(rankedXpDelta(prev, next, ON, 300).xp, 0);
  assert.equal(rankedXpDelta(prev, next, ON, 280).xp, 20);
  assert.equal(rankedXpDelta(prev, next, { ...ON, dailyCap: 0 }, 1000).xp, 450); // 0 = illimité
});

test("rankedXpDelta : mode absent de gameXpModes ignoré, mais sa base suit", () => {
  const cfg = { ...ON, modes: ["1v1"] };
  const r = rankedXpDelta({ "1v1": c(10, 5), "2v2": c(10, 5) }, { "1v1": c(11, 5), "2v2": c(20, 15), "3v3": null }, cfg);
  assert.equal(r.xp, 5);
  assert.deepEqual(r.counters["2v2"], c(20, 15));
});

test("rankedXpDelta : mode sans donnée → ancienne base gardée ; XP de jeu désactivée → 0", () => {
  const prev = { "1v1": c(10, 5), "3v3": c(8, 4) };
  const r = rankedXpDelta(prev, { "1v1": c(12, 6), "2v2": null, "3v3": null }, gameXpSettings({ ...ON, gameXpEnabled: false }));
  assert.equal(r.xp, 0);
  assert.deepEqual(r.counters, { "1v1": c(12, 6), "3v3": c(8, 4) });
});

test("rankedCountersFromProfile : 2v2 = somme des équipes, modes indisponibles à null", () => {
  const profile = buildPlayerProfile(1, {
    ranked: { name: "Neo", rating: 1500, games: 50, wins: 30 },
    teamsData: { teams: { ranked_2v2: [{ games: "12", wins: 7 }, { games: 3, wins: 1 }] } },
    all: { name: "Neo", level: 50 },
    ranked3: null,
  });
  assert.deepEqual(rankedCountersFromProfile(profile), { "1v1": c(50, 30), "2v2": c(15, 8), "3v3": null });
});

test("gameXpSettings : valeurs du dashboard nettoyées", () => {
  const s = gameXpSettings({ gameXpEnabled: true, xpPerRankedGame: "7", xpPerRankedWin: -3, gameXpDailyCap: null, gameXpModes: ["3v3", "5v5"] });
  assert.deepEqual(s, { enabled: true, perGame: 7, perWin: 0, dailyCap: 0, modes: ["3v3"] });
});

// ---- Intégration syncMember ----

function fakeMember(id) {
  const owned = new Set();
  return {
    id,
    user: { username: "Neo" },
    displayName: "Neo",
    displayAvatarURL: () => "",
    send: async () => {},
    guild: { id: "g_rxp", channels: { fetch: async () => null }, roles: { cache: { find: () => undefined } } },
    roles: {
      cache: { has: (rid) => owned.has(rid), filter: () => new Map() },
      add: async (list) => { for (const r of [].concat(list)) owned.add(r.id ?? r); },
      remove: async (list) => { for (const r of [].concat(list)) owned.delete(r.id ?? r); },
    },
  };
}
const allRoles = () => new Map([...managedRoleNames()].map((name) => [name, { id: name, name }]));
const profileWith = (games, wins, extra = {}) =>
  buildPlayerProfile(901, {
    ranked: { name: "Neo", rating: 1500, tier: "Gold 3", region: "EU", games, wins },
    teamsData: { teams: { ranked_2v2: [] } },
    all: { name: "Neo", level: 50 },
    ranked3: null,
    ...extra,
  });

test("syncMember : 1re synchro = base, puis XP des nouvelles parties ; profil partiel ignoré", async () => {
  const G = "g_rxp";
  const U = "rxp-user";
  await setLevelConfig(G, { enabled: true, dailyXpCap: 0, gameXpEnabled: true, xpPerRankedGame: 5, xpPerRankedWin: 10, gameXpDailyCap: 300 });
  await resetLevels(G, null);
  const member = fakeMember(U);
  try {
    await syncMember(member, 901, allRoles(), { profile: profileWith(40, 20) });
    assert.equal((await getUserStats(G, U)).xp, 0);
    assert.deepEqual((await getLink(U)).rankedCounters["1v1"], c(40, 20));

    await syncMember(member, 901, allRoles(), { profile: profileWith(43, 22) });
    assert.equal((await getUserStats(G, U)).xp, 35);
    assert.equal(getCounter(G, U, gameXpDayKey()), 35);

    // Profil partiel (appel secondaire en échec) : ni XP, ni re-base.
    await syncMember(member, 901, allRoles(), { profile: profileWith(10, 5, { partial: true }) });
    assert.equal((await getUserStats(G, U)).xp, 35);
    assert.deepEqual((await getLink(U)).rankedCounters["1v1"], c(43, 22));
  } finally {
    await removeLink(U);
  }
});

test("syncMember : compte Brawlhalla changé ou bond de rating suspect → pas d'XP", async () => {
  const G = "g_rxp";
  const U = "rxp-user-2";
  await setLevelConfig(G, { enabled: true, dailyXpCap: 0, gameXpEnabled: true, xpPerRankedGame: 5, xpPerRankedWin: 10, gameXpDailyCap: 300 });
  await resetLevels(G, null);
  const member = fakeMember(U);
  try {
    // Lien vers un autre compte : ses compteurs ne servent pas de base.
    await setLink(U, 111, "Autre", { rating1v1: 1500, rankedCounters: { "1v1": c(1, 0) } });
    await syncMember(member, 901, allRoles(), { profile: profileWith(40, 20) });
    assert.equal((await getUserStats(G, U)).xp, 0);

    // Bond de +600 de rating (cf. detectSmurf) : base mise à jour, XP ignorée.
    const jump = profileWith(45, 25);
    jump.ratings["1v1"] = 2100;
    await syncMember(member, 901, allRoles(), { profile: jump });
    assert.equal((await getUserStats(G, U)).xp, 0);
    assert.deepEqual((await getLink(U)).rankedCounters["1v1"], c(45, 25));
  } finally {
    await removeLink(U);
  }
});
