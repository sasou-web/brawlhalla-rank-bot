import test from "node:test";
import assert from "node:assert/strict";
import { setLfgConfig, findOpenPostByAuthor, canPublish, modeFromRoleMentions, noteFromMessage, DEFAULT_LFG_CONFIG } from "../src/lfg.js";
import { handleLfg, handleLfgMention } from "../src/commands/lfg.js";

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

const ROLE_1V1 = "900001";
const ROLE_2V2 = "900002";

test.before(async () => {
  await setLfgConfig(G, { enabled: true, channelId: CHANNEL, requireLink: true, pingRole1v1: ROLE_1V1, pingRole2v2: ROLE_2V2 });
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

// ---------- Annonce par ping du rôle ----------

test("modeFromRoleMentions : le rôle de recherche mentionné donne le mode", () => {
  const cfg = { ...DEFAULT_LFG_CONFIG, pingRole1v1: ROLE_1V1, pingRole2v2: ROLE_2V2 };
  assert.equal(modeFromRoleMentions(cfg, [ROLE_2V2]), "2v2");
  assert.equal(modeFromRoleMentions(cfg, ["123", ROLE_1V1, ROLE_2V2]), "1v1", "premier rôle de recherche mentionné");
  assert.equal(modeFromRoleMentions(cfg, ["123"]), null);
  assert.equal(modeFromRoleMentions({ ...DEFAULT_LFG_CONFIG }, [""]), null, "rôle non configuré : jamais de correspondance");
});

test("noteFromMessage : retire les mentions de rôle et @everyone", () => {
  assert.equal(noteFromMessage(`<@&${ROLE_2V2}>   1800 @everyone dispo`), "1800 dispo");
  assert.equal(noteFromMessage(`<@&${ROLE_1V1}>`), "");
});

function fakeMessage(userId, roleIds, { channelId = CHANNEL, content = "" } = {}) {
  const sent = [];
  const replies = [];
  const message = {
    id: `msg_${userId}`,
    content: content || roleIds.map((r) => `<@&${r}>`).join(" "),
    author: { id: userId, bot: false },
    guild: { id: G },
    channelId,
    mentions: { roles: new Map(roleIds.map((r) => [r, { id: r }])) },
    channel: {
      id: channelId,
      send: async (payload) => {
        sent.push(payload);
        return { id: `card_${userId}` };
      },
    },
    reply: async (payload) => {
      replies.push(payload);
      return { delete: async () => {} };
    },
  };
  return { message, sent, replies };
}

test("ping de « Recherche 1v1 » dans le salon LFG : carte créée en réponse, sans repinguer", async () => {
  const { message, sent } = fakeMessage("u_ping_1v1", [ROLE_1V1], { content: `<@&${ROLE_1V1}> qui pour s'entraîner ?` });
  assert.equal(await handleLfgMention(message), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].reply, { messageReference: "msg_u_ping_1v1", failIfNotExists: false });
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
  const post = findOpenPostByAuthor(G, "u_ping_1v1");
  assert.equal(post.mode, "1v1");
  assert.equal(post.text, "qui pour s'entraîner ?");
  assert.equal(post.voice, true);
  assert.equal(post.pingRoleId, "", "le rôle n'est pas repingé");
  assert.equal(post.messageId, "card_u_ping_1v1");
});

test("ping hors du salon LFG ou sans rôle de recherche : rien", async () => {
  const elsewhere = fakeMessage("u_ping_elsewhere", [ROLE_2V2], { channelId: "555555" });
  assert.equal(await handleLfgMention(elsewhere.message), false);
  assert.equal(elsewhere.sent.length + elsewhere.replies.length, 0);
  const other = fakeMessage("u_ping_other", ["123"]);
  assert.equal(await handleLfgMention(other.message), false);
  assert.equal(other.sent.length + other.replies.length, 0);
});

test("ping de « Recherche 2v2 » sans compte lié : refus en réponse, pas d'annonce", async () => {
  const { message, sent, replies } = fakeMessage("u_ping_2v2", [ROLE_2V2]);
  assert.equal(await handleLfgMention(message), false);
  assert.equal(sent.length, 0);
  assert.match(replies[0].content, /\/lier/);
  assert.equal(findOpenPostByAuthor(G, "u_ping_2v2"), null);
});

test("ping alors qu'une annonce est déjà active : pas de doublon", async () => {
  const { message, sent, replies } = fakeMessage("u_ping_1v1", [ROLE_1V1]);
  assert.equal(await handleLfgMention(message), false);
  assert.equal(sent.length, 0);
  assert.match(replies[0].content, /déjà une annonce active/);
});
