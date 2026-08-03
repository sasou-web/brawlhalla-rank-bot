import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration, formatDuration, drawWinners } from "../src/giveaway.js";

/**
 * Duree et tirage au sort des giveaways.
 *
 * parseDuration decide QUAND un concours se termine : une saisie mal interpretee
 * cloture au mauvais moment. drawWinners decide QUI gagne : il ne doit jamais
 * tirer deux fois la meme personne ni un exclu (cas du reroll).
 */

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const W = 7 * D;

test("parseDuration : unites simples", () => {
  assert.equal(parseDuration("10s"), 10 * S);
  assert.equal(parseDuration("30m"), 30 * MIN);
  assert.equal(parseDuration("2h"), 2 * H);
  assert.equal(parseDuration("1d"), D);
  assert.equal(parseDuration("1w"), W);
});

test("parseDuration : unites combinees", () => {
  assert.equal(parseDuration("1d12h"), D + 12 * H);
  assert.equal(parseDuration("1h30m"), H + 30 * MIN);
  assert.equal(parseDuration("1m30s"), MIN + 30 * S);
  assert.equal(parseDuration("1w2d3h4m5s"), W + 2 * D + 3 * H + 4 * MIN + 5 * S);
});

test("parseDuration : tolerant a la casse et aux espaces", () => {
  assert.equal(parseDuration("1D 12H"), D + 12 * H);
  assert.equal(parseDuration("2 h"), 2 * H);
  assert.equal(parseDuration("  45m  "), 45 * MIN);
});

test("parseDuration : un nombre nu est interprete en minutes", () => {
  assert.equal(parseDuration("45"), 45 * MIN);
  assert.equal(parseDuration("1"), MIN);
});

test("parseDuration : entree numerique = millisecondes telles quelles", () => {
  assert.equal(parseDuration(5000), 5000);
  assert.equal(parseDuration(0), 0);
  assert.equal(parseDuration(-1), 0, "duree negative ramenee a 0");
});

test("parseDuration : entrees invalides donnent 0 (pas de NaN)", () => {
  for (const bad of ["", "abc", "  ", null, undefined, {}, [], true, "0", "-5"]) {
    const r = parseDuration(bad);
    assert.equal(Number.isFinite(r), true, `${JSON.stringify(bad)} doit donner un nombre fini`);
    assert.equal(r, 0, `${JSON.stringify(bad)} doit donner 0`);
  }
});

test("formatDuration : lisible et jamais vide", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(-500), "0 min");
  assert.equal(formatDuration(5 * S), "5 s");
  assert.equal(formatDuration(MIN + 30 * S), "1 min 30 s");
  assert.equal(formatDuration(H), "1 h");
  assert.equal(formatDuration(D), "1 j");
  assert.equal(formatDuration(D + 12 * H), "1 j 12 h");
});

test("formatDuration : les secondes sont masquees des qu'il y a des heures ou des jours", () => {
  // Au-dela de l'heure, afficher les secondes n'apporte rien.
  assert.equal(formatDuration(H + 30 * S), "1 h");
  assert.equal(formatDuration(D + 30 * S), "1 j");
});

test("parseDuration et formatDuration font l'aller-retour sur les cas courants", () => {
  for (const input of ["30m", "2h", "1d", "1d12h"]) {
    const ms = parseDuration(input);
    assert.ok(ms > 0, `${input} doit donner une duree positive`);
    assert.equal(parseDuration(formatDuration(ms).replace(/\s?j/, "d").replace(/\s/g, "")), ms);
  }
});

test("drawWinners : respecte le nombre demande, sans doublon", () => {
  const entries = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 200; i++) {
    const w = drawWinners(entries, 3);
    assert.equal(w.length, 3);
    assert.equal(new Set(w).size, 3, "aucun doublon");
    for (const id of w) assert.ok(entries.includes(id), "gagnant issu du pool");
  }
});

test("drawWinners : exclut les identifiants fournis (cas du reroll)", () => {
  const entries = ["a", "b", "c", "d"];
  for (let i = 0; i < 200; i++) {
    const w = drawWinners(entries, 2, ["a", "b"]);
    assert.equal(w.length, 2);
    assert.deepEqual(w.slice().sort(), ["c", "d"], "seuls les non-exclus restent");
  }
});

test("drawWinners : ne renvoie jamais plus que le pool disponible", () => {
  assert.equal(drawWinners(["a", "b"], 5).length, 2);
  assert.equal(drawWinners([], 3).length, 0);
  assert.equal(drawWinners(["a", "b", "c"], 3, ["a", "b", "c"]).length, 0, "tout le monde exclu");
});

test("drawWinners : nombre nul ou negatif renvoie une liste vide", () => {
  assert.deepEqual(drawWinners(["a", "b", "c"], 0), []);
  assert.deepEqual(drawWinners(["a", "b", "c"], -2), []);
});

test("drawWinners : le tirage n'est pas biaise vers le premier inscrit", () => {
  // Avec un seul gagnant sur 5 participants, chacun doit sortir au moins une fois
  // sur 500 tirages (probabilite de rater ~ (4/5)^500, negligeable).
  const entries = ["a", "b", "c", "d", "e"];
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(drawWinners(entries, 1)[0]);
  assert.deepEqual([...seen].sort(), entries, "tous les participants peuvent gagner");
});

test("drawWinners : n'altere pas le tableau d'entrees", () => {
  const entries = ["a", "b", "c", "d"];
  const copy = [...entries];
  drawWinners(entries, 2);
  assert.deepEqual(entries, copy, "le pool d'origine reste intact");
});
