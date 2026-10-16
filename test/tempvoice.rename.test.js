import test from "node:test";
import assert from "node:assert/strict";
import { addTempChannel } from "../src/tempvoice.js";
import { handleVoiceControlModal, renameWaitMs } from "../src/commands/panels/tempvoice.js";

/**
 * Renommage d'un vocal temporaire : Discord limite à 2 changements de nom par 10 min et met
 * le 3e en attente (sans erreur). Le bot doit accuser réception AVANT d'appeler Discord et
 * refuser lui-même le renommage de trop au lieu de laisser l'interaction expirer.
 */

const G = "g_tv_rename";
const MIN = 60_000;

test("renameWaitMs : 2 renommages autorisés par fenêtre glissante de 10 min", () => {
  const now = 100 * MIN;
  assert.equal(renameWaitMs([], now), 0);
  assert.equal(renameWaitMs(undefined, now), 0);
  assert.equal(renameWaitMs([now - MIN], now), 0);
  assert.equal(renameWaitMs([now - 3 * MIN, now - MIN], now), 7 * MIN, "libre quand le plus ancien sort de la fenêtre");
  assert.equal(renameWaitMs([now - 11 * MIN, now - MIN], now), 0, "les renommages anciens ne comptent plus");
});

function mockRename(channel, name, events) {
  return {
    customId: "vc_rename_modal",
    channel,
    guild: { id: G },
    user: { id: "owner" },
    memberPermissions: { has: () => false },
    fields: { getTextInputValue: () => name },
    reply: async (p) => { events.push(["reply", p]); },
    deferReply: async (p) => { events.push(["deferReply", p]); },
    editReply: async (p) => { events.push(["editReply", p]); },
  };
}

test("renommage : accusé avant setName, puis refus propre au 3e renommage", async () => {
  const events = [];
  const channel = { id: "vc_ok", setName: async (n) => { events.push(["setName", n]); } };
  await addTempChannel(G, channel.id, "owner");

  await handleVoiceControlModal(mockRename(channel, "1v1", events), {});
  assert.deepEqual(events.map((e) => e[0]), ["deferReply", "setName", "editReply"]);
  assert.match(events[2][1].content, /renommé en \*\*1v1\*\*/);
  assert.deepEqual(events[2][1].allowedMentions, { parse: [] });

  await handleVoiceControlModal(mockRename(channel, "1v1 chill", events), {});
  events.length = 0;
  await handleVoiceControlModal(mockRename(channel, "ranked", events), {});
  assert.deepEqual(events.map((e) => e[0]), ["reply"], "3e renommage refusé sans appeler Discord");
  assert.match(events[0][1].content, /2 renommages par 10 min/);
  assert.ok(events[0][1].flags, "refus en éphémère");
});

test("renommage refusé par Discord : pas de faux « Salon renommé »", async () => {
  const events = [];
  const channel = { id: "vc_err", setName: async () => { throw new Error("Missing Permissions"); } };
  await addTempChannel(G, channel.id, "owner");
  await handleVoiceControlModal(mockRename(channel, "nouveau", events), {});
  const last = events.at(-1)[1];
  assert.match(last.content, /❌/);
  assert.doesNotMatch(last.content, /renommé en/);
});
