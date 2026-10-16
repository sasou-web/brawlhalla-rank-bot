import test from "node:test";
import assert from "node:assert/strict";
import { handleChatInput, commandsData } from "../src/commands.js";
import { resetCooldowns } from "../src/commands/cooldowns.js";
import { createTournament, updateTournament } from "../src/tournament.js";
import { tournamentAnnounce } from "../src/tournamentUI.js";
import { removePending } from "../src/pendingStore.js";

/**
 * Mentions de masse : les réponses PUBLIQUES qui recopient la saisie d'un membre ne doivent
 * jamais laisser Discord pinger @everyone, un rôle ou d'autres membres (le client n'a pas
 * d'allowedMentions par défaut). L'API Brawlhalla est simulée via `fetch` : aucun réseau.
 */

const realFetch = globalThis.fetch;
function mockApi(status, body) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetCooldowns();
});

const ctx = { rolesByName: new Map() };
let seq = 0;

// Slash command factice : options texte fournies, aucune option membre/id.
function mockCommand(commandName, strings) {
  const calls = { reply: [], editReply: [], deferReply: [] };
  const it = {
    commandName,
    user: { id: `mention-user-${++seq}` },
    guildId: "g_mentions",
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },
    options: {
      getString: (n) => strings[n] ?? null,
      getInteger: () => null,
      getUser: () => null,
    },
    reply: async (p) => { calls.reply.push(p); it.replied = true; },
    deferReply: async (p) => { calls.deferReply.push(p); it.deferred = true; },
    editReply: async (p) => { calls.editReply.push(p); },
    _calls: calls,
  };
  return it;
}

const lastEdit = (it) => it._calls.editReply.at(-1);

test("/carte pseudo:@everyone sans résultat : réponse publique sans aucune mention", async () => {
  mockApi(200, { rankings: [] });
  const it = mockCommand("carte", { pseudo: "@everyone" });
  await handleChatInput(it, ctx);
  const p = lastEdit(it);
  assert.match(p.content, /Aucun joueur classé/);
  assert.deepEqual(p.allowedMentions, { parse: [] });
});

test("/stats pseudo:<@&rôle> sans résultat : carte V2 sans aucune mention", async () => {
  mockApi(200, { rankings: [] });
  const it = mockCommand("stats", { pseudo: "<@&123456789012345678>" });
  await handleChatInput(it, ctx);
  assert.deepEqual(lastEdit(it).allowedMentions, { parse: [] });
});

test("/versus pseudo2:@here sans résultat : aucune mention", async () => {
  mockApi(200, { rankings: [] });
  const it = mockCommand("versus", { pseudo1: "@here", pseudo2: "@here" });
  await handleChatInput(it, ctx);
  assert.deepEqual(lastEdit(it).allowedMentions, { parse: [] });
});

test("/lier pseudo:@everyone sans résultat : seul l'auteur peut être mentionné", async () => {
  mockApi(200, { rankings: [] });
  const it = mockCommand("lier", { pseudo: "@everyone" });
  await handleChatInput(it, ctx);
  const p = lastEdit(it);
  assert.match(p.content, /aucun joueur classé/);
  assert.deepEqual(p.allowedMentions, { users: [it.user.id] });
});

test("API en échec : le message « je cherche » recopie la saisie NETTOYÉE, pas la brute", async () => {
  mockApi(400, { error: "bad request" }); // 400 : échec immédiat, sans retry
  const it = mockCommand("carte", { pseudo: "@everyone" });
  await handleChatInput(it, ctx);
  const p = lastEdit(it);
  assert.match(p.content, /Je cherche \*\*everyone\*\*/);
  assert.ok(!p.content.includes("@everyone"), "la saisie brute ne doit pas être recopiée");
  assert.deepEqual(p.allowedMentions, { parse: [] });
  // La base de test est partagée entre fichiers : on retire la recherche mise en file.
  removePending("search", "@everyone");
});

test("toutes les options pseudo sont bornées à 64 caractères", () => {
  const pseudoOpts = commandsData.flatMap((c) =>
    (c.options || []).filter((o) => /^pseudo/.test(o.name)).map((o) => ({ cmd: c.name, ...o })),
  );
  assert.ok(pseudoOpts.length >= 10, "les options pseudo doivent être trouvées");
  for (const o of pseudoOpts) assert.equal(o.max_length, 64, `/${o.cmd} ${o.name}`);
});

test("annonce de tournoi : un nom d'équipe « <@id> » ne pinge personne", async () => {
  const G = "g_mentions_trn";
  await createTournament(G, { name: "Cup" });
  await updateTournament(G, { announceChannelId: "c_announce" });
  const sent = [];
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => { sent.push(p); } }) },
  };
  await tournamentAnnounce(client, G, "🏆 **<@123456789012345678>** remporte **Cup** !");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});
