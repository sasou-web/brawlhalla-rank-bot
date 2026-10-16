import test from "node:test";
import assert from "node:assert/strict";
import { setTicketConfig, countOpenByOwner } from "../src/tickets.js";
import { handleTicketsModal } from "../src/commands/panels/tickets.js";

/**
 * Pièces jointes envoyées dans le formulaire d'ouverture de ticket : re-postées dans le
 * premier message du salon (galerie Components V2), et un refus d'envoi des fichiers
 * n'empêche jamais l'ouverture du ticket. Téléchargement simulé (fetch remplacé).
 */

const G = "g_tickets_files";

function mockCreate(userId, send, files) {
  const channel = { id: `ch-${userId}`, deleted: false, send, async delete() { this.deleted = true; } };
  const calls = { editReply: [] };
  const it = {
    customId: "tck_create_modal:",
    deferred: false,
    replied: false,
    async reply(p) { calls.reply = p; this.replied = true; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { calls.editReply.push(p); },
    fields: {
      getTextInputValue: () => "Signalement avec capture",
      getUploadedFiles: () => files,
    },
    guild: { id: G, roles: { everyone: { id: G } }, channels: { create: async () => channel } },
    user: { id: userId, tag: `${userId}#0001` },
    client: { user: { id: "bot" } },
    calls,
  };
  return { it, channel };
}

const shot = new Map([["1", { name: "preuve.png", size: 4, contentType: "image/png", url: "https://cdn.discordapp.com/attachments/1/2/preuve.png" }]]);
const realFetch = globalThis.fetch;

test.before(async () => {
  await setTicketConfig(G, { enabled: true, categoryId: "cat", staffRoleId: "staff" });
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });
});
test.after(() => {
  globalThis.fetch = realFetch;
});

test("ticket : la capture est re-postée dans le premier message, avec une galerie", async () => {
  const sent = [];
  const { it } = mockCreate("tf-ok", async (p) => { sent.push(p); return { id: "m1" }; }, shot);
  await handleTicketsModal(it, {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].files.length, 1);
  assert.equal(sent[0].files[0].name, "1_preuve.png");
  const gallery = sent[0].components.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : c)).find((c) => c.type === 12);
  assert.ok(gallery, "galerie présente (sinon la pièce jointe est invisible en Components V2)");
  assert.equal(gallery.items[0].media.url, "attachment://1_preuve.png");
  assert.match(it.calls.editReply.at(-1), /a été créé/);
  assert.doesNotMatch(it.calls.editReply.at(-1), /Pièces jointes/);
});

test("ticket : envoi avec fichiers refusé => ticket ouvert sans eux, membre prévenu", async () => {
  const sent = [];
  const { it, channel } = mockCreate("tf-big", async (p) => {
    sent.push(p);
    if (p.files) throw new Error("Request entity too large");
    return { id: "m2" };
  }, shot);
  await handleTicketsModal(it, {});
  assert.equal(sent.length, 2);
  assert.equal(sent[1].files, undefined);
  assert.equal(channel.deleted, false);
  assert.equal(await countOpenByOwner(G, "tf-big"), 1);
  assert.match(it.calls.editReply.at(-1), /a été créé/);
  assert.match(it.calls.editReply.at(-1), /n'ont pas pu être ajoutées/);
});

test("ticket : fichier refusé à la validation => ticket ouvert, raison affichée", async () => {
  const pdf = new Map([["1", { name: "doc.pdf", size: 4, contentType: "application/pdf", url: "https://cdn.discordapp.com/doc.pdf" }]]);
  const sent = [];
  const { it } = mockCreate("tf-pdf", async (p) => { sent.push(p); return { id: "m3" }; }, pdf);
  await handleTicketsModal(it, {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].files, undefined);
  assert.match(it.calls.editReply.at(-1), /doc\.pdf/);
});
