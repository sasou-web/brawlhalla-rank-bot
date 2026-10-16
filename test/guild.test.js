import test from "node:test";
import assert from "node:assert/strict";
import {
  diffGuildMembers,
  guildRolePlan,
  buildLinksIndex,
  normalizeGuildMembers,
  normalizeGuildStats,
  computeGuildWeek,
  buildJoinLeaveMessages,
  getGuildConfig,
  setGuildConfig,
} from "../src/guild.js";
import { unlinkedGuildMembers } from "../src/commands/guild.js";

const m = (id, name = `P${id}`, extra = {}) => ({ id: String(id), name, rank: "Member", joinDate: 0, xp: 0, points: 0, ...extra });

test("diffGuildMembers : arrivée et départ", () => {
  const { joined, left } = diffGuildMembers([m(1), m(2)], [m(2), m(3)]);
  assert.deepEqual(joined.map((x) => x.id), ["3"]);
  assert.deepEqual(left.map((x) => x.id), ["1"]);
});

test("diffGuildMembers : un renommage (même id) n'est ni une arrivée ni un départ", () => {
  const { joined, left } = diffGuildMembers([m(1, "Ancien")], [m(1, "Nouveau")]);
  assert.equal(joined.length, 0);
  assert.equal(left.length, 0);
});

test("diffGuildMembers : ids numériques et textuels comparés à l'identique", () => {
  const { joined, left } = diffGuildMembers([{ id: 7, name: "A" }], [{ id: "7", name: "A" }]);
  assert.equal(joined.length + left.length, 0);
});

const links = { d1: { brawlhallaId: 1 }, d2: { brawlhallaId: 2 }, d3: { brawlhallaId: 3 } };

test("guildRolePlan : ajoute le rôle aux membres liés présents dans la guilde", () => {
  const plan = guildRolePlan([m(1), m(2)], buildLinksIndex(links), new Set());
  assert.deepEqual(plan.toAdd.sort(), ["d1", "d2"]);
  assert.deepEqual(plan.toRemove, []);
});

test("guildRolePlan : retire le rôle à un membre lié qui a quitté la guilde", () => {
  const plan = guildRolePlan([m(1)], buildLinksIndex(links), new Set(["d1", "d3"]));
  assert.deepEqual(plan.toAdd, []);
  assert.deepEqual(plan.toRemove, ["d3"]);
});

test("guildRolePlan : un membre non lié n'est jamais touché", () => {
  // "dx" a le rôle (donné à la main) sans liaison ; le joueur 99 est dans la guilde sans compte lié.
  const plan = guildRolePlan([m(1), m(99)], buildLinksIndex(links), new Set(["d1", "dx"]));
  assert.deepEqual(plan.toAdd, []);
  assert.deepEqual(plan.toRemove, []);
});

test("guildRolePlan : membre déjà à jour = aucun changement", () => {
  const plan = guildRolePlan([m(1), m(2)], buildLinksIndex(links), new Set(["d1", "d2"]));
  assert.deepEqual(plan, { toAdd: [], toRemove: [] });
});

test("normalizeGuildMembers : forme documentée de /guild/members", () => {
  const out = normalizeGuildMembers({
    guild_id: 5,
    guild_members: [{ brawlhalla_id: 42, name: "Nox", rank: "Leader", join_date: 1700000000, xp: 1200, guild_points: 30 }],
  });
  assert.deepEqual(out, [{ id: "42", name: "Nox", rank: "Leader", joinDate: 1700000000, xp: 1200, points: 30 }]);
  assert.equal(normalizeGuildMembers({ error: "x" }), null);
  assert.equal(normalizeGuildMembers(null), null);
});

test("normalizeGuildStats : rank et member_count absents (guilde récente)", () => {
  const s = normalizeGuildStats({ guild_id: 5, name: "Xray", xp: 10, guild_points: 3 });
  assert.equal(s.name, "Xray");
  assert.equal(s.rank, null);
  assert.equal(s.memberCount, null);
  assert.equal(normalizeGuildStats(null), null);
});

test("computeGuildWeek : arrivées, départs et meilleur gain d'XP", () => {
  const base = { members: [{ id: "1", xp: 100 }, { id: "2", xp: 500 }, { id: "3", xp: 50 }] };
  const week = computeGuildWeek(base, [m(1, "A", { xp: 400 }), m(2, "B", { xp: 550 }), m(4, "D", { xp: 120 })]);
  assert.equal(week.joined, 1);
  assert.equal(week.left, 1);
  assert.deepEqual(week.top, { id: "1", name: "A", value: 300, unit: "XP" });
});

test("computeGuildWeek : repli sur les points de guilde si aucune XP gagnée", () => {
  const week = computeGuildWeek({ members: [{ id: "1", xp: 100 }] }, [m(1, "A", { xp: 100, points: 40 })]);
  assert.deepEqual(week.top, { id: "1", name: "A", value: 40, unit: "points" });
});

test("buildJoinLeaveMessages : pseudos échappés, découpage sous 2000 caractères", () => {
  const [msg] = buildJoinLeaveMessages({ joined: [m(1, "**@everyone**")], left: [] });
  assert.match(msg, /a rejoint la guilde/);
  assert.ok(msg.includes("\\*\\*@everyone\\*\\*"));
  const many = Array.from({ length: 120 }, (_, i) => m(i, "X".repeat(25)));
  const msgs = buildJoinLeaveMessages({ joined: many, left: [] });
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every((s) => s.length <= 2000));
});

test("unlinkedGuildMembers : seuls les membres sans compte lié, triés", () => {
  const out = unlinkedGuildMembers([m(1, "Zed"), m(99, "bob"), m(98, "Alice")], buildLinksIndex(links));
  assert.deepEqual(out.map((x) => x.name), ["Alice", "bob"]);
});

test("setGuildConfig : valide l'ID et ignore les clés inconnues côté défauts", async () => {
  const gid = "g_guild_test";
  assert.deepEqual(await getGuildConfig(gid), { brawlhallaGuildId: "", roleId: "", announceChannelId: "", announceJoins: true });
  await assert.rejects(() => setGuildConfig(gid, { brawlhallaGuildId: "abc" }), (e) => e.httpStatus === 400);
  const cfg = await setGuildConfig(gid, { brawlhallaGuildId: " 123 ", announceJoins: false });
  assert.equal(cfg.brawlhallaGuildId, "123");
  assert.equal(cfg.announceJoins, false);
});
