import test from "node:test";
import assert from "node:assert/strict";
import { parseReactions, parseDomains, isVideoClip } from "../src/clips.js";

test("parseReactions sépare unicode et emojis custom, garde l'ordre", () => {
  const r = parseReactions("🔥 👍 <:pog:123456789>");
  assert.deepEqual(r, ["🔥", "👍", "<:pog:123456789>"]);
});

test("parseReactions limite à 20 emojis", () => {
  const many = Array.from({ length: 30 }, () => "🔥").join(" ");
  assert.equal(parseReactions(many).length, 20);
});

test("parseReactions vide -> tableau vide", () => {
  assert.deepEqual(parseReactions(""), []);
  assert.deepEqual(parseReactions(null), []);
});

test("parseDomains nettoie, déduplique et retire le protocole", () => {
  const d = parseDomains("https://catbox.moe/, catbox.moe, DUBZ.gg");
  assert.deepEqual(d, ["catbox.moe", "dubz.gg"]);
});

test("isVideoClip détecte un lien d'hébergeur connu", () => {
  const msg = { content: "regarde https://medal.tv/clip/xyz", attachments: new Map(), embeds: [] };
  assert.equal(isVideoClip(msg), true);
});

test("isVideoClip détecte une extension vidéo et un domaine perso", () => {
  assert.equal(isVideoClip({ content: "https://site/x.mp4", attachments: new Map(), embeds: [] }), true);
  assert.equal(isVideoClip({ content: "https://perso.fr/v", attachments: new Map(), embeds: [] }, ["perso.fr"]), true);
});

test("isVideoClip est faux pour un message texte sans vidéo", () => {
  assert.equal(isVideoClip({ content: "salut ça va", attachments: new Map(), embeds: [] }), false);
});

test("isVideoClip détecte une pièce jointe vidéo", () => {
  const att = new Map([["1", { contentType: "video/mp4", name: "clip.mp4", url: "x" }]]);
  assert.equal(isVideoClip({ content: "", attachments: att, embeds: [] }), true);
});
