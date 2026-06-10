import test from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyProgress, buildWeeklyRecapEmbed } from "../src/progression.js";

const DAY = 24 * 60 * 60 * 1000;
const now = 1_000_000_000_000;

test("classe par gain de rating 1v1 décroissant, gains positifs uniquement", () => {
  const entries = [
    { discordId: "a", name: "A", history: [{ ts: now - 6 * DAY, r1: 1000 }, { ts: now - 1 * DAY, r1: 1200 }] }, // +200
    { discordId: "b", name: "B", history: [{ ts: now - 5 * DAY, r1: 1500 }, { ts: now, r1: 1550 }] }, // +50
    { discordId: "c", name: "C", history: [{ ts: now - 5 * DAY, r1: 1300 }, { ts: now, r1: 1250 }] }, // -50 (exclu)
  ];
  const top = computeWeeklyProgress(entries, { now, limit: 5 });
  assert.deepEqual(top.map((e) => e.discordId), ["a", "b"]);
  assert.equal(top[0].delta, 200);
  assert.equal(top[0].startR1, 1000);
  assert.equal(top[0].endR1, 1200);
});

test("ignore les points hors fenêtre et les membres avec < 2 points dans la fenêtre", () => {
  const entries = [
    // point ancien hors fenêtre + un seul point récent => pas de delta mesurable
    { discordId: "a", name: "A", history: [{ ts: now - 30 * DAY, r1: 1000 }, { ts: now - 1 * DAY, r1: 1400 }] },
    { discordId: "b", name: "B", history: [{ ts: now - 2 * DAY, r1: 1100 }] }, // un seul point
  ];
  const top = computeWeeklyProgress(entries, { now });
  assert.equal(top.length, 0);
});

test("respecte la limite", () => {
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push({ discordId: String(i), name: "P" + i, history: [{ ts: now - 3 * DAY, r1: 1000 }, { ts: now, r1: 1000 + (i + 1) * 10 }] });
  }
  assert.equal(computeWeeklyProgress(entries, { now, limit: 3 }).length, 3);
});

test("buildWeeklyRecapEmbed : titre, mentions et fallback", () => {
  const e = buildWeeklyRecapEmbed([{ discordId: "a", name: "A", startR1: 1000, endR1: 1200, delta: 200 }], { guildName: "Xray" });
  assert.match(e.title, /Progression/);
  assert.match(e.description, /<@a>/);
  assert.match(e.description, /\+200/);

  const empty = buildWeeklyRecapEmbed([], {});
  assert.match(empty.description, /Personne/);
});
