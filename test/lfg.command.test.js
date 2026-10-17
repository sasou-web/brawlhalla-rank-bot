import test from "node:test";
import assert from "node:assert/strict";
import { setLfgConfig, findOpenPostByAuthor, canPublish, DEFAULT_LFG_CONFIG } from "../src/lfg.js";
import { handleLfg } from "../src/commands/lfg.js";

/**
 * /lfg de bout en bout avec un faux Discord : « Exiger un compte lié » ne bloque que le
 * 2v2/3v3, le 1v1 entraînement se publie sans compte lié. Base temporaire de run-tests.js.
 */

const G = "g_lfg_cmd";
const CHANNEL = "444444";

function fakeInteraction(userId, mode, { vocal = null } = {}) {
  const sent = [];
  const replies = [];
  const channel = {
    id: CHANNEL,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => false }),
    send: async (payload) => {
      sent.push(payload);
      return { id: `m_${userId}`, url: `https://discord.com/channels/${G}/${CHANNEL}/m_${userId}` };
    },
  };
  const interaction = {
    guildId: G,
    user: { id: userId },
    guild: {
      id: G,
      channels: { fetch: async (id) => (id === CHANNEL ? channel : null) },
      roles: { cache: new Map() },
      members: { me: {} },
    },
    options: { getString: (name) => (name === "mode" ? mode : null), getBoolean: (name) => (name === "vocal" ? vocal : null) },
    reply: async (p) => replies.push(p),
    deferReply: async () => {},
    editReply: async (p) => replies.push(p),
  };
  return { interaction, sent, replies };
}

test.before(async () => {
  await setLfgConfig(G, { enabled: true, channelId: CHANNEL, requireLink: true });
});

test("canPublish : compte lié exigé en 2v2/3v3 seulement", () => {
  const cfg = { ...DEFAULT_LFG_CONFIG, requireLink: true };
  assert.deepEqual(canPublish("1v1", null, cfg), { ok: true });
  assert.equal(canPublish("2v2", null, cfg).reason, "not_linked");
  assert.equal(canPublish("3v3", null, cfg).reason, "not_linked");
  assert.deepEqual(canPublish("2v2", { brawlhallaId: 1 }, cfg), { ok: true });
  assert.deepEqual(canPublish("2v2", null, { ...cfg, requireLink: false }), { ok: true });
  assert.equal(canPublish("4v4", null, cfg).reason, "mode");
});

test("/lfg 1v1 sans compte lié : annonce publiée malgré « Exiger un compte lié »", async () => {
  const { interaction, sent, replies } = fakeInteraction("u_1v1_nolink", "1v1");
  await handleLfg(interaction);
  assert.equal(sent.length, 1, "carte envoyée dans le salon LFG");
  assert.match(String(replies.at(-1)), /Annonce publiée/);
  assert.equal(findOpenPostByAuthor(G, "u_1v1_nolink")?.mode, "1v1");
  assert.equal(findOpenPostByAuthor(G, "u_1v1_nolink")?.voice, true, "vocal par défaut");
});

test("/lfg vocal:false : annonce marquée « Sans voc »", async () => {
  const { interaction } = fakeInteraction("u_novoice", "1v1", { vocal: false });
  await handleLfg(interaction);
  assert.equal(findOpenPostByAuthor(G, "u_novoice")?.voice, false);
});

test("/lfg 2v2 sans compte lié : refusé avec renvoi vers /lier", async () => {
  const { interaction, sent, replies } = fakeInteraction("u_2v2_nolink", "2v2");
  await handleLfg(interaction);
  assert.equal(sent.length, 0);
  assert.match(replies[0].content, /\/lier/);
  assert.equal(findOpenPostByAuthor(G, "u_2v2_nolink"), null);
});
