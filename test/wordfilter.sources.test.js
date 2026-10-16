import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { setWordFilterConfig, handleWordFilter, getWordFilterStatus } from "../src/wordfilter.js";

/**
 * Filtre de mots : le texte d'un message transféré, d'un sondage ou d'un nom de fichier est
 * analysé comme le reste. « mask » ne sachant masquer que le texte du message, un terme
 * trouvé ailleurs entraîne la suppression. Base SQLite temporaire.
 */

const G = "g_wf_sources";

// Message factice ; `hooks` enregistre les republications par webhook (action « mask »).
function mockMessage(patch = {}) {
  const hooks = [];
  const channel = {
    id: `ch-${Math.random().toString(36).slice(2)}`,
    name: "general",
    client: { user: { id: "bot" } },
    fetchWebhooks: async () => [],
    createWebhook: async () => ({ owner: { id: "bot" }, send: async (p) => hooks.push(p) }),
  };
  const message = {
    guild: { id: G, name: "Srv" },
    author: { id: "u1", bot: false, tag: "u1#0001", username: "u1", displayAvatarURL: () => "" },
    member: null,
    channel,
    client: { channels: { fetch: async () => null } },
    content: "",
    attachments: new Collection(),
    deleted: false,
    async delete() { this.deleted = true; },
    ...patch,
  };
  return { message, hooks };
}

const lastAction = async () => (await getWordFilterStatus(G)).recent[0];

test.before(async () => {
  await setWordFilterConfig(G, { enabled: true, words: ["connard"], action: "mask", warnMode: "off" });
});

test("message transféré : texte du snapshot analysé, « mask » retombe sur « delete »", async () => {
  const { message, hooks } = mockMessage({
    messageSnapshots: new Collection([["s1", { content: "quel connard", attachments: new Collection() }]]),
  });
  assert.equal(await handleWordFilter(message), true);
  assert.equal(message.deleted, true);
  assert.equal(hooks.length, 0, "rien n'est republié");
  const entry = await lastAction();
  assert.equal(entry.action, "delete");
  assert.deepEqual(entry.terms, ["connard"]);
  assert.match(entry.excerpt, /quel \*+/);
});

test("sondage : question et réponses analysées", async () => {
  const { message } = mockMessage({
    poll: { question: { text: "Qui est le plus" }, answers: new Collection([[1, { text: "toi" }], [2, { text: "c0nnard" }]]) },
  });
  assert.equal(await handleWordFilter(message), true);
  assert.equal((await lastAction()).action, "delete");
});

test("nom de fichier analysé, même avec un texte propre : suppression (pas de republication)", async () => {
  const { message, hooks } = mockMessage({
    content: "regardez ça",
    attachments: new Collection([["a1", { name: "connard.png", size: 10, url: "https://cdn/x" }]]),
  });
  assert.equal(await handleWordFilter(message), true);
  assert.equal(hooks.length, 0);
  assert.equal((await lastAction()).action, "delete");
});

test("terme dans le texte seulement : « mask » republie le texte masqué", async () => {
  const { message, hooks } = mockMessage({ content: "espèce de connard" });
  assert.equal(await handleWordFilter(message), true);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].content, "espèce de \\*\\*\\*\\*\\*\\*\\*");
  assert.equal((await lastAction()).action, "mask");
});

test("message propre partout : aucune action", async () => {
  const { message } = mockMessage({
    content: "salut",
    attachments: new Collection([["a1", { name: "clip.mp4", size: 10 }]]),
    poll: { question: { text: "On joue ?" }, answers: new Collection([[1, { text: "oui" }]]) },
  });
  assert.equal(await handleWordFilter(message), false);
  assert.equal(message.deleted, false);
});
