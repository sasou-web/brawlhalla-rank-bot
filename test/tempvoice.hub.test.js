import test from "node:test";
import assert from "node:assert/strict";
import { setTempConfig, addHub, isTempChannel, getTempChannelIds } from "../src/tempvoice.js";
import { handleTempVoice } from "../src/voiceManager.js";

/**
 * Hub « rejoindre pour créer » : un salon n'est créé qu'à l'entrée dans le hub (pas à chaque
 * bascule micro / casque / caméra), et jamais laissé orphelin si le déplacement échoue.
 * Base SQLite temporaire fournie par scripts/run-tests.js.
 */

const G = "g_tv_hub";
const HUB = "hub1";

// Serveur factice : `moveOk` simule le résultat de member.voice.setChannel.
function mockGuild({ moveOk, prefix }) {
  const created = [];
  const guild = {
    id: G,
    channels: {
      cache: new Map([[HUB, { id: HUB, parentId: "cat" }]]),
      fetch: async () => null,
      create: async (opts) => {
        const ch = {
          id: `${prefix}${created.length + 1}`,
          opts,
          deleted: false,
          members: new Map(),
          permissionOverwrites: { edit: async () => {} },
          send: async () => ({}),
          async delete() { this.deleted = true; },
        };
        created.push(ch);
        return ch;
      },
    },
  };
  const member = {
    id: "u1",
    displayName: "Kaya",
    guild,
    voice: {
      setChannel: async () => {
        if (!moveOk) throw new Error("Target user is not connected to voice.");
      },
    },
  };
  const state = (channelId) => ({ guild, channelId, member });
  return { guild, member, created, state };
}

test.before(async () => {
  await setTempConfig(G, { enabled: true });
  await addHub(G, HUB, { nameTemplate: "🎮 {user}" });
});

test("entrée dans le hub : un salon créé ; bascule micro sur place : aucun salon", async () => {
  const { created, state } = mockGuild({ moveOk: true, prefix: "ok" });
  await handleTempVoice(state(null), state(HUB));
  assert.equal(created.length, 1, "salon créé à l'entrée");
  assert.equal(await isTempChannel(G, created[0].id), true);

  // Micro coupé / casque / caméra : même salon avant et après.
  await handleTempVoice(state(HUB), state(HUB));
  await handleTempVoice(state(HUB), state(HUB));
  assert.equal(created.length, 1, "aucun salon supplémentaire");
});

test("déplacement impossible : le salon créé est supprimé et oublié", async () => {
  const { created, state } = mockGuild({ moveOk: false, prefix: "ko" });
  const before = (await getTempChannelIds(G)).length;
  await handleTempVoice(state(null), state(HUB));
  assert.equal(created.length, 1);
  assert.equal(created[0].deleted, true, "pas de salon orphelin");
  assert.equal(await isTempChannel(G, created[0].id), false);
  assert.equal((await getTempChannelIds(G)).length, before);
});
