import test from "node:test";
import assert from "node:assert/strict";
import {
  addMessageXp,
  addVoiceXp,
  getUserStats,
  getLeaderboard,
  setUserXp,
  addUserXp,
  setUserLevel,
  resetLevels,
  setLevelConfig,
  totalXpForLevel,
} from "../src/levels.js";

// Config deterministe : pas de cooldown, gain fixe (minXp=maxXp), pas de cap ni bonus.
async function fixedConfig(guildId) {
  await setLevelConfig(guildId, {
    enabled: true,
    cooldownSec: 0,
    minXp: 20,
    maxXp: 20,
    dailyXpCap: 0,
    weekendBonus: 1,
    voiceEnabled: true,
  });
}

test("addMessageXp accorde l'XP, persiste, et calcule niveau/messages", async () => {
  const G = "g_msg";
  await fixedConfig(G);
  await resetLevels(G, null);

  const r1 = await addMessageXp(G, "u1", 1);
  assert.equal(r1.gain, 20);
  assert.equal(r1.xp, 20);
  assert.equal(r1.oldLevel, 0);

  const r2 = await addMessageXp(G, "u1", 1);
  assert.equal(r2.xp, 40);

  const s = await getUserStats(G, "u1");
  assert.equal(s.xp, 40);
  assert.equal(s.messages, 2);
});

test("cooldown : pas d'XP mais le message est compté", async () => {
  const G = "g_cd";
  await resetLevels(G, null);
  await setLevelConfig(G, { enabled: true, cooldownSec: 9999, minXp: 20, maxXp: 20, dailyXpCap: 0, weekendBonus: 1 });

  const first = await addMessageXp(G, "u1", 1);
  assert.equal(first.xp, 20);
  const second = await addMessageXp(G, "u1", 1); // en cooldown
  assert.equal(second, null);

  const s = await getUserStats(G, "u1");
  assert.equal(s.xp, 20);
  assert.equal(s.messages, 2); // les deux messages comptent
});

test("multiplier 0 = aucune XP (salon sans XP)", async () => {
  const G = "g_mult0";
  await fixedConfig(G);
  await resetLevels(G, null);
  const r = await addMessageXp(G, "u1", 0);
  assert.equal(r, null);
  const s = await getUserStats(G, "u1");
  assert.equal(s.xp, 0);
});

test("plafond journalier (dailyXpCap) borne le gain", async () => {
  const G = "g_cap";
  await resetLevels(G, null);
  await setLevelConfig(G, { enabled: true, cooldownSec: 0, minXp: 20, maxXp: 20, dailyXpCap: 30, weekendBonus: 1 });

  const r1 = await addMessageXp(G, "u1", 1);
  assert.equal(r1.gain, 20);
  const r2 = await addMessageXp(G, "u1", 1); // 20 demandés, mais reste 10
  assert.equal(r2.gain, 10);
  const r3 = await addMessageXp(G, "u1", 1); // plus rien aujourd'hui
  assert.equal(r3.gain, 0);
});

test("addVoiceXp accorde l'XP sans cooldown", async () => {
  const G = "g_voice";
  await fixedConfig(G);
  await resetLevels(G, null);
  const r1 = await addVoiceXp(G, "u1", 10, 1);
  const r2 = await addVoiceXp(G, "u1", 10, 1);
  assert.equal(r2.xp, 20);
});

test("getLeaderboard trie par XP décroissante et ignore les 0", async () => {
  const G = "g_board";
  await resetLevels(G, null);
  await setUserXp(G, "low", 100);
  await setUserXp(G, "high", 500);
  await setUserXp(G, "mid", 300);
  await setUserXp(G, "zero", 0);

  const board = await getLeaderboard(G, 10);
  assert.deepEqual(board.map((e) => e.id), ["high", "mid", "low"]);
  assert.equal(board.length, 3); // "zero" exclu
});

test("rang : nombre de membres avec strictement plus d'XP, +1", async () => {
  const G = "g_rank";
  await resetLevels(G, null);
  await setUserXp(G, "a", 500);
  await setUserXp(G, "b", 300);
  await setUserXp(G, "c", 100);

  assert.equal((await getUserStats(G, "a")).rank, 1);
  assert.equal((await getUserStats(G, "b")).rank, 2);
  assert.equal((await getUserStats(G, "c")).rank, 3);
  // Membre sans ligne : rang null.
  assert.equal((await getUserStats(G, "inconnu")).rank, null);
});

test("addUserXp / setUserLevel / reset", async () => {
  const G = "g_admin";
  await resetLevels(G, null);

  await addUserXp(G, "u1", 250);
  assert.equal((await getUserStats(G, "u1")).xp, 250);
  await addUserXp(G, "u1", -100);
  assert.equal((await getUserStats(G, "u1")).xp, 150);
  await addUserXp(G, "u1", -9999); // borné à 0
  assert.equal((await getUserStats(G, "u1")).xp, 0);

  await setUserLevel(G, "u2", 5);
  assert.equal((await getUserStats(G, "u2")).xp, totalXpForLevel(5));
  assert.equal((await getUserStats(G, "u2")).level, 5);

  // reset ciblé
  assert.equal(await resetLevels(G, "u2"), true);
  assert.equal((await getUserStats(G, "u2")).xp, 0);
  assert.equal(await resetLevels(G, "u2"), false); // n'existe plus

  // reset global
  await resetLevels(G, null);
  assert.equal((await getLeaderboard(G, 10)).length, 0);
});
