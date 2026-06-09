import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_TOKEN ||= "test";
process.env.CLIENT_ID ||= "test";
process.env.GUILD_ID ||= "test";

const { xpForLevel, totalXpForLevel, levelFromTotalXp } = await import("../src/levels.js");

test("xpForLevel suit la courbe 5l² + 50l + 100", () => {
  assert.equal(xpForLevel(0), 100);
  assert.equal(xpForLevel(1), 155);
  assert.equal(xpForLevel(5), 475);
});

test("totalXpForLevel = somme des paliers précédents", () => {
  assert.equal(totalXpForLevel(0), 0);
  assert.equal(totalXpForLevel(1), xpForLevel(0));
  assert.equal(totalXpForLevel(3), xpForLevel(0) + xpForLevel(1) + xpForLevel(2));
});

test("levelFromTotalXp est l'inverse de totalXpForLevel (au seuil)", () => {
  for (const lvl of [0, 1, 5, 10, 25, 50]) {
    const info = levelFromTotalXp(totalXpForLevel(lvl));
    assert.equal(info.level, lvl, `niveau ${lvl}`);
    assert.equal(info.xpIntoLevel, 0, `xpIntoLevel au seuil du niveau ${lvl}`);
    assert.equal(info.xpForNext, xpForLevel(lvl));
  }
});

test("levelFromTotalXp : progression au milieu d'un niveau", () => {
  const base = totalXpForLevel(4);
  const info = levelFromTotalXp(base + 50);
  assert.equal(info.level, 4);
  assert.equal(info.xpIntoLevel, 50);
});

test("0 XP = niveau 0", () => {
  const info = levelFromTotalXp(0);
  assert.equal(info.level, 0);
  assert.equal(info.xpIntoLevel, 0);
});
