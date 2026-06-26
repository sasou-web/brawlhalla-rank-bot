import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStartggEventSlug, normalizeName } from "../src/startgg.js";

test("parseStartggEventSlug : URL complète -> slug d'événement", () => {
  assert.equal(
    parseStartggEventSlug("https://www.start.gg/tournament/my-cup/event/1v1-singles"),
    "tournament/my-cup/event/1v1-singles",
  );
});

test("parseStartggEventSlug : ignore query string et fragment", () => {
  assert.equal(
    parseStartggEventSlug("https://start.gg/tournament/my-cup/event/1v1?page=2#bracket"),
    "tournament/my-cup/event/1v1",
  );
});

test("parseStartggEventSlug : accepte un slug déjà au bon format", () => {
  assert.equal(parseStartggEventSlug("tournament/abc/event/xyz"), "tournament/abc/event/xyz");
});

test("parseStartggEventSlug : lien sans événement -> erreur", () => {
  assert.throws(() => parseStartggEventSlug("https://www.start.gg/tournament/my-cup"), /événement/i);
  assert.throws(() => parseStartggEventSlug(""), /manquant/i);
});

test("normalizeName : retire accents, espaces et casse", () => {
  assert.equal(normalizeName("Kaya GoldForged"), "kayagoldforged");
  assert.equal(normalizeName("Éléa_2v2!"), "elea2v2");
  assert.equal(normalizeName(null), "");
});
