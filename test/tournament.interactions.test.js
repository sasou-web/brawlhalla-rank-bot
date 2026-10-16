import test from "node:test";
import assert from "node:assert/strict";
import {
  createTournament,
  updateTournament,
  getTournament,
  registerEntrant,
  generateBracket,
  reportGame,
} from "../src/tournament.js";
import { handleTournamentButton } from "../src/commands/tournament.js";

/**
 * Report manche par manche : la confirmation « Oui, attribuer le point » ne doit compter
 * qu'UNE fois, même rejouée (clic en double, interaction expirée puis recliquée).
 * Base SQLite temporaire fournie par scripts/run-tests.js.
 */

async function duel(guildId) {
  await createTournament(guildId, { name: "Duel", maxParticipants: 8, checkInEnabled: false, bestOf: 3, finalsBestOf: 5 });
  await updateTournament(guildId, { status: "registration" });
  await registerEntrant(guildId, { members: ["u1"], name: "P1" });
  await registerEntrant(guildId, { members: ["u2"], name: "P2" });
  return generateBracket(guildId); // 2 joueurs : un seul match r0m0 (finale, BO5)
}

// Bouton factice : enregistre l'ordre des appels. Aucun salon configuré, donc aucun appel
// REST réel (scoreboard, panneau et annonce sortent tôt).
function mockButton(guildId, customId, userId = "u1") {
  const calls = [];
  const it = {
    customId,
    guild: { id: guildId, channels: { fetch: async () => null } },
    user: { id: userId, username: userId },
    member: { displayName: userId, roles: { cache: new Map() } },
    memberPermissions: { has: () => false },
    client: { channels: { fetch: async () => null } },
    deferred: false,
    replied: false,
    reply: async (p) => { calls.push(["reply", p]); it.replied = true; },
    update: async (p) => { calls.push(["update", p]); it.replied = true; },
    deferReply: async (p) => { calls.push(["deferReply", p]); it.deferred = true; },
    editReply: async (p) => { calls.push(["editReply", p]); },
    _calls: calls,
  };
  return it;
}

const score = async (G) => {
  const m = (await getTournament(G)).matches.r0m0;
  return `${m.scoreA}-${m.scoreB}`;
};

test("reportGame : refuse une confirmation dont le compteur de manches est dépassé", async () => {
  const G = "g_trn_idem";
  await duel(G);
  await reportGame(G, "r0m0", "a", 0);
  await assert.rejects(reportGame(G, "r0m0", "a", 0), /score a changé/);
  assert.equal(await score(G), "1-0", "le point rejoué n'est pas compté");
  await reportGame(G, "r0m0", "b", 1);
  assert.equal(await score(G), "1-1");
  await reportGame(G, "r0m0", "a"); // sans compteur : comportement historique conservé
  assert.equal(await score(G), "2-1");
});

test("trn_game : la confirmation encode le nombre de manches déjà jouées", async () => {
  const G = "g_trn_btn_id";
  await duel(G);
  await reportGame(G, "r0m0", "a", 0);
  const it = mockButton(G, "trn_game:r0m0:b");
  await handleTournamentButton(it, {});
  const [kind, payload] = it._calls[0];
  assert.equal(kind, "reply");
  assert.equal(payload.components[0].components[0].custom_id, "trn_gameok:r0m0:b:1");
});

test("trn_gameok : accusé (bouton retiré) AVANT l'écriture, et un second clic ne compte pas", async () => {
  const G = "g_trn_btn_ok";
  await duel(G);

  const first = mockButton(G, "trn_gameok:r0m0:a:0");
  await handleTournamentButton(first, {});
  assert.equal(first._calls[0][0], "update", "premier appel = accusé");
  assert.deepEqual(first._calls[0][1].components, [], "le bouton de confirmation est retiré d'emblée");
  assert.match(first._calls.at(-1)[1].content, /Point attribué \(1-0\)/);
  assert.equal(await score(G), "1-0");

  // Même confirmation rejouée : refusée, score inchangé.
  const replay = mockButton(G, "trn_gameok:r0m0:a:0");
  await handleTournamentButton(replay, {});
  assert.match(replay._calls.at(-1)[1].content, /❌ .*score a changé/);
  assert.equal(await score(G), "1-0");
});

test("trn_gameok : l'ancien format de customId (sans compteur) n'attribue plus de point", async () => {
  const G = "g_trn_btn_old";
  await duel(G);
  const it = mockButton(G, "trn_gameok:r0m0:a");
  await handleTournamentButton(it, {});
  assert.match(it._calls[0][1].content, /expiré/);
  assert.equal(await score(G), "0-0");
});

test("trn_leave : réponse différée avant les appels Discord, erreur affichée dans l'accusé", async () => {
  const G = "g_trn_leave";
  await createTournament(G, { name: "Cup", maxParticipants: 8, checkInEnabled: false });
  await updateTournament(G, { status: "registration" });
  const it = mockButton(G, "trn_leave", "nobody");
  await handleTournamentButton(it, {});
  assert.equal(it._calls[0][0], "deferReply");
  assert.match(it._calls.at(-1)[1].content, /pas inscrit/);
});
