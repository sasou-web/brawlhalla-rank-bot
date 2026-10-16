import test from "node:test";
import assert from "node:assert/strict";
import { setLink, removeLink } from "../src/store.js";
import { handleChatInput } from "../src/commands.js";

/**
 * /refresh : la synchro complète est séquentielle (un appel API par membre lié) et peut
 * dépasser la fenêtre de 15 min d'une interaction. La commande doit répondre tout de suite
 * et terminer en arrière-plan, comme le bouton « Actualiser les rôles » de /setup.
 */

test("/refresh répond immédiatement, la synchro se termine en arrière-plan", async () => {
  await setLink("refresh-user", 4242, "Neo");
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const it = {
    commandName: "refresh",
    deferred: false,
    replied: false,
    memberPermissions: { has: () => true },
    user: { id: "admin" },
    // Le fetch des membres reste bloqué tant que le test ne le libère pas.
    guild: { id: "g_refresh", members: { fetch: () => blocked.then(() => null) }, channels: { fetch: async () => null } },
    deferReply: async () => { calls.push("deferReply"); it.deferred = true; },
    editReply: async (p) => { calls.push(p); },
    reply: async (p) => { calls.push(p); },
  };

  await handleChatInput(it, { rolesByName: new Map() }); // ne doit PAS attendre la synchro
  assert.equal(calls[0], "deferReply");
  assert.match(calls[1], /Actualisation lancée/);
  assert.equal(calls.length, 2, "pas de bilan tant que la synchro tourne");

  release();
  for (let i = 0; i < 200 && calls.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(String(calls[2]), /Actualisation des rôles terminée/);
  await removeLink("refresh-user");
});
