import test from "node:test";
import assert from "node:assert/strict";
import {
  createTournament,
  updateTournament,
  getTournament,
  registerEntrant,
  generateBracket,
  disputeMatch,
  listDisputes,
} from "../src/tournament.js";
import { handleTournamentButton, handleTournamentModal } from "../src/commands/tournament.js";
import { buildModAlert } from "../src/tournamentUI.js";

/**
 * Litige de tournoi par modal (raison + capture) : la raison est gardée dans le match,
 * l'alerte staff porte la capture, et le bouton « Litige » ouvre le modal directement.
 * Vrai store sur la base SQLite temporaire de scripts/run-tests.js.
 */

async function duel(guildId, patch = {}) {
  await createTournament(guildId, { name: "Duel", maxParticipants: 8, checkInEnabled: false, bestOf: 3, finalsBestOf: 5, ...patch });
  await updateTournament(guildId, { status: "registration" });
  await registerEntrant(guildId, { members: ["u1"], name: "P1" });
  await registerEntrant(guildId, { members: ["u2"], name: "P2" });
  return generateBracket(guildId);
}

function mockInteraction(guildId, customId, { userId = "u1", alertChannel = null, reason = "Il a déclaré un faux score", files = null } = {}) {
  const calls = [];
  const it = {
    customId,
    guild: { id: guildId, channels: { fetch: async () => alertChannel } },
    user: { id: userId, username: userId },
    member: { displayName: userId, roles: { cache: new Map() } },
    memberPermissions: { has: () => false },
    client: { channels: { fetch: async () => null } },
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: (id) => (id === "reason" ? reason : ""),
      getUploadedFiles: () => files,
    },
    reply: async (p) => { calls.push(["reply", p]); it.replied = true; },
    update: async (p) => { calls.push(["update", p]); it.replied = true; },
    showModal: async (p) => { calls.push(["showModal", p]); it.replied = true; },
    deferReply: async (p) => { calls.push(["deferReply", p]); it.deferred = true; },
    editReply: async (p) => { calls.push(["editReply", p]); },
    _calls: calls,
  };
  return it;
}

test("disputeMatch stocke la raison et passe le match en litige", async () => {
  const G = "g_disp_store";
  await duel(G);
  await disputeMatch(G, "r0m0", { reason: "  Score faux  ", by: "u1", byName: "P1", files: 2 });
  const m = (await getTournament(G)).matches.r0m0;
  assert.equal(m.status, "dispute");
  assert.equal(m.dispute.reason, "Score faux");
  assert.equal(m.dispute.by, "u1");
  assert.equal(m.dispute.byName, "P1");
  assert.equal(m.dispute.files, 2);
  assert.ok(m.dispute.at > 0);
  assert.equal(listDisputes(await getTournament(G)).length, 1);
});

test("disputeMatch sans options reste compatible (ancien appel)", async () => {
  const G = "g_disp_compat";
  await duel(G);
  await disputeMatch(G, "r0m0");
  const m = (await getTournament(G)).matches.r0m0;
  assert.equal(m.status, "dispute");
  assert.equal(m.dispute.reason, "");
});

test("bouton Litige : ouvre directement le modal (raison + upload)", async () => {
  const G = "g_disp_btn";
  await duel(G);
  const it = mockInteraction(G, "trn_dispute:r0m0");
  await handleTournamentButton(it, {});
  const [kind, modal] = it._calls[0];
  assert.equal(kind, "showModal");
  assert.equal(modal.custom_id, "trn_dispute_modal:r0m0");
  assert.ok(modal.components.some((c) => c.component.type === 19));
  assert.equal((await getTournament(G)).matches.r0m0.status !== "dispute", true, "rien n'est écrit avant l'envoi du modal");
});

test("bouton Litige : refusé à un non-joueur", async () => {
  const G = "g_disp_btn_other";
  await duel(G);
  const it = mockInteraction(G, "trn_dispute:r0m0", { userId: "intrus" });
  await handleTournamentButton(it, {});
  assert.equal(it._calls[0][0], "reply");
  assert.match(it._calls[0][1].content, /Réservé/);
});

test("ancienne confirmation trn_disputeok : expirée, aucune écriture", async () => {
  const G = "g_disp_old";
  await duel(G);
  const it = mockInteraction(G, "trn_disputeok:r0m0");
  await handleTournamentButton(it, {});
  assert.equal(it._calls[0][0], "update");
  assert.match(it._calls[0][1].content, /expiré/);
  assert.notEqual((await getTournament(G)).matches.r0m0.status, "dispute");
});

test("modal de litige : raison enregistrée, alerte staff envoyée, accusé avant tout", async () => {
  const G = "g_disp_modal";
  await duel(G, { modAlertChannelId: "alert" });
  const sent = [];
  const alertChannel = { isTextBased: () => true, send: async (p) => { sent.push(p); return { id: "a1" }; } };
  const it = mockInteraction(G, "trn_dispute_modal:r0m0", { alertChannel, reason: "Il a quitté en pleine manche" });
  await handleTournamentModal(it, {});
  assert.equal(it._calls[0][0], "deferReply", "accusé avant les appels Discord");
  const m = (await getTournament(G)).matches.r0m0;
  assert.equal(m.status, "dispute");
  assert.equal(m.dispute.reason, "Il a quitté en pleine manche");
  assert.equal(m.dispute.byName, "P1");
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].description, /Il a quitté en pleine manche/);
  assert.match(sent[0].embeds[0].description, /<@u1>/);
  assert.match(it._calls.at(-1)[1].content, /staff a été prévenu/);
});

test("modal de litige : fichier refusé => litige quand même enregistré, joueur prévenu", async () => {
  const G = "g_disp_badfile";
  await duel(G, { modAlertChannelId: "alert" });
  const alertChannel = { isTextBased: () => true, send: async () => ({ id: "a1" }) };
  const files = new Map([["1", { name: "x.pdf", size: 10, contentType: "application/pdf", url: "https://cdn.discordapp.com/x.pdf" }]]);
  const it = mockInteraction(G, "trn_dispute_modal:r0m0", { alertChannel, files });
  await handleTournamentModal(it, {});
  assert.equal((await getTournament(G)).matches.r0m0.status, "dispute");
  assert.match(it._calls.at(-1)[1].content, /Capture non jointe/);
});

test("buildModAlert : capture en image d'embed et auteur du litige", () => {
  const t = {
    modRoleId: "mods",
    participants: [{ id: "e1", name: "P1" }, { id: "e2", name: "P2" }],
    matches: { r0m0: { aId: "e1", bId: "e2" } },
  };
  const p = buildModAlert(t, "r0m0", "Score faux", { by: "u1", imageName: "1_score.png", files: 1 });
  assert.equal(p.embeds[0].image.url, "attachment://1_score.png");
  assert.match(p.embeds[0].description, /Signalé par\*\* : <@u1>/);
  assert.deepEqual(p.allowedMentions, { roles: ["mods"] });
  // Appel historique (inactivité) inchangé.
  assert.equal(buildModAlert(t, "r0m0", "Inactif").embeds[0].image, undefined);
});
