import test from "node:test";
import assert from "node:assert/strict";
import { commandsData, handleModal, handleButton } from "../src/commands.js";
import {
  handleContextMenu, buildReportEmbed, buildReportButtons, CONTEXT_MENU_NAMES,
} from "../src/commands/contextMenus.js";
import { setSetting } from "../src/settings.js";
import { resetCooldowns } from "../src/commands/cooldowns.js";

const GUILD = "g_ctx";
const LINK = (c, m) => `https://discord.com/channels/${GUILD}/${c}/${m}`;

function fakeMessage(over = {}) {
  return {
    id: "m1",
    channelId: "c1",
    guildId: GUILD,
    author: { id: "author1", bot: false },
    content: "salut",
    attachments: new Map(),
    embeds: [],
    ...over,
  };
}

// Interaction factice : enregistre les réponses.
function fakeInteraction(over = {}) {
  const calls = { reply: [], editReply: [], showModal: [], update: [], followUp: [], deferReply: 0, deferUpdate: 0 };
  const it = {
    guildId: GUILD,
    user: { id: "reporter1", bot: false },
    client: { user: { id: "bot1" } },
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },
    reply: async (p) => { calls.reply.push(p); it.replied = true; },
    editReply: async (p) => { calls.editReply.push(p); },
    deferReply: async () => { calls.deferReply++; it.deferred = true; },
    deferUpdate: async () => { calls.deferUpdate++; it.deferred = true; },
    showModal: async (m) => { calls.showModal.push(m.toJSON()); },
    update: async (p) => { calls.update.push(p); },
    followUp: async (p) => { calls.followUp.push(p); },
    _calls: calls,
    ...over,
  };
  return it;
}

test("menus contextuels : noms uniques, ≤ 32 caractères, type 2/3, ≤ 15 par type, serveur uniquement", () => {
  const menus = commandsData.filter((c) => c.type === 2 || c.type === 3);
  assert.equal(menus.length, 3);
  const names = menus.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, "noms en double");
  for (const c of menus) {
    assert.ok(c.name.length <= 32, `${c.name} trop long`);
    assert.ok(!c.description, "un menu contextuel n'a pas de description");
    assert.deepEqual(c.contexts, [0]);
  }
  for (const type of [2, 3]) {
    assert.ok(commandsData.filter((c) => c.type === type).length <= 15, `plus de 15 menus de type ${type}`);
  }
  assert.deepEqual(Object.values(CONTEXT_MENU_NAMES).sort(), [...names].sort());
});

test("buildReportEmbed : lien du message, extrait tronqué à 200 caractères, raison", () => {
  const msg = fakeMessage({ content: "x".repeat(500) });
  const e = buildReportEmbed(msg, "  spam  ", { id: "reporter1" }).toJSON();
  assert.ok(e.description.includes(LINK("c1", "m1")));
  const field = (n) => e.fields.find((f) => f.name === n).value;
  assert.equal(field("Auteur"), "<@author1>");
  assert.equal(field("Salon"), "<#c1>");
  assert.equal(field("Signalé par"), "<@reporter1>");
  assert.equal(field("Raison"), "spam");
  const excerpt = field("Extrait").replace(/^```\n|\n```$/g, "");
  assert.equal([...excerpt].length, 200);
  assert.ok(excerpt.endsWith("…"));
});

test("buildReportEmbed : un bloc de code dans le message ne casse pas l'extrait", () => {
  const msg = fakeMessage({ content: "```[clique](https://scam.example)```" });
  const value = buildReportEmbed(msg, "arnaque", { id: "r" }).toJSON().fields.find((f) => f.name === "Extrait").value;
  assert.ok(value.startsWith("```\n") && value.endsWith("\n```"));
  assert.equal(value.slice(4, -4).includes("```"), false);
});

test("buildReportEmbed : message sans texte → description des pièces jointes", () => {
  const msg = fakeMessage({ content: "", attachments: new Map([["a", {}], ["b", {}]]) });
  const value = buildReportEmbed(msg, "r", { id: "r" }).toJSON().fields.find((f) => f.name === "Extrait").value;
  assert.match(value, /2 pièce\(s\) jointe\(s\)/);
});

test("buildReportEmbed : message supprimé → pas de lien, contexte gardé depuis la référence", () => {
  const e = buildReportEmbed(null, "r", { id: "r" }, { guildId: GUILD, channelId: "c9", messageId: "m9", authorId: "a9" }).toJSON();
  assert.ok(!e.description.includes("https://"));
  assert.equal(e.fields.find((f) => f.name === "Auteur").value, "<@a9>");
  assert.equal(e.fields.find((f) => f.name === "Salon").value, "<#c9>");
});

test("buildReportButtons : customIds rep_ok/rep_del et bouton Supprimer désactivé si supprimé", () => {
  const row = buildReportButtons("c1", "m1", { deleted: true }).toJSON();
  assert.equal(row.components[0].custom_id, "rep_ok:m1");
  assert.equal(row.components[1].custom_id, "rep_del:c1:m1");
  assert.equal(row.components[1].disabled, true);
  assert.equal(row.components[0].disabled, false);
});

test("Profil / Niveau : un bot ciblé est refusé poliment, sans defer", async () => {
  for (const name of [CONTEXT_MENU_NAMES.profile, CONTEXT_MENU_NAMES.level]) {
    const it = fakeInteraction({ commandName: name, targetUser: { id: "b", bot: true }, targetMember: null });
    await handleContextMenu(it);
    assert.equal(it._calls.deferReply, 0);
    assert.equal(it._calls.reply.length, 1);
    assert.match(it._calls.reply[0].content, /bots/i);
  }
});

test("Signaler : refuse sans salon configuré, ouvre le modal sinon", async () => {
  resetCooldowns();
  await setSetting("alertChannelId", "");
  await setSetting("auditChannelId", "");
  const base = { commandName: CONTEXT_MENU_NAMES.report, targetMessage: fakeMessage() };
  const off = fakeInteraction(base);
  await handleContextMenu(off);
  assert.equal(off._calls.showModal.length, 0);
  assert.match(off._calls.reply[0].content, /pas configurés/);

  await setSetting("alertChannelId", "staff1");
  const on = fakeInteraction(base);
  await handleContextMenu(on);
  assert.equal(on._calls.reply.length, 0, "showModal doit être la première réponse");
  assert.equal(on._calls.showModal.length, 1);
  const modal = on._calls.showModal[0];
  assert.equal(modal.custom_id, "rep_modal:c1:m1:author1");
  assert.equal(modal.components[0].components[0].required, true);
  assert.equal(modal.components[0].components[0].max_length, 300);
  await setSetting("alertChannelId", "");
});

test("Signaler : refuse son propre message et ceux du bot", async () => {
  const own = fakeInteraction({ commandName: CONTEXT_MENU_NAMES.report, targetMessage: fakeMessage({ author: { id: "reporter1" } }) });
  await handleContextMenu(own);
  assert.match(own._calls.reply[0].content, /propre message/);
  const bot = fakeInteraction({ commandName: CONTEXT_MENU_NAMES.report, targetMessage: fakeMessage({ author: { id: "bot1", bot: true } }) });
  await handleContextMenu(bot);
  assert.match(bot._calls.reply[0].content, /bot/);
});

test("envoi du modal : poste l'embed au staff, puis cooldown de 60 s", async () => {
  resetCooldowns();
  await setSetting("alertChannelId", "staff1");
  const sent = [];
  const staff = { isTextBased: () => true, send: async (p) => { sent.push(p); } };
  const source = { messages: { fetch: async () => { throw new Error("Unknown Message"); } } };
  const guild = { channels: { fetch: async (id) => (id === "staff1" ? staff : source) } };
  const submit = () => fakeInteraction({
    customId: "rep_modal:c1:m1:author1",
    guild,
    fields: { getTextInputValue: () => "insulte" },
  });

  const it = submit();
  await handleModal(it, {});
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const embed = sent[0].embeds[0].toJSON();
  assert.ok(!embed.description.includes("https://"), "message supprimé : pas de lien");
  assert.equal(embed.fields.find((f) => f.name === "Auteur").value, "<@author1>");
  const del = sent[0].components[0].toJSON().components[1];
  assert.equal(del.custom_id, "rep_del:c1:m1");
  assert.equal(del.disabled, true);
  assert.match(it._calls.editReply.at(-1), /envoyé/);

  const again = submit();
  await handleModal(again, {});
  assert.equal(sent.length, 1, "second signalement bloqué par le cooldown");
  assert.match(again._calls.reply[0].content, /Réessaie/);
  await setSetting("alertChannelId", "");
});

test("boutons rep_ : refusés sans « Gérer les messages » (recheck côté handler)", async () => {
  for (const customId of ["rep_ok:m1", "rep_del:c1:m1"]) {
    const it = fakeInteraction({ customId, message: { id: `staffmsg-${customId}`, embeds: [], components: [] } });
    await handleButton(it, {});
    assert.equal(it._calls.update.length, 0);
    assert.equal(it._calls.deferUpdate, 0);
    assert.match(it._calls.reply[0].content, /Gérer les messages/);
  }
});

test("rep_del : supprime le message et désactive les deux boutons", async () => {
  let deleted = false;
  const target = { author: { id: "author1" }, delete: async () => { deleted = true; } };
  const channel = { messages: { fetch: async () => target } };
  const it = fakeInteraction({
    customId: "rep_del:c1:m1",
    memberPermissions: { has: () => true },
    guild: { channels: { fetch: async () => channel } },
    message: { id: "staffmsg-del", embeds: [buildReportEmbed(fakeMessage(), "r", { id: "r" }).toJSON()], components: [] },
  });
  await handleButton(it, {});
  assert.equal(deleted, true);
  const p = it._calls.editReply.at(-1);
  const row = p.components[0].toJSON();
  assert.ok(row.components.every((c) => c.disabled));
  assert.match(p.embeds[0].toJSON().fields.find((f) => f.name === "Suivi").value, /supprimé par <@reporter1>/);
});
