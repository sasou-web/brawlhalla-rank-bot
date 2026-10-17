import test from "node:test";
import assert from "node:assert/strict";
import {
  setLfgConfig,
  findOpenPostByAuthor,
  canPublish,
  modeFromRoleMentions,
  noteFromMessage,
  markPinged,
  pingCooldownLeft,
  DEFAULT_LFG_CONFIG,
} from "../src/lfg.js";
import { handleLfg, handleLfgMention } from "../src/commands/lfg.js";
import { onMessageUpdate } from "../src/partialEvents.js";
import { setLink } from "../src/store.js";

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

function fakeMessage(userId, roleIds, { channelId = CHANNEL, content = "", id = `msg_${userId}`, sendFails = null, ...extra } = {}) {
  const sent = [];
  const replies = [];
  const message = {
    id,
    content: content || roleIds.map((r) => `<@&${r}>`).join(" "),
    author: { id: userId, bot: false },
    guild: { id: G },
    channelId,
    mentions: { roles: new Map(roleIds.map((r) => [r, { id: r }])), everyone: false },
    channel: {
      id: channelId,
      send: async (payload) => {
        if (sendFails) throw new Error(sendFails);
        sent.push(payload);
        return { id: `card_${id}` };
      },
    },
    reply: async (payload) => {
      replies.push(payload);
      return { delete: async () => {} };
    },
    ...extra,
  };
  return { message, sent, replies };
}

test("ping de « Recherche 1v1 » dans le salon LFG : carte créée en réponse, sans repinguer", async () => {
  const { message, sent } = fakeMessage("u_ping_1v1", [ROLE_1V1], { content: `<@&${ROLE_1V1}> qui pour s'entraîner ?` });
  assert.equal(await handleLfgMention(message), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].reply, { messageReference: "msg_u_ping_1v1", failIfNotExists: true });
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
  const post = findOpenPostByAuthor(G, "u_ping_1v1");
  assert.equal(post.mode, "1v1");
  assert.equal(post.text, "qui pour s'entraîner ?");
  assert.equal(post.voice, true);
  assert.equal(post.pingRoleId, "", "le rôle n'est pas repingé");
  assert.equal(post.messageId, "card_msg_u_ping_1v1");
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
  assert.match(replies[0].content, /déjà une annonce 1v1 entraînement active/);
  assert.match(replies[0].content, /card_msg_u_ping_1v1/, "lien vers la carte existante");
});


const LINKED = { tiers: { "1v1": "Gold", "2v2": "Gold", "3v3": "Gold" }, region: "EU" };
const MIN = 60_000;

test("deux pings du même mode en rafale : une seule carte", async () => {
  const a = fakeMessage("u_burst", [ROLE_1V1], { id: "burst_a" });
  const b = fakeMessage("u_burst", [ROLE_1V1], { id: "burst_b" });
  const results = await Promise.all([handleLfgMention(a.message), handleLfgMention(b.message)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(a.sent.length + b.sent.length, 1);
  assert.equal(a.replies.length + b.replies.length, 1, "le second message reçoit un refus discret");
});

test("pings de deux modes en rafale : une seule carte (délai anti-spam du ping)", async () => {
  await setLink("u_burst_modes", 101, "Burst", LINKED);
  const a = fakeMessage("u_burst_modes", [ROLE_1V1], { id: "bm_a" });
  const b = fakeMessage("u_burst_modes", [ROLE_2V2], { id: "bm_b" });
  await Promise.all([handleLfgMention(a.message), handleLfgMention(b.message)]);
  assert.equal(a.sent.length + b.sent.length, 1);
  assert.match((a.replies[0] ?? b.replies[0]).content, /pas de nouvelle annonce avant/);
});

test("un message qui pingue les deux rôles : une carte, mode du premier rôle mentionné", async () => {
  await setLink("u_both", 102, "Both", LINKED);
  const { message, sent } = fakeMessage("u_both", [ROLE_2V2, ROLE_1V1]);
  assert.equal(await handleLfgMention(message), true);
  assert.equal(sent.length, 1);
  assert.equal(findOpenPostByAuthor(G, "u_both").mode, "2v2");
  assert.equal(findOpenPostByAuthor(G, "u_both", "1v1"), null);
});

test("ping dans un fil du salon LFG : ignoré", async () => {
  // Un fil a son propre identifiant de salon (message.channelId = id du fil).
  const { message, sent, replies } = fakeMessage("u_thread", [ROLE_1V1], { channelId: "thread_777" });
  assert.equal(await handleLfgMention(message), false);
  assert.equal(sent.length + replies.length, 0);
});

test("mention du rôle ajoutée en modifiant le message : aucune carte", async () => {
  const { message, sent, replies } = fakeMessage("u_edit", [ROLE_1V1], { editedTimestamp: Date.now(), partial: false });
  await onMessageUpdate({ partial: false, content: "qui pour s'entraîner ?" }, message);
  assert.equal(sent.length + replies.length, 0);
  assert.equal(findOpenPostByAuthor(G, "u_edit"), null);
});

test("ping pendant le délai anti-spam : pas de carte, refus discret", async () => {
  markPinged(G, "u_cooldown", Date.now() - 5 * MIN);
  const { message, sent, replies } = fakeMessage("u_cooldown", [ROLE_1V1]);
  assert.equal(await handleLfgMention(message), false);
  assert.equal(sent.length, 0);
  assert.match(replies[0].content, /pas de nouvelle annonce avant \*\*10 min\*\*/);
  assert.equal(findOpenPostByAuthor(G, "u_cooldown"), null);
});

test("ping après le délai anti-spam : carte créée et délai réarmé", async () => {
  markPinged(G, "u_cooldown_done", Date.now() - 16 * MIN);
  const { message, sent } = fakeMessage("u_cooldown_done", [ROLE_1V1]);
  assert.equal(await handleLfgMention(message), true);
  assert.equal(sent.length, 1);
  assert.ok(pingCooldownLeft(G, "u_cooldown_done", 15 * MIN) > 14 * MIN);
});

test("/lfg puis ping juste après : le ping ne crée pas de seconde carte", async () => {
  markPinged(G, "u_cmd_then_ping"); // ce que fait /lfg quand il pingue le rôle
  const { message, sent } = fakeMessage("u_cmd_then_ping", [ROLE_1V1]);
  assert.equal(await handleLfgMention(message), false);
  assert.equal(sent.length, 0);
});

test("spam du ping : le bot ne répond qu'une fois par minute", async () => {
  markPinged(G, "u_spam");
  const replies = [];
  for (let i = 0; i < 4; i++) {
    const m = fakeMessage("u_spam", [ROLE_1V1], { id: `spam_${i}` });
    await handleLfgMention(m.message);
    replies.push(...m.replies);
  }
  assert.equal(replies.length, 1);
});

test("bots, webhooks, messages système et @everyone : ignorés", async () => {
  const cases = [
    fakeMessage("u_bot", [ROLE_1V1], { author: { id: "u_bot", bot: true } }),
    fakeMessage("u_hook", [ROLE_1V1], { webhookId: "wh_1" }),
    fakeMessage("u_sys", [ROLE_1V1], { system: true }),
    fakeMessage("u_everyone", [ROLE_1V1], { content: `@everyone <@&${ROLE_1V1}> tournoi ce soir` }),
  ];
  cases[3].message.mentions.everyone = true;
  for (const c of cases) {
    assert.equal(await handleLfgMention(c.message), false);
    assert.equal(c.sent.length + c.replies.length, 0);
  }
  for (const id of ["u_bot", "u_hook", "u_sys", "u_everyone"]) assert.equal(findOpenPostByAuthor(G, id), null);
});

test("message supprimé avant la création de la carte : rien n'est créé, pas de délai consommé", async () => {
  const { message } = fakeMessage("u_deleted", [ROLE_1V1], { sendFails: "Unknown message" });
  assert.equal(await handleLfgMention(message), false);
  assert.equal(findOpenPostByAuthor(G, "u_deleted"), null);
  assert.equal(pingCooldownLeft(G, "u_deleted", 15 * MIN), 0);
});
