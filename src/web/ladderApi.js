import {
  getLadderConfig,
  getSeasonInfo,
  getLadderRanking,
  getLadderMatch,
  listLadderMatches,
  recentValidatedMatches,
  validatedThisSeason,
  ladderNames,
  autoConfirmAt,
} from "../ladder.js";
import { staffResolveLadder, staffVoidLadder, closeLadderSeason } from "../commands/ladder.js";

/**
 * Routes du dashboard pour le ladder (page Communauté › Ladder), montées par server.js
 * derrière `requireAdmin` : état (classement, défis en cours, litiges, saisons), décisions
 * staff et nouvelle saison. La config passe par PUT /api/config/ladder (buildSections).
 */

function matchView(m, cfg) {
  return {
    id: m.id,
    aId: m.a_id,
    bId: m.b_id,
    aName: m.a_name,
    bName: m.b_name,
    bestOf: m.best_of,
    scoreA: m.score_a,
    scoreB: m.score_b,
    status: m.status,
    createdAt: m.created_at,
    acceptedAt: m.accepted_at || null,
    reportedAt: m.reported_at || null,
    resolvedAt: m.resolved_at || null,
    resolvedBy: m.resolved_by || null,
    winnerId: m.winner_id || null,
    eloDelta: m.elo_delta,
    autoConfirmAt: autoConfirmAt(m, cfg) || null,
    dispute: m.dispute ? { reason: m.dispute.reason, by: m.dispute.by, byName: m.dispute.byName, files: m.dispute.files, at: m.dispute.at } : null,
    channelId: m.channel_id || null,
    messageId: m.message_id || null,
  };
}

/** État complet du ladder pour le dashboard. `displayName(userId)` : nom actuel ou null. */
export async function ladderStatus(guildId, displayName = () => null) {
  const cfg = await getLadderConfig(guildId);
  const info = getSeasonInfo(guildId);
  const frozen = ladderNames(guildId);
  const nameOf = (id) => displayName(id) || frozen[id] || null;
  const views = (status) => listLadderMatches(guildId, status).map((m) => matchView(m, cfg));
  const ranking = getLadderRanking(guildId);
  const disputes = views("disputed");
  const waiting = views("reported");
  const active = [...views("pending"), ...views("accepted")];
  return {
    season: { number: info.season, startedAt: info.startedAt || null },
    stats: {
      ranked: ranking.length,
      validated: validatedThisSeason(guildId),
      active: active.length,
      waiting: waiting.length,
      disputes: disputes.length,
    },
    ranking: ranking.slice(0, 100).map((r) => ({
      position: r.position,
      userId: r.user_id,
      name: nameOf(r.user_id),
      elo: r.elo,
      wins: r.wins,
      losses: r.losses,
      streak: r.streak,
      played: r.played,
      updatedAt: r.updated_at,
    })),
    disputes,
    waiting,
    active,
    recent: recentValidatedMatches(guildId, 15).map((m) => matchView(m, cfg)),
    seasons: info.seasons.map((s) => ({ ...s, top: s.top.map((p) => ({ ...p, name: nameOf(p.userId) })) })),
  };
}

function httpError(res, r) {
  return res.status(r.error === "Défi introuvable." ? 404 : 409).json({ error: r.error });
}

/** Monte les routes /api/ladder/* (l'appelant applique requireAdmin et le parseur JSON). */
export function mountLadderApi(app, { client, guildId, requireAdmin }) {
  const fetchGuild = () => client.guilds.fetch(guildId);
  const currentName = (guild) => (id) => guild?.members?.cache?.get(id)?.displayName || null;

  app.get("/api/ladder/status", requireAdmin, async (req, res) => {
    try {
      const guild = await fetchGuild().catch(() => null);
      res.json(await ladderStatus(guildId, currentName(guild)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ladder/resolve", requireAdmin, async (req, res) => {
    try {
      const { matchId, winner } = req.body || {};
      if (winner !== "a" && winner !== "b") return res.status(400).json({ error: "Vainqueur invalide." });
      if (!getLadderMatch(guildId, matchId)) return res.status(404).json({ error: "Défi introuvable." });
      const guild = await fetchGuild();
      const r = await staffResolveLadder(client, guild, String(matchId), winner, req.session.id);
      if (!r.ok) return httpError(res, r);
      res.json({ ok: true, delta: r.result.delta, winnerId: r.match.winner_id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ladder/void", requireAdmin, async (req, res) => {
    try {
      const { matchId } = req.body || {};
      if (!getLadderMatch(guildId, matchId)) return res.status(404).json({ error: "Défi introuvable." });
      const guild = await fetchGuild();
      const r = await staffVoidLadder(client, guild, String(matchId), req.session.id);
      if (!r.ok) return httpError(res, r);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ladder/reset", requireAdmin, async (req, res) => {
    try {
      const guild = await fetchGuild();
      const archive = await closeLadderSeason(guild, { by: req.session.id });
      res.json({ ok: true, archive });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
