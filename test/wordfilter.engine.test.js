import test from "node:test";
import assert from "node:assert/strict";
import { compileFilter, findMatches, maskText, matchedTerms } from "../src/wordfilterEngine.js";

/**
 * Moteur du filtre de mots : les « polices » Unicode (générateurs de fancy text) doivent être
 * ramenées aux lettres latines, sans perdre les positions d'origine (action « mask »).
 */

const filter = compileFilter({ words: ["connard", "con", "negro"] });
const hits = (text, f = filter) => matchedTerms(findMatches(text, f));

// Décale chaque lettre a-z d'un mot vers un bloc Unicode (ex. lettres mathématiques).
const shift = (word, base) => [...word].map((ch) => String.fromCodePoint(base + ch.charCodeAt(0) - 97)).join("");

test("exemples du rapport : gras mathématique, pleine chasse, petites capitales, remplissage hangul", () => {
  for (const text of ["𝐜𝐨𝐧𝐧𝐚𝐫𝐝", "ｃｏｎｎａｒｄ", "ᴄᴏɴɴᴀʀᴅ", "cㅤonnard"]) {
    assert.deepEqual(hits(text), ["connard"], `détecté : ${text}`);
  }
});

test("lettres cerclées, en exposant et capitales mathématiques (NFKD avant les minuscules)", () => {
  assert.deepEqual(hits("ⓒⓞⓝⓝⓐⓡⓓ"), ["connard"]);
  assert.deepEqual(hits("ᶜᵒⁿⁿᵃʳᵈ"), ["connard"]);
  assert.deepEqual(hits(shift("connard", 0x1d400)), ["connard"], "capitales grasses 𝐂𝐎𝐍𝐍𝐀𝐑𝐃");
  assert.deepEqual(hits(shift("connard", 0x1d5ee)), ["connard"], "sans-serif gras");
  assert.deepEqual(hits("ｃ０ｎｎ４ｒｄ"), ["connard"], "pleine chasse + leet");
});

test("caractères invisibles (Default_Ignorable) retirés, quels qu'ils soient", () => {
  for (const inv of ["​", "­", "⁠", "ㅤ", "ﾠ", "ᅟ", "͏"]) {
    assert.deepEqual(hits(`co${inv}nnard`), ["connard"], `U+${inv.codePointAt(0).toString(16)}`);
  }
});

test("positions d'origine conservées : le masquage couvre exactement le mot fancy", () => {
  const text = "salut 𝐜𝐨𝐧𝐧𝐚𝐫𝐝 !";
  const m = findMatches(text, filter);
  assert.equal(m.length, 1);
  assert.equal(text.slice(m[0].start, m[0].end), "𝐜𝐨𝐧𝐧𝐚𝐫𝐝");
  assert.equal(maskText(text, m), "salut ******* !");

  const hangul = "toi cㅤonnard";
  const mh = findMatches(hangul, filter);
  assert.equal(hangul.slice(mh[0].start, mh[0].end), "cㅤonnard");
});

test("normalisation sans contournements : les lettres fancy restent détectées (NFKD toujours actif)", () => {
  const strict = compileFilter({ words: ["connard"], evasion: false });
  assert.deepEqual(hits("ｃｏｎｎａｒｄ", strict), ["connard"]);
  assert.deepEqual(hits("c​onnard", strict), ["connard"]);
});

test("pas de nouveaux faux positifs sur du texte normal", () => {
  assert.deepEqual(hits("un super concert au Monténégro, ﬁni à minuit"), []);
  assert.deepEqual(hits("Ｍｏｎｔｅｎｅｇｒｏ"), [], "mot entier : pleine chasse comprise");
  assert.deepEqual(hits("Ça va ? Œuvre complète, élève."), []);
});
