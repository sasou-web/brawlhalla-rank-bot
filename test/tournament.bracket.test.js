import test from "node:test";
import assert from "node:assert/strict";
import {
  createTournament,
  updateTournament,
  getTournament,
  registerEntrant,
  generateBracket,
  reportResult,
  tournamentWinner,
  tournamentPodium,
  matchBestOf,
  scoreOptions,
  userEntrant,
  listDisputes,
} from "../src/tournament.js";

/**
 * Generation et progression du bracket.
 *
 * C'est la logique la plus risquee du bot : un bug ici casse un tournoi EN DIRECT,
 * devant le serveur, sans possibilite de revenir en arriere proprement. Ces tests
 * passent par le vrai store (base SQLite temporaire fournie par scripts/run-tests.js),
 * donc ils couvrent aussi la persistance.
 */

// Cree un tournoi et y inscrit `n` joueurs nommes P1..Pn (seeds dans l'ordre d'inscription).
async function withPlayers(guildId, n, patch = {}) {
  await createTournament(guildId, {
    name: "Test Cup",
    maxParticipants: 64,
    checkInEnabled: false, // registerEntrant marque alors checkedIn d'office
    bestOf: 3,
    finalsBestOf: 5,
    ...patch,
  });
  await updateTournament(guildId, { status: "registration" });
  for (let i = 1; i <= n; i++) {
    await registerEntrant(guildId, { members: [`u${i}`], name: `P${i}` });
  }
  return getTournament(guildId);
}

const nameOf = (t, id) => t.participants.find((p) => p.id === id)?.name ?? null;
const idOf = (t, name) => t.participants.find((p) => p.name === name)?.id ?? null;

test("bracket de 8 : seeding standard (1v8, 4v5, 2v7, 3v6) et 3 rounds", async () => {
  const G = "g_brk8";
  await withPlayers(G, 8);
  const t = await generateBracket(G);

  assert.equal(t.rounds, 3, "8 joueurs => 3 rounds");
  assert.equal(t.status, "running");
  assert.equal(Object.keys(t.matches).length, 4 + 2 + 1);

  // Appariements du premier tour : le seeding classique oppose les extremes.
  const pair = (mid) => [nameOf(t, t.matches[mid].aId), nameOf(t, t.matches[mid].bId)];
  assert.deepEqual(pair("r0m0"), ["P1", "P8"]);
  assert.deepEqual(pair("r0m1"), ["P4", "P5"]);
  assert.deepEqual(pair("r0m2"), ["P2", "P7"]);
  assert.deepEqual(pair("r0m3"), ["P3", "P6"]);
});

test("bracket de 8 : les deux tetes de serie ne peuvent se croiser qu'en finale", async () => {
  const G = "g_brk8_halves";
  await withPlayers(G, 8);
  const t = await generateBracket(G);

  // r0m0/r0m1 alimentent r1m0 ; r0m2/r0m3 alimentent r1m1. P1 et P2 doivent donc
  // etre dans des moities differentes.
  const firstHalf = ["r0m0", "r0m1"].flatMap((m) => [nameOf(t, t.matches[m].aId), nameOf(t, t.matches[m].bId)]);
  const secondHalf = ["r0m2", "r0m3"].flatMap((m) => [nameOf(t, t.matches[m].aId), nameOf(t, t.matches[m].bId)]);
  assert.ok(firstHalf.includes("P1"), "P1 dans la premiere moitie");
  assert.ok(secondHalf.includes("P2"), "P2 dans la seconde moitie");
});

test("nombre de rounds = puissance de 2 superieure ou egale", async () => {
  for (const [n, rounds] of [[2, 1], [3, 2], [4, 2], [5, 3], [8, 3], [9, 4], [16, 4]]) {
    const G = `g_rounds_${n}`;
    await withPlayers(G, n);
    const t = await generateBracket(G);
    assert.equal(t.rounds, rounds, `${n} joueurs => ${rounds} rounds`);
  }
});

test("byes : avec 6 joueurs, les 2 meilleurs seeds passent automatiquement le 1er tour", async () => {
  const G = "g_byes6";
  await withPlayers(G, 6);
  const t = await generateBracket(G);

  assert.equal(t.rounds, 3, "6 joueurs => bracket de 8 => 3 rounds");

  // Les emplacements vides tombent face aux seeds 1 et 2.
  assert.equal(nameOf(t, t.matches.r0m0.aId), "P1");
  assert.equal(t.matches.r0m0.bId, null);
  assert.equal(nameOf(t, t.matches.r0m2.aId), "P2");
  assert.equal(t.matches.r0m2.bId, null);

  // Ces matchs sont deja resolus et le vainqueur est avance au tour suivant.
  assert.equal(t.matches.r0m0.status, "done");
  assert.equal(nameOf(t, t.matches.r0m0.winnerId), "P1");
  assert.equal(nameOf(t, t.matches.r1m0.aId), "P1", "P1 place au round 1");
  assert.equal(nameOf(t, t.matches.r1m1.aId), "P2", "P2 place au round 1");

  // Les matchs joues du 1er tour restent en attente.
  assert.equal(t.matches.r0m1.status, "pending");
  assert.equal(t.matches.r0m3.status, "pending");
});

test("byes : un bye ne cree pas de faux elimine", async () => {
  const G = "g_byes_elim";
  await withPlayers(G, 6);
  const t = await generateBracket(G);
  const eliminated = t.participants.filter((p) => p.eliminated).map((p) => p.name);
  assert.deepEqual(eliminated, [], "personne n'est elimine avant d'avoir joue");
});

test("progression complete : 4 joueurs joues jusqu'a la finale", async () => {
  const G = "g_full4";
  await withPlayers(G, 4);
  let t = await generateBracket(G);

  // Round 0 : les seeds 1 et 2 gagnent (r0m0 = P1 vs P4, r0m1 = P2 vs P3).
  assert.deepEqual([nameOf(t, t.matches.r0m0.aId), nameOf(t, t.matches.r0m0.bId)], ["P1", "P4"]);
  assert.deepEqual([nameOf(t, t.matches.r0m1.aId), nameOf(t, t.matches.r0m1.bId)], ["P2", "P3"]);

  t = await reportResult(G, "r0m0", 2, 0);
  assert.equal(nameOf(t, t.matches.r0m0.winnerId), "P1");
  assert.equal(t.participants.find((p) => p.name === "P4").eliminated, true);
  assert.equal(nameOf(t, t.matches.r1m0.aId), "P1", "le vainqueur avance en finale");

  t = await reportResult(G, "r0m1", 0, 2);
  assert.equal(nameOf(t, t.matches.r0m1.winnerId), "P3");
  assert.equal(nameOf(t, t.matches.r1m0.bId), "P3");
  assert.equal(t.status, "running", "pas encore termine : la finale reste a jouer");

  // Finale.
  t = await reportResult(G, "r1m0", 3, 1);
  assert.equal(t.status, "completed");
  assert.equal(tournamentWinner(t)?.name, "P1");
});

test("tournamentWinner ne renvoie un vainqueur que sur un tournoi termine", async () => {
  const G = "g_winner";
  await withPlayers(G, 4);
  const t = await generateBracket(G);
  assert.equal(tournamentWinner(t), null, "tournoi en cours => pas de vainqueur");
  assert.equal(tournamentWinner(null), null);
  assert.equal(tournamentWinner({ status: "completed", rounds: 0 }), null);
});

test("podium : champion, finaliste et demi-finalistes", async () => {
  const G = "g_podium";
  await withPlayers(G, 4);
  await generateBracket(G);
  await reportResult(G, "r0m0", 2, 0); // P1 bat P4
  await reportResult(G, "r0m1", 2, 0); // P2 bat P3
  const t = await reportResult(G, "r1m0", 3, 2); // P1 bat P2 en finale

  const podium = tournamentPodium(t);
  assert.equal(podium.first?.name, "P1");
  assert.equal(podium.second?.name, "P2");
  assert.deepEqual(podium.thirds.map((p) => p.name).sort(), ["P3", "P4"]);
  assert.equal(podium.mvp, null, "aucune manche detaillee => pas de MVP");
  assert.equal(podium.mostWins, 0);
});

test("reportResult refuse les cas invalides", async () => {
  const G = "g_guards";
  await withPlayers(G, 4);
  await generateBracket(G);

  await assert.rejects(() => reportResult(G, "r0m0", 2, 2), /gagnant/i, "scores egaux");
  await assert.rejects(() => reportResult(G, "inconnu", 2, 0), /introuvable/i, "match inexistant");
  // La finale n'a pas encore ses deux joueurs.
  await assert.rejects(() => reportResult(G, "r1m0", 2, 0), /deux joueurs/i);
});

test("generateBracket exige au moins 2 participants", async () => {
  const G = "g_solo";
  await withPlayers(G, 1);
  await assert.rejects(() => generateBracket(G), /2 participants/i);
});

test("check-in : les joueurs non confirmes sont exclus du bracket", async () => {
  const G = "g_checkin";
  await withPlayers(G, 4, { checkInEnabled: true });
  const before = await getTournament(G);
  assert.equal(before.participants.every((p) => !p.checkedIn), true, "personne n'a confirme");

  // Aucun check-in => moins de 2 joueurs eligibles => refus.
  await assert.rejects(() => generateBracket(G), /2 participants/i);

  // En ignorant le check-in, la generation passe.
  const t = await generateBracket(G, { onlyCheckedIn: false });
  assert.equal(t.rounds, 2);
});

test("matchBestOf : la finale utilise finalsBestOf", async () => {
  const G = "g_bo";
  await withPlayers(G, 4, { bestOf: 3, finalsBestOf: 5 });
  const t = await generateBracket(G);
  assert.equal(matchBestOf(t, t.matches.r0m0), 3, "match ordinaire");
  assert.equal(matchBestOf(t, t.matches.r1m0), 5, "finale");
});

test("scoreOptions : victoires puis defaites, coherentes avec le best-of", () => {
  assert.deepEqual(scoreOptions(3).map((o) => [o.self, o.opp]), [[2, 1], [2, 0], [0, 2], [1, 2]]);
  assert.deepEqual(scoreOptions(1).map((o) => [o.self, o.opp]), [[1, 0], [0, 1]]);
  assert.deepEqual(scoreOptions(5).map((o) => [o.self, o.opp]), [[3, 2], [3, 1], [3, 0], [0, 3], [1, 3], [2, 3]]);
  // Toutes les options ont un gagnant net.
  for (const bo of [1, 3, 5, 7]) {
    for (const o of scoreOptions(bo)) assert.notEqual(o.self, o.opp);
  }
});

test("userEntrant retrouve l'inscrit par son identifiant Discord", async () => {
  const G = "g_entrant";
  const t = await withPlayers(G, 3);
  assert.equal(userEntrant(t, "u2")?.name, "P2");
  assert.equal(userEntrant(t, "inconnu"), null);
});

test("listDisputes est vide sur un bracket sain", async () => {
  const G = "g_disputes";
  await withPlayers(G, 4);
  const t = await generateBracket(G);
  assert.deepEqual(listDisputes(t), []);
});

test("le bracket est bien persiste (relecture depuis le store)", async () => {
  const G = "g_persist";
  await withPlayers(G, 8);
  const generated = await generateBracket(G);
  const reloaded = await getTournament(G);
  assert.equal(reloaded.rounds, generated.rounds);
  assert.equal(Object.keys(reloaded.matches).length, Object.keys(generated.matches).length);
  assert.equal(reloaded.matches.r0m0.aId, generated.matches.r0m0.aId);
  assert.equal(idOf(reloaded, "P1"), idOf(generated, "P1"));
});
