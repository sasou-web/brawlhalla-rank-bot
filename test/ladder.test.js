import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LADDER_CONFIG,
  winsNeeded,
  eloUpdate,
  nextStatus,
  ladderRanking,
  challengeError,
  initialResetKey,
  seasonResetDue,
  getLadderConfig,
  setLadderConfig,
  getSeasonInfo,
  getLadderMatch,
  createChallenge,
  discardChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  recordGame,
  undoGame,
  confirmResult,
  disputeLadderMatch,
  resolveLadderMatch,
  voidLadderMatch,
  getLadderPlayer,
  getLadderRanking,
  ladderStanding,
  recentLadderMatches,
  resetLadderSeason,
  maybeResetLadderSeason,
} from "../src/ladder.js";
import { handleLadderButton, handleLadderModal, tickLadder } from "../src/commands/ladder.js";
import { buildLadderCard, buildLadderResultAnnounce } from "../src/ladderUI.js";

/**
 * Ladder interne (/defi, /ladder) : Elo, machine d'états, classement, garde-fous des défis,
 * parcours complet sur le vrai store (base SQLite temporaire de scripts/run-tests.js),
 * boucle de fond (expiration, validation automatique) et interactions principales.
 */

const H = 3600_000;
const CFG = { ...DEFAULT_LADDER_CONFIG, enabled: true, channelId: "100000" };

// Défi accepté entre ua et ub (BO3 par défaut), créé à `now`.
function accepted(G, { a = "ua", b = "ub", bestOf = 3, cfg = CFG, now = Date.now() } = {}) {
  const c = createChallenge(G, { aId: a, bId: b, aName: a.toUpperCase(), bName: b.toUpperCase(), bestOf, cfg, now });
  assert.ok(c.ok, c.error);
  const r = acceptChallenge(G, c.match.id, b, now);
  assert.ok(r.ok, r.error);
  return r.match;
}

// Joue les manches `games` ("aab"…) et renvoie le dernier résultat de recordGame.
function play(G, id, games, by = "ua", now = Date.now()) {
  let r = null;
  for (const side of games) {
    const played = getLadderMatch(G, id).game_log.length;
    r = recordGame(G, id, side, by, played, now);
    assert.ok(r.ok, r.error);
  }
  return r;
}

// ═══════════════════ Elo ═══════════════════

test("eloUpdate : Elo égaux, le vainqueur prend K/2", () => {
  assert.deepEqual(eloUpdate(1000, 1000, true, 32), { ra2: 1016, rb2: 984, delta: 16 });
  assert.deepEqual(eloUpdate(1000, 1000, false, 32), { ra2: 984, rb2: 1016, delta: -16 });
  assert.equal(eloUpdate(1000, 1000, true, 64).delta, 32);
});

test("eloUpdate : symétrique, le total des points est conservé", () => {
  for (const [ra, rb] of [[1000, 1000], [1200, 950], [870, 1430], [2400, 300]]) {
    for (const aWins of [true, false]) {
      const { ra2, rb2, delta } = eloUpdate(ra, rb, aWins, 32);
      assert.equal(ra2 + rb2, ra + rb);
      assert.equal(ra2 - ra, delta);
      // Même match vu de l'autre côté.
      assert.equal(eloUpdate(rb, ra, !aWins, 32).delta, -delta);
    }
  }
});

test("eloUpdate : le favori gagne peu, l'outsider gagne beaucoup", () => {
  const fav = eloUpdate(1400, 1000, true, 32).delta;
  const under = eloUpdate(1000, 1400, true, 32).delta;
  assert.ok(fav > 0 && fav < 8, `favori : ${fav}`);
  assert.ok(under > 24 && under <= 32, `outsider : ${under}`);
  assert.equal(fav + under, 32);
});

test("eloUpdate : bornes, le vainqueur gagne entre 1 et K points", () => {
  assert.equal(eloUpdate(3000, 100, true, 32).delta, 1);
  assert.equal(eloUpdate(100, 3000, true, 32).delta, 32);
  assert.equal(eloUpdate(3000, 100, false, 32).delta, -32);
  assert.equal(eloUpdate(100, 3000, false, 32).delta, -1);
  assert.equal(eloUpdate(1000, 1000, true, 0).delta, 16, "K invalide : facteur par défaut");
});

test("winsNeeded : premier à ⌈bo/2⌉", () => {
  assert.equal(winsNeeded(1), 1);
  assert.equal(winsNeeded(3), 2);
  assert.equal(winsNeeded(5), 3);
});

// ═══════════════════ Machine d'états ═══════════════════

const M = (status, extra = {}) => ({ status, a_id: "a", b_id: "b", winner_id: null, ...extra });
const ok = (r, status) => {
  assert.equal(r.ok, true, r.error);
  assert.equal(r.status, status);
};
const ko = (r, re) => {
  assert.equal(r.ok, false);
  if (re) assert.match(r.error, re);
};

test("nextStatus : défi en attente, seul le défié répond, seul l'auteur retire", () => {
  ok(nextStatus(M("pending"), "accept", "b"), "accepted");
  ok(nextStatus(M("pending"), "decline", "b"), "declined");
  ko(nextStatus(M("pending"), "accept", "a"), /Seul le joueur défié/);
  ko(nextStatus(M("pending"), "accept", "x"));
  ok(nextStatus(M("pending"), "cancel", "a"), "cancelled");
  ko(nextStatus(M("pending"), "cancel", "b"), /Seul l'auteur/);
  ko(nextStatus(M("pending"), "game", "a"), /pas encore été accepté/);
  ko(nextStatus(M("pending"), "dispute", "a"));
  ok(nextStatus(M("pending"), "expire", null), "expired");
});

test("nextStatus : match en cours, manches et litige pour les deux joueurs uniquement", () => {
  ok(nextStatus(M("accepted"), "game", "a"), "accepted");
  ok(nextStatus(M("accepted"), "undo", "b"), "accepted");
  ok(nextStatus(M("accepted"), "report", "b"), "reported");
  ko(nextStatus(M("accepted"), "game", "x"), /Réservé aux deux joueurs/);
  ok(nextStatus(M("accepted"), "dispute", "a"), "disputed");
  ko(nextStatus(M("accepted"), "dispute", "x"));
  ko(nextStatus(M("accepted"), "confirm", "b"));
  ko(nextStatus(M("accepted"), "accept", "b"));
  ko(nextStatus(M("accepted"), "cancel", "a"), /ne peut plus être retiré/);
  ok(nextStatus(M("accepted"), "expire", null), "expired");
  ko(nextStatus(M("accepted"), "expire", "a"), /réservée au bot/);
});

test("nextStatus : score final, seul le perdant confirme, jamais le vainqueur pour l'autre", () => {
  const rep = M("reported", { winner_id: "a" });
  ok(nextStatus(rep, "confirm", "b"), "confirmed");
  ko(nextStatus(rep, "confirm", "a"), /Seul le perdant/);
  ko(nextStatus(rep, "confirm", "x"), /Seul le perdant/);
  ko(nextStatus(rep, "confirm", null), /Seul le perdant/);
  ok(nextStatus(rep, "autoconfirm", null), "confirmed");
  ko(nextStatus(rep, "autoconfirm", "b"), /réservée au bot/);
  ok(nextStatus(rep, "dispute", "a"), "disputed");
  ko(nextStatus(rep, "game", "a"), /ne peut plus être modifié/);
  ko(nextStatus(rep, "expire", null)); // un résultat déclaré n'expire pas : il est validé
  ok(nextStatus(rep, "resolve", "mod", { isStaff: true }), "resolved");
});

test("nextStatus : litige, seul le staff tranche ou annule", () => {
  const d = M("disputed", { winner_id: "a" });
  ko(nextStatus(d, "dispute", "b"), /déjà en cours/);
  ko(nextStatus(d, "confirm", "b"));
  ko(nextStatus(d, "autoconfirm", null));
  ko(nextStatus(d, "resolve", "a"), /Réservé au staff/);
  ok(nextStatus(d, "resolve", "mod", { isStaff: true }), "resolved");
  ok(nextStatus(d, "void", "mod", { isStaff: true }), "cancelled");
  ko(nextStatus(d, "expire", null));
});

test("nextStatus : un défi clos n'accepte plus aucune action, staff compris", () => {
  const actions = ["accept", "decline", "cancel", "game", "undo", "report", "confirm", "dispute", "expire", "autoconfirm", "resolve", "void"];
  for (const status of ["confirmed", "resolved", "declined", "expired", "cancelled"]) {
    for (const action of actions) {
      for (const by of [null, "a", "b"]) {
        const r = nextStatus(M(status, { winner_id: "a" }), action, by, { isStaff: true });
        assert.equal(r.ok, false, `${status} / ${action} / ${by}`);
      }
    }
  }
  ko(nextStatus(M("accepted"), "teleport", "a"), /inconnue/);
});

// ═══════════════════ Classement et garde-fous ═══════════════════

test("ladderRanking : par Elo, puis victoires, puis moins de défaites ; sans les joueurs sans match", () => {
  const row = (user_id, elo, wins, losses, updated_at = 0) => ({ user_id, elo, wins, losses, played: wins + losses, updated_at });
  const r = ladderRanking([
    row("low", 950, 1, 3),
    row("top", 1100, 4, 1),
    row("tieMoreWins", 1000, 3, 2),
    row("tieFewerWins", 1000, 2, 0),
    row("tieSameWinsMoreLosses", 1000, 2, 4),
    { user_id: "ghost", elo: 1500, wins: 0, losses: 0, played: 0, updated_at: 0 },
  ]);
  assert.deepEqual(
    r.map((x) => x.user_id),
    ["top", "tieMoreWins", "tieFewerWins", "tieSameWinsMoreLosses", "low"],
  );
  assert.deepEqual(r.map((x) => x.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(ladderRanking([]), []);
});

test("challengeError : soi-même, bot, format, comptes liés, défi en cours, limite par paire, cooldown", () => {
  const base = { aId: "a", bId: "b", bestOf: 3, cfg: CFG, now: 10 * H };
  assert.equal(challengeError(base), null);
  assert.match(challengeError({ ...base, bId: "a" }), /toi-même/);
  assert.match(challengeError({ ...base, targetBot: true }), /bots/);
  assert.match(challengeError({ ...base, bestOf: 2 }), /BO1, BO3 ou BO5/);
  assert.match(challengeError({ ...base, linkedA: false }), /Lie d'abord ton compte/);
  assert.match(challengeError({ ...base, linkedB: false }), /n'a pas lié son compte/);
  assert.equal(challengeError({ ...base, linkedA: false, linkedB: false, cfg: { ...CFG, requireLink: false } }), null);
  assert.match(challengeError({ ...base, active: { id: "x" } }), /déjà en cours/);
  assert.match(challengeError({ ...base, pairCount: 3 }), /3 fois en 24 h \(maximum 3\)/);
  assert.equal(challengeError({ ...base, pairCount: 2 }), null);
  assert.match(challengeError({ ...base, lastByChallenger: 10 * H - 4 * 60_000 }), /dans 6 min/);
  assert.equal(challengeError({ ...base, lastByChallenger: 10 * H - 10 * 60_000 }), null);
});

// ═══════════════════ Store : parcours complet ═══════════════════

test("défi complet : accepté, joué, confirmé par le perdant, les deux lignes du ladder sont mises à jour", () => {
  const G = "g_lad_flow";
  const t0 = Date.now();
  const c = createChallenge(G, { aId: "ua", bId: "ub", aName: "Alice", bName: "Bob", bestOf: 3, cfg: CFG, now: t0 });
  assert.ok(c.ok, c.error);
  const id = c.match.id;
  assert.equal(c.match.status, "pending");
  assert.equal(c.match.a_name, "Alice");

  assert.equal(acceptChallenge(G, id, "ua").ok, false, "l'auteur n'accepte pas son propre défi");
  assert.equal(acceptChallenge(G, id, "ub", t0 + 1000).match.status, "accepted");

  assert.equal(play(G, id, "a").finished, false);
  assert.equal(play(G, id, "b", "ub").finished, false);
  const last = play(G, id, "a", "ub", t0 + 2000);
  assert.equal(last.finished, true);
  assert.equal(last.match.status, "reported");
  assert.equal(last.match.winner_id, "ua");
  assert.equal(`${last.match.score_a}-${last.match.score_b}`, "2-1");
  assert.equal(last.match.game_log, "aba");
  assert.equal(getLadderPlayer(G, "ua"), null, "aucun point avant la confirmation");

  const byWinner = confirmResult(G, id, "ua", CFG);
  assert.equal(byWinner.ok, false, "le vainqueur ne confirme pas pour l'autre");
  assert.match(byWinner.error, /Seul le perdant/);

  const done = confirmResult(G, id, "ub", CFG, t0 + 3000);
  assert.ok(done.ok, done.error);
  assert.equal(done.match.status, "confirmed");
  assert.equal(done.match.resolved_by, "ub");
  assert.equal(done.match.elo_delta, 16);
  assert.deepEqual(done.result, { delta: 16, winnerId: "ua", loserId: "ub", winnerElo: 1016, loserElo: 984 });

  const a = getLadderPlayer(G, "ua");
  const b = getLadderPlayer(G, "ub");
  assert.deepEqual([a.elo, a.wins, a.losses, a.streak, a.played], [1016, 1, 0, 1, 1]);
  assert.deepEqual([b.elo, b.wins, b.losses, b.streak, b.played], [984, 0, 1, -1, 1]);
  assert.deepEqual(getLadderRanking(G).map((r) => [r.user_id, r.position]), [["ua", 1], ["ub", 2]]);
  assert.equal(ladderStanding(G, "ub").position, 2);
  assert.equal(recentLadderMatches(G, "ub")[0].id, id);

  assert.equal(confirmResult(G, id, "ub", CFG).ok, false, "pas de double validation");

  // Revanche après le cooldown : Bob gagne à son tour, les séries s'inversent.
  const re = accepted(G, { a: "ub", b: "ua", now: t0 + 11 * 60_000 });
  play(G, re.id, "aa", "ub");
  assert.ok(confirmResult(G, re.id, "ua", CFG).ok);
  assert.equal(getLadderPlayer(G, "ua").streak, -1);
  assert.equal(getLadderPlayer(G, "ub").streak, 1);
  assert.equal(getLadderPlayer(G, "ua").elo + getLadderPlayer(G, "ub").elo, 2000);
});

test("annonce du résultat : « @a bat @b 2-1 (+16 / -16) — #1 du ladder », sans mention qui notifie", () => {
  const m = { a_id: "ua", b_id: "ub", winner_id: "ua", score_a: 2, score_b: 1, elo_delta: 16 };
  const p = buildLadderResultAnnounce(m, { position: 1 });
  assert.equal(p.content, "⚔️ <@ua> bat <@ub> **2-1** (+16 / -16) — #1 du ladder");
  assert.deepEqual(p.allowedMentions, { parse: [] });
});

test("createChallenge : un seul défi par paire, limite par jour, cooldown de l'auteur", () => {
  const G = "g_lad_limits";
  const t0 = 1_800_000_000_000;
  const cfg = { ...CFG, maxPerDayPerPair: 2 };
  const first = createChallenge(G, { aId: "p1", bId: "p2", bestOf: 1, cfg, now: t0 });
  assert.ok(first.ok);

  const reverse = createChallenge(G, { aId: "p2", bId: "p1", bestOf: 1, cfg, now: t0 + 1000 });
  assert.match(reverse.error, /déjà en cours entre vous deux/, "la paire est bloquée dans les deux sens");

  const tooSoon = createChallenge(G, { aId: "p1", bId: "p3", bestOf: 1, cfg, now: t0 + 60_000 });
  assert.match(tooSoon.error, /réessaie dans 9 min/);

  assert.ok(declineChallenge(G, first.match.id, "p2", t0 + 2000).ok);
  const second = createChallenge(G, { aId: "p2", bId: "p1", bestOf: 1, cfg, now: t0 + 3000 });
  assert.ok(second.ok, second.error);
  assert.ok(cancelChallenge(G, second.match.id, "p2", t0 + 4000).ok);

  const third = createChallenge(G, { aId: "p1", bId: "p2", bestOf: 1, cfg, now: t0 + 20 * 60_000 });
  assert.match(third.error, /2 fois en 24 h \(maximum 2\)/, "refusés et retirés comptent");
  const nextDay = createChallenge(G, { aId: "p1", bId: "p2", bestOf: 1, cfg, now: t0 + 24 * H + 1 });
  assert.ok(nextDay.ok, nextDay.error);

  assert.match(createChallenge(G, { aId: "p4", bId: "p4", bestOf: 3, cfg, now: t0 }).error, /toi-même/);
  assert.match(createChallenge(G, { aId: "p4", bId: "bot", targetBot: true, bestOf: 3, cfg, now: t0 }).error, /bots/);
  assert.match(createChallenge(G, { aId: "p4", bId: "p5", linkedB: false, bestOf: 3, cfg, now: t0 }).error, /\/lier/);
});

test("discardChallenge : un défi jamais publié ne bloque ni la paire ni le cooldown", () => {
  const G = "g_lad_discard";
  const t0 = Date.now();
  const c = createChallenge(G, { aId: "d1", bId: "d2", bestOf: 3, cfg: CFG, now: t0 });
  discardChallenge(G, c.match.id);
  assert.equal(getLadderMatch(G, c.match.id), null);
  assert.ok(createChallenge(G, { aId: "d1", bId: "d2", bestOf: 3, cfg: CFG, now: t0 + 1000 }).ok);
});

test("recordGame : clic périmé refusé, annulation de la dernière manche, joueurs uniquement", () => {
  const G = "g_lad_games";
  const m = accepted(G, { bestOf: 5 });
  assert.ok(recordGame(G, m.id, "a", "ua", 0).ok);
  const stale = recordGame(G, m.id, "a", "ub", 0);
  assert.equal(stale.ok, false, "deux clics sur le même scoreboard : une seule manche");
  assert.match(stale.error, /score a changé/);
  assert.equal(recordGame(G, m.id, "a", "ua", Number.NaN).ok, false);
  assert.equal(recordGame(G, m.id, "c", "ua", 1).ok, false);
  assert.match(recordGame(G, m.id, "b", "intrus", 1).error, /Réservé aux deux joueurs/);
  assert.equal(getLadderMatch(G, m.id).score_a, 1);

  const u = undoGame(G, m.id, "ub");
  assert.ok(u.ok);
  assert.deepEqual([u.match.score_a, u.match.score_b, u.match.game_log], [0, 0, ""]);
  assert.match(undoGame(G, m.id, "ua").error, /Aucune manche/);
});

test("litige puis décision du staff : score corrigé, Elo appliqué ; annulation : aucun point", () => {
  const G = "g_lad_staff";
  const m = accepted(G);
  play(G, m.id, "ab");
  const d = disputeLadderMatch(G, m.id, "ub", { reason: "  Il a quitté  ", byName: "Bob", files: 2 });
  assert.ok(d.ok);
  assert.equal(d.match.status, "disputed");
  assert.deepEqual(
    { reason: d.match.dispute.reason, by: d.match.dispute.by, byName: d.match.dispute.byName, files: d.match.dispute.files, fromStatus: d.match.dispute.fromStatus },
    { reason: "Il a quitté", by: "ub", byName: "Bob", files: 2, fromStatus: "accepted" },
  );
  assert.equal(disputeLadderMatch(G, m.id, "ua", { reason: "x" }).ok, false, "un seul litige à la fois");
  assert.equal(confirmResult(G, m.id, null, CFG).ok, false, "pas de validation automatique pendant un litige");

  assert.equal(resolveLadderMatch(G, m.id, "c", { by: "mod", cfg: CFG }).ok, false);
  const r = resolveLadderMatch(G, m.id, "b", { by: "mod", cfg: CFG });
  assert.ok(r.ok, r.error);
  assert.equal(r.match.status, "resolved");
  assert.equal(r.match.winner_id, "ub");
  assert.equal(`${r.match.score_a}-${r.match.score_b}`, "1-2", "le vainqueur désigné a les manches requises");
  assert.equal(r.match.resolved_by, "mod");
  assert.equal(getLadderPlayer(G, "ub").elo, 1016);
  assert.equal(getLadderPlayer(G, "ua").elo, 984);

  const v = accepted(G, { a: "uc", b: "ud" });
  const voided = voidLadderMatch(G, v.id, { by: "mod" });
  assert.equal(voided.match.status, "cancelled");
  assert.equal(getLadderPlayer(G, "uc"), null);
  assert.equal(voidLadderMatch(G, v.id, { by: "mod" }).ok, false);
});

// ═══════════════════ Configuration et saisons ═══════════════════

test("setLadderConfig : bornes, identifiants vérifiés, clés inconnues ignorées", async () => {
  const G = "g_lad_cfg";
  const c = await setLadderConfig(G, { enabled: true, kFactor: 500, startElo: "abc", autoConfirmHours: -3, maxPerDayPerPair: 2.6, channelId: " 123456789 ", foo: 1 });
  assert.equal(c.enabled, true);
  assert.equal(c.kFactor, 64);
  assert.equal(c.startElo, 1000);
  assert.equal(c.autoConfirmHours, 0);
  assert.equal(c.maxPerDayPerPair, 3);
  assert.equal(c.channelId, "123456789");
  assert.equal("foo" in c, false);
  await assert.rejects(setLadderConfig(G, { modAlertChannelId: "salon" }), (e) => e.httpStatus === 400);
  assert.equal((await getLadderConfig(G)).modAlertChannelId, "");
});

test("saisons : mois de référence et remise à zéro mensuelle à l'heure de Paris", () => {
  const oct16 = Date.UTC(2026, 9, 16, 12);
  assert.equal(initialResetKey(1, oct16), "2026-10");
  assert.equal(initialResetKey(20, oct16), "2026-09", "le 20 n'est pas encore passé : la remise à zéro aura lieu ce mois-ci");
  assert.equal(initialResetKey(20, Date.UTC(2026, 0, 5, 12)), "2025-12");

  assert.deepEqual(seasonResetDue(1, "2026-10", Date.UTC(2026, 9, 31, 22, 30)), { due: false, key: "2026-10" });
  // 31 octobre 23 h 30 UTC = 1er novembre 0 h 30 à Paris.
  assert.deepEqual(seasonResetDue(1, "2026-10", Date.UTC(2026, 9, 31, 23, 30)), { due: true, key: "2026-11" });
  assert.equal(seasonResetDue(1, "2026-11", Date.UTC(2026, 10, 2, 12)).due, false, "une fois par mois");
  assert.equal(seasonResetDue(0, "2026-10", Date.UTC(2026, 10, 2, 12)).due, false);
  assert.equal(seasonResetDue(1, "", Date.UTC(2026, 10, 2, 12)).due, false);
});

test("nouvelle saison : top archivé, classement vidé, Elo de départ ; jamais déclenchée en réglant la date", async () => {
  const G = "g_lad_season";
  const m = accepted(G);
  play(G, m.id, "aa");
  assert.ok(confirmResult(G, m.id, "ub", CFG).ok);

  const oct16 = Date.UTC(2026, 9, 16, 12);
  await setLadderConfig(G, { resetDay: 10 }, oct16);
  assert.equal(await maybeResetLadderSeason(G, oct16 + H), null, "régler la date ne clôt pas la saison");
  assert.equal(getLadderRanking(G).length, 2);

  const archive = await maybeResetLadderSeason(G, Date.UTC(2026, 10, 10, 9));
  assert.ok(archive);
  assert.equal(archive.season, 1);
  assert.equal(archive.by, "auto");
  assert.equal(archive.players, 2);
  assert.deepEqual(archive.top.map((p) => [p.position, p.userId, p.elo]), [[1, "ua", 1016], [2, "ub", 984]]);
  assert.deepEqual(getLadderRanking(G), []);
  assert.equal(getLadderPlayer(G, "ua"), null);
  const info = getSeasonInfo(G);
  assert.equal(info.season, 2);
  assert.equal(info.seasons[0].season, 1);
  assert.equal(await maybeResetLadderSeason(G, Date.UTC(2026, 10, 20, 9)), null, "une seule fois par mois");

  const manual = await resetLadderSeason(G, { by: "staff1" });
  assert.equal(manual.season, 2);
  assert.equal(manual.players, 0);
  assert.equal(getSeasonInfo(G).seasons.length, 2);
});

// ═══════════════════ Boucle de fond ═══════════════════

function fakeGuild(G, { ladderChannelId = "100000", alertChannelId = "200000" } = {}) {
  const sent = { ladder: [], alert: [] };
  const channel = (key, id) => ({
    id,
    isTextBased: () => true,
    send: async (p) => {
      sent[key].push(p);
      return { id: `${key}-msg-${sent[key].length}` };
    },
  });
  const ladder = channel("ladder", ladderChannelId);
  const alert = channel("alert", alertChannelId);
  const guild = {
    id: G,
    channels: { fetch: async (id) => (id === ladderChannelId ? ladder : id === alertChannelId ? alert : null) },
    members: { cache: new Map(), fetch: async () => null },
    roles: { cache: { find: () => undefined } },
  };
  const client = { channels: { fetch: async () => null } };
  return { guild, client, sent };
}

test("tickLadder : validation automatique après 12 h, expiration après 24 h, inerte si désactivé", async () => {
  const G = "g_lad_tick";
  await setLadderConfig(G, { enabled: true, channelId: "100000", autoConfirmHours: 12 });
  const cfg = await getLadderConfig(G);
  const t0 = Date.now();
  const pending = createChallenge(G, { aId: "t1", bId: "t2", bestOf: 3, cfg, now: t0 }).match;
  const rep = accepted(G, { a: "t3", b: "t4", cfg, now: t0 });
  play(G, rep.id, "bb", "t4", t0);
  const { guild, client, sent } = fakeGuild(G);

  assert.deepEqual(await tickLadder(client, guild, t0 + 11 * H), { expired: 0, confirmed: 0, season: null });

  const r12 = await tickLadder(client, guild, t0 + 12 * H + 1);
  assert.equal(r12.confirmed, 1);
  assert.equal(r12.expired, 0, "un défi sans réponse tient 24 h");
  const done = getLadderMatch(G, rep.id);
  assert.equal(done.status, "confirmed");
  assert.equal(done.resolved_by, "", "validé par le bot");
  assert.equal(getLadderPlayer(G, "t4").elo, 1016);
  assert.match(sent.ladder[0].content, /<@t4> bat <@t3> \*\*2-0\*\* \(\+16 \/ -16\) — #1 du ladder · validé automatiquement/);

  assert.equal((await tickLadder(client, guild, t0 + 24 * H + 1)).expired, 1);
  assert.equal(getLadderMatch(G, pending.id).status, "expired");

  // Ladder désactivé : rien ne bouge, même un défi accepté depuis longtemps.
  const idle = accepted(G, { a: "t5", b: "t6", cfg, now: t0 });
  await setLadderConfig(G, { enabled: false });
  assert.deepEqual(await tickLadder(client, guild, t0 + 48 * H), { expired: 0, confirmed: 0, season: null });
  assert.equal(getLadderMatch(G, idle.id).status, "accepted");
});

test("tickLadder : autoConfirmHours = 0, le résultat attend le perdant ou le staff", async () => {
  const G = "g_lad_tick_manual";
  await setLadderConfig(G, { enabled: true, channelId: "100000", autoConfirmHours: 0 });
  const cfg = await getLadderConfig(G);
  const t0 = Date.now();
  const m = accepted(G, { cfg, now: t0 });
  play(G, m.id, "aa", "ua", t0);
  const { guild, client } = fakeGuild(G);
  assert.deepEqual(await tickLadder(client, guild, t0 + 72 * H), { expired: 0, confirmed: 0, season: null });
  assert.equal(getLadderMatch(G, m.id).status, "reported");
  assert.match(buildLadderCard(getLadderMatch(G, m.id), { cfg }).embeds[0].description, /le staff tranchera/);
});

// ═══════════════════ Interactions ═══════════════════

function mockInteraction(env, customId, { userId = "ua", staff = false, reason = "Il a quitté en pleine manche", files = null } = {}) {
  const calls = [];
  const it = {
    customId,
    guild: env.guild,
    client: env.client,
    user: { id: userId, username: userId },
    member: { displayName: userId.toUpperCase(), roles: { cache: new Map() } },
    memberPermissions: { has: () => staff },
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: (id) => (id === "reason" ? reason : ""),
      getUploadedFiles: () => files,
    },
    reply: async (p) => { calls.push(["reply", p]); it.replied = true; },
    update: async (p) => { calls.push(["update", p]); it.replied = true; },
    followUp: async (p) => { calls.push(["followUp", p]); },
    showModal: async (p) => { calls.push(["showModal", p]); it.replied = true; },
    deferReply: async (p) => { calls.push(["deferReply", p]); it.deferred = true; },
    editReply: async (p) => { calls.push(["editReply", p]); },
    _calls: calls,
  };
  return it;
}

async function enabledGuild(G) {
  await setLadderConfig(G, { enabled: true, channelId: "100000", modAlertChannelId: "200000" });
  return fakeGuild(G);
}

test("boutons du scoreboard : manche avec le compteur du bouton, ping du perdant au score final", async () => {
  const G = "g_lad_btn_game";
  const env = await enabledGuild(G);
  const m = accepted(G);
  const card = buildLadderCard(m, { cfg: CFG });
  const ids = card.components[0].components.map((b) => b.custom_id);
  assert.deepEqual(ids, [`lad_game:${m.id}:a:0`, `lad_game:${m.id}:b:0`, `lad_undo:${m.id}`, `lad_dispute:${m.id}`]);

  const g1 = mockInteraction(env, `lad_game:${m.id}:a:0`);
  await handleLadderButton(g1);
  assert.equal(g1._calls[0][0], "update");
  assert.equal(g1._calls[0][1].components[0].components[0].custom_id, `lad_game:${m.id}:a:1`);

  const stale = mockInteraction(env, `lad_game:${m.id}:a:0`, { userId: "ub" });
  await handleLadderButton(stale);
  assert.equal(stale._calls[0][0], "reply");
  assert.match(stale._calls[0][1].content, /score a changé/);

  const g2 = mockInteraction(env, `lad_game:${m.id}:a:1`, { userId: "ub" });
  await handleLadderButton(g2);
  assert.equal(getLadderMatch(G, m.id).status, "reported");
  const ping = g2._calls.find(([k]) => k === "followUp")[1];
  assert.match(ping.content, /^<@ub>, confirme/);
  assert.deepEqual(ping.allowedMentions, { users: ["ub"] });

  const byWinner = mockInteraction(env, `lad_confirm:${m.id}`, { userId: "ua" });
  await handleLadderButton(byWinner);
  assert.match(byWinner._calls[0][1].content, /Seul le perdant/);
  assert.equal(getLadderMatch(G, m.id).status, "reported");

  const byLoser = mockInteraction(env, `lad_confirm:${m.id}`, { userId: "ub" });
  await handleLadderButton(byLoser);
  assert.equal(byLoser._calls[0][0], "update");
  assert.equal(getLadderMatch(G, m.id).status, "confirmed");
  assert.match(env.sent.ladder[0].content, /<@ua> bat <@ub> \*\*2-0\*\*/);
});

test("bouton Litige : ouvre directement le modal, refusé à un non-joueur", async () => {
  const G = "g_lad_btn_dispute";
  const env = await enabledGuild(G);
  const m = accepted(G);
  const it = mockInteraction(env, `lad_dispute:${m.id}`, { userId: "ub" });
  await handleLadderButton(it);
  const [kind, modal] = it._calls[0];
  assert.equal(kind, "showModal", "le modal est la première réponse");
  assert.equal(modal.custom_id, `lad_dispute_modal:${m.id}`);
  assert.equal(getLadderMatch(G, m.id).status, "accepted", "rien n'est écrit avant l'envoi du modal");

  const other = mockInteraction(env, `lad_dispute:${m.id}`, { userId: "intrus" });
  await handleLadderButton(other);
  assert.equal(other._calls[0][0], "reply");
  assert.match(other._calls[0][1].content, /Réservé aux deux joueurs/);
});

test("modal de litige, puis décision staff depuis l'alerte (avec confirmation)", async () => {
  const G = "g_lad_modal";
  const env = await enabledGuild(G);
  const m = accepted(G);
  play(G, m.id, "aa");

  const modal = mockInteraction(env, `lad_dispute_modal:${m.id}`, { userId: "ub", reason: "Score faux, j'ai gagné la 2e" });
  await handleLadderModal(modal);
  assert.equal(modal._calls[0][0], "deferReply", "accusé avant les appels Discord");
  const d = getLadderMatch(G, m.id);
  assert.equal(d.status, "disputed");
  assert.equal(d.dispute.reason, "Score faux, j'ai gagné la 2e");
  assert.equal(d.dispute.fromStatus, "reported");
  assert.equal(d.dispute.alertMessageId, "alert-msg-1");
  const alertIds = env.sent.alert[0].components[0].components.map((b) => b.custom_id);
  assert.deepEqual(alertIds, [`lad_modwin:${m.id}:a`, `lad_modwin:${m.id}:b`, `lad_modvoid:${m.id}`]);
  assert.match(modal._calls.at(-1)[1], /staff a été prévenu/);

  const player = mockInteraction(env, `lad_modwin:${m.id}:b`, { userId: "ub" });
  await handleLadderButton(player);
  assert.match(player._calls[0][1].content, /Réservé au staff/);

  const ask = mockInteraction(env, `lad_modwin:${m.id}:b`, { userId: "mod", staff: true });
  await handleLadderButton(ask);
  assert.equal(ask._calls[0][1].components[0].components[0].custom_id, `lad_modwinok:${m.id}:b`);
  assert.equal(getLadderMatch(G, m.id).status, "disputed", "rien n'est décidé sans confirmation");

  const confirm = mockInteraction(env, `lad_modwinok:${m.id}:b`, { userId: "mod", staff: true });
  await handleLadderButton(confirm);
  assert.equal(confirm._calls[0][0], "update", "accusé avant les appels Discord");
  assert.match(confirm._calls.at(-1)[1].content, /Victoire attribuée à \*\*UB\*\* \(\+16 Elo\)/);
  const r = getLadderMatch(G, m.id);
  assert.equal(r.status, "resolved");
  assert.equal(r.winner_id, "ub");
  assert.equal(`${r.score_a}-${r.score_b}`, "1-2");
  assert.equal(getLadderPlayer(G, "ub").elo, 1016);
  assert.match(env.sent.ladder.at(-1).content, /décision du staff/);
});

test("ladder désactivé : boutons des joueurs refusés, décisions staff toujours possibles", async () => {
  const G = "g_lad_btn_off";
  const env = await enabledGuild(G);
  const m = accepted(G);
  await setLadderConfig(G, { enabled: false });
  const it = mockInteraction(env, `lad_game:${m.id}:a:0`);
  await handleLadderButton(it);
  assert.match(it._calls[0][1].content, /désactivé/);
  const staff = mockInteraction(env, `lad_modvoid:${m.id}`, { userId: "mod", staff: true });
  await handleLadderButton(staff);
  assert.equal(staff._calls[0][1].components[0].components[0].custom_id, `lad_modvoidok:${m.id}`);
});
