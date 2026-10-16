import test from "node:test";
import assert from "node:assert/strict";
import { setTicketConfig, countOpenByOwner, addOpenTicket, getOpenTicket } from "../src/tickets.js";
import { handleTicketsButton, handleTicketsModal } from "../src/commands/panels/tickets.js";

/**
 * Tickets : un envoi refusé par Discord ne doit jamais être présenté comme un succès, ni
 * laisser un ticket « fantôme » qui bloquerait son auteur. Base SQLite temporaire.
 */

const G = "g_tickets_ui";

function recorder() {
  const calls = { reply: [], editReply: [], deferReply: 0 };
  return {
    calls,
    deferred: false,
    replied: false,
    async reply(p) { calls.reply.push(p); this.replied = true; },
    async deferReply() { calls.deferReply++; this.deferred = true; },
    async editReply(p) { calls.editReply.push(p); },
  };
}

// Soumission du modal « Ouvrir un ticket » ; `send` simule l'envoi du message de contrôle.
function mockCreate(userId, send) {
  const channel = { id: `ch-${userId}`, deleted: false, send, async delete() { this.deleted = true; } };
  const it = {
    ...recorder(),
    customId: "tck_create_modal:",
    fields: { getTextInputValue: () => "J'ai un souci" },
    guild: { id: G, roles: { everyone: { id: G } }, channels: { create: async () => channel } },
    user: { id: userId, tag: `${userId}#0001` },
    client: { user: { id: "bot" } },
  };
  return { it, channel };
}

test.before(async () => {
  await setTicketConfig(G, { enabled: true, categoryId: "cat", staffRoleId: "staff" });
});

test("création : message de contrôle refusé => salon supprimé, ticket purgé, erreur affichée", async () => {
  const { it, channel } = mockCreate("t-user-fail", async () => {
    throw new Error("Invalid Form Body");
  });
  await handleTicketsModal(it, {});
  assert.equal(channel.deleted, true, "le salon sans boutons est supprimé");
  assert.equal(await countOpenByOwner(G, "t-user-fail"), 0, "le membre peut rouvrir un ticket");
  const msg = it.calls.editReply.at(-1);
  assert.match(msg, /❌/);
  assert.doesNotMatch(msg, /a été créé/);
});

test("création : message de contrôle envoyé => ticket ouvert et succès annoncé", async () => {
  const { it, channel } = mockCreate("t-user-ok", async () => ({ id: "m1" }));
  await handleTicketsModal(it, {});
  assert.equal(channel.deleted, false);
  assert.equal(await countOpenByOwner(G, "t-user-ok"), 1);
  assert.match(it.calls.editReply.at(-1), /a été créé/);
});

test("ticket dont le salon a disparu : ignoré et purgé", async () => {
  await addOpenTicket(G, "ch-gone", { ownerId: "t-user-gone", number: 98, topic: "Général", subject: "x" });
  assert.equal(await countOpenByOwner(G, "t-user-gone"), 1, "sans liste de salons : compté");
  assert.equal(await countOpenByOwner(G, "t-user-gone", { channels: new Map([["autre", {}]]) }), 0);
  assert.equal(await getOpenTicket(G, "ch-gone"), null, "entrée purgée");
});

test("ouverture : un ticket orphelin ne bloque plus son auteur", async () => {
  await addOpenTicket(G, "ch-gone2", { ownerId: "t-user-gone2", number: 99, topic: "Général", subject: "x" });
  const it = {
    ...recorder(),
    customId: "tckopen_btn",
    guild: { id: G, channels: { cache: new Map() } },
    user: { id: "t-user-gone2" },
    modal: null,
    async showModal(m) { this.modal = m; },
  };
  await handleTicketsButton(it, {});
  assert.equal(it.calls.reply.length, 0, "pas de « Tu as déjà un ticket ouvert »");
  assert.ok(it.modal, "formulaire d'ouverture affiché");
});

test("publication du panneau refusée : pas de faux « publié ✅ »", async () => {
  const it = {
    ...recorder(),
    customId: "tckcfg_publish",
    guild: { id: G },
    channel: { send: async () => { throw new Error("Missing Access"); } },
  };
  await handleTicketsButton(it, {});
  const content = it.calls.reply.at(-1).content;
  assert.match(content, /❌/);
  assert.doesNotMatch(content, /publié dans ce salon/);
});
