import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { requirePermission, requireManageGuild } from "../src/commands/shared.js";
import { handleChatInput, MANAGE_GUILD_COMMANDS, MANAGE_MESSAGES_COMMANDS } from "../src/commands.js";

// Fabrique une interaction factice. `hasPerm` contrôle memberPermissions.has().
// Les méthodes de réponse enregistrent leurs appels ; deferReply jette volontairement
// pour détecter si un handler (qui defer toujours) a été atteint malgré un refus.
function mockInteraction({ commandName = "x", hasPerm = false } = {}) {
  const calls = { reply: [], editReply: [], deferReply: 0 };
  return {
    commandName,
    deferred: false,
    replied: false,
    memberPermissions: { has: () => hasPerm },
    reply: async (p) => { calls.reply.push(p); },
    editReply: async (p) => { calls.editReply.push(p); },
    deferReply: async () => { calls.deferReply++; throw new Error("handler atteint (ne devrait pas)"); },
    _calls: calls,
  };
}

const ctx = { rolesByName: new Map() };

test("requirePermission : autorise sans répondre quand la permission est présente", async () => {
  const it = mockInteraction({ hasPerm: true });
  const ok = await requirePermission(it, PermissionFlagsBits.ManageGuild);
  assert.equal(ok, true);
  assert.equal(it._calls.reply.length, 0);
});

test("requirePermission : refuse et répond (éphémère) quand la permission manque", async () => {
  const it = mockInteraction({ hasPerm: false });
  const ok = await requirePermission(it, PermissionFlagsBits.ManageGuild);
  assert.equal(ok, false);
  assert.equal(it._calls.reply.length, 1);
  assert.match(it._calls.reply[0].content, /Réservé/);
});

test("requireManageGuild : délègue à requirePermission (refus pour non-admin)", async () => {
  const it = mockInteraction({ hasPerm: false });
  assert.equal(await requireManageGuild(it), false);
  assert.equal(it._calls.reply.length, 1);
});

test("les ensembles de permissions couvrent les bonnes commandes", () => {
  // Admin (Gérer le serveur)
  for (const c of ["setup", "refresh", "reset-saison", "forcelink", "caster", "tournoi-panneau"]) {
    assert.ok(MANAGE_GUILD_COMMANDS.has(c), `${c} devrait exiger ManageGuild`);
  }
  // Publiques : jamais gatées
  for (const c of ["bracket", "lier", "stats", "leaderboard", "combos"]) {
    assert.ok(!MANAGE_GUILD_COMMANDS.has(c), `${c} ne doit pas être gatée`);
  }
  assert.ok(MANAGE_MESSAGES_COMMANDS.has("clear"));
});

test("dispatch : une commande admin est bloquée pour un non-admin (handler jamais atteint)", async () => {
  const it = mockInteraction({ commandName: "refresh", hasPerm: false });
  // Ne doit PAS jeter : le gate retourne avant d'appeler le handler (qui ferait deferReply -> throw).
  await assert.doesNotReject(handleChatInput(it, ctx));
  assert.equal(it._calls.deferReply, 0, "le handler ne doit pas être exécuté");
  assert.equal(it._calls.reply.length, 1);
  assert.match(it._calls.reply[0].content, /Réservé/);
});

test("dispatch : /clear bloqué pour qui n'a pas Gérer les messages", async () => {
  const it = mockInteraction({ commandName: "clear", hasPerm: false });
  await assert.doesNotReject(handleChatInput(it, ctx));
  assert.equal(it._calls.deferReply, 0);
  assert.equal(it._calls.reply.length, 1);
  assert.match(it._calls.reply[0].content, /Gérer les messages/);
});
