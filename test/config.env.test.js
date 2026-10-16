import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_TOKEN ||= "test";
process.env.CLIENT_ID ||= "0";
process.env.GUILD_ID ||= "0";
const { envNumber } = await import("../src/config.js");

// Capture les avertissements émis pendant fn().
function withWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = orig;
  }
}

test("envNumber : absente ou vide → défaut, sans avertissement", () => {
  const { value, warnings } = withWarnings(() => [envNumber("X", 60, {}), envNumber("X", 60, { X: "" }), envNumber("X", 60, { X: "  " })]);
  assert.deepEqual(value, [60, 60, 60]);
  assert.equal(warnings.length, 0);
});

test("envNumber : nombre valide conservé, 0 compris (« 0 pour désactiver »)", () => {
  assert.equal(envNumber("X", 60, { X: "180" }), 180);
  assert.equal(envNumber("X", 500, { X: "0" }), 0);
  assert.equal(envNumber("X", 60, { X: " 15 " }), 15);
});

test("envNumber : valeur non numérique → défaut + avertissement, pas d'exception", () => {
  for (const bad of ["180m", "1h", "abc", "Infinity", "NaN"]) {
    const { value, warnings } = withWarnings(() => envNumber("LEADERBOARD_SYNC_INTERVAL_MINUTES", 180, { LEADERBOARD_SYNC_INTERVAL_MINUTES: bad }));
    assert.equal(value, 180, bad);
    assert.equal(warnings.length, 1, bad);
    assert.match(warnings[0], /LEADERBOARD_SYNC_INTERVAL_MINUTES/);
  }
});
