import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { setWordFilterConfig } from "../src/wordfilter.js";
import { setLolConfig } from "../src/lol.js";
import { setClipsConfig } from "../src/clips.js";
import { setGuessRankConfig } from "../src/guessrank.js";
import { onMessageUpdate, onGuildMemberUpdate, onMessageReactionAdd, EDIT_RECHECK_MS } from "../src/partialEvents.js";

/**
 * Partials (messages, réactions, membres hors cache) : les événements arrivent désormais
 * aussi pour des objets partiels. Chaque handler doit les recharger avant usage, et ignorer
 * ce qu'il ne peut pas comparer (sinon : sanctions ou accueils intempestifs).
 * Base SQLite temporaire fournie par scripts/run-tests.js.
 */

const G = "g_partials";
const NOW = 1_800_000_000_000;

test.before(async () => {
  await setWordFilterConfig(G, { enabled: true, words: ["connard"], action: "delete", warnMode: "off", checkEdits: true });
  await setLolConfig(G, { enabled: true, roleId: "lol", channelId: "lolch", mode: "text", oncePerMember: false });
  await setClipsConfig(G, { enabled: true, channelIds: ["clipch"], pinThreshold: 3 });
  await setGuessRankConfig(G, { enabled: true, channelIds: ["grch"], reactions: ["🥇", "🥈"], singleVote: true });
});

// ---------- MessageUpdate ----------

// Message (après mise à jour) contenant un terme interdit ; `deleted` = sanction appliquée.
function editedMessage(patch = {}) {
  return {
    partial: false,
    guild: { id: G, name: "Srv" },
    author: { id: "u1", bot: false, tag: "u1#0001", username: "u1" },
    member: null,
    channel: { id: "general", name: "general" },
    client: { channels: { fetch: async () => null } },
    content: "espèce de connard",
    attachments: new Collection(),
    editedTimestamp: NOW,
    deleted: false,
    async delete() { this.deleted = true; },
    ...patch,
  };
}
const OLD_PARTIAL = { partial: true, content: null };

test("MessageUpdate : vieux message hors cache épinglé (jamais modifié) => aucune sanction", async () => {
  const msg = editedMessage({ editedTimestamp: null });
  await onMessageUpdate(OLD_PARTIAL, msg, NOW);
  assert.equal(msg.deleted, false);
});

test("MessageUpdate : aperçu ajouté sur un message modifié il y a longtemps => aucune sanction", async () => {
  const msg = editedMessage({ editedTimestamp: NOW - EDIT_RECHECK_MS - 1000 });
  await onMessageUpdate(OLD_PARTIAL, msg, NOW);
  assert.equal(msg.deleted, false);
});

test("MessageUpdate : modification récente d'un message hors cache => filtre appliqué", async () => {
  const msg = editedMessage({ editedTimestamp: NOW - 2000 });
  await onMessageUpdate(OLD_PARTIAL, msg, NOW);
  assert.equal(msg.deleted, true);
});

test("MessageUpdate : texte inchangé d'un message en cache => ignoré", async () => {
  const msg = editedMessage();
  await onMessageUpdate({ partial: false, content: msg.content }, msg, NOW);
  assert.equal(msg.deleted, false);
});

test("MessageUpdate : nouveau message partiel rechargé avant le filtre ; fetch en échec => ignoré", async () => {
  const msg = editedMessage({ partial: true, content: null, editedTimestamp: null });
  msg.fetch = async function () {
    Object.assign(this, { partial: false, content: "sale connard", editedTimestamp: NOW });
    return this;
  };
  await onMessageUpdate(OLD_PARTIAL, msg, NOW);
  assert.equal(msg.deleted, true, "texte rechargé puis filtré");

  const gone = editedMessage({ partial: true, content: null, fetch: async () => { throw new Error("Unknown Message"); } });
  await assert.doesNotReject(onMessageUpdate(OLD_PARTIAL, gone, NOW));
  assert.equal(gone.deleted, false);
});

// ---------- GuildMemberUpdate (accueil LoL) ----------

function lolMember(roleIds, sent) {
  return {
    id: "m1",
    displayName: "Kaya",
    user: { id: "m1", username: "kaya" },
    guild: {
      id: G,
      name: "Srv",
      memberCount: 10,
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => sent.push(p) }) },
    },
    roles: { cache: new Collection(roleIds.map((id) => [id, { id }])) },
  };
}

test("GuildMemberUpdate : ancien membre partiel => pas d'accueil LoL (rôles d'avant inconnus)", async () => {
  const sent = [];
  // Membre hors cache qui a déjà le rôle LoL et change simplement de pseudo.
  const oldMember = { partial: true, roles: { cache: new Collection([[G, { id: G }]]) } };
  await onGuildMemberUpdate(oldMember, lolMember([G, "lol"], sent));
  assert.equal(sent.length, 0);
});

test("GuildMemberUpdate : rôle LoL réellement ajouté => accueil", async () => {
  const sent = [];
  const oldMember = { partial: false, roles: { cache: new Collection([[G, { id: G }]]) } };
  await onGuildMemberUpdate(oldMember, lolMember([G, "lol"], sent));
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /League of Legends/);
});

// ---------- MessageReactionAdd (clips, devine ton rang) ----------

function reactionOn(message, emoji, { fetchOk = true } = {}) {
  return {
    partial: true,
    count: null,
    emoji: { id: null, name: emoji },
    message,
    async fetch() {
      if (!fetchOk) throw new Error("Unknown Message");
      await message.fetch();
      this.partial = false;
      return this;
    },
  };
}

// Message hors cache : ses réactions (compteurs, votants) n'arrivent qu'au fetch.
function partialMessage(channelId, reactions) {
  return {
    partial: true,
    id: "msg1",
    channelId,
    guild: { id: G },
    pinned: false,
    pins: 0,
    reactions: { cache: new Collection() },
    async fetch() {
      this.partial = false;
      for (const r of reactions) this.reactions.cache.set(r.emoji.name, r);
      return this;
    },
    async pin() { this.pins++; },
  };
}

function rankReaction(emoji, count, voters, removed) {
  return {
    emoji: { id: null, name: emoji },
    count,
    users: {
      cache: new Set(voters),
      fetch: async () => {},
      remove: async (id) => removed.push([emoji, id]),
    },
  };
}

test("MessageReactionAdd : clip hors cache rechargé puis épinglé au seuil", async () => {
  const message = partialMessage("clipch", [rankReaction("🔥", 3, [], [])]);
  await onMessageReactionAdd(reactionOn(message, "🔥"), { id: "u2", bot: false });
  assert.equal(message.pins, 1);
});

test("MessageReactionAdd : message supprimé (fetch en échec) => abandon sans erreur", async () => {
  const message = partialMessage("clipch", [rankReaction("🔥", 9, [], [])]);
  await assert.doesNotReject(onMessageReactionAdd(reactionOn(message, "🔥", { fetchOk: false }), { id: "u2", bot: false }));
  assert.equal(message.pins, 0);
});

test("MessageReactionAdd : vote unique sur un message hors cache, l'ancien vote est retiré", async () => {
  const removed = [];
  const message = partialMessage("grch", [rankReaction("🥇", 1, ["u3"], removed), rankReaction("🥈", 2, ["u3", "u4"], removed)]);
  await onMessageReactionAdd(reactionOn(message, "🥇"), { id: "u3", bot: false });
  assert.deepEqual(removed, [["🥈", "u3"]]);
});
