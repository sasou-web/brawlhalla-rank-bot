import { getTournament } from "../tournament.js";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, canCreateEvents } from "../tournamentSchedule.js";
import { occurrenceTimes, isOccurrenceTournament } from "../tournamentScheduleRules.js";

/**
 * Routes du dashboard pour les tournois récurrents (Événements › Tournois › Récurrents).
 * Routes dédiées comme /api/tournament (pas de section /api/config). Montées par server.js
 * derrière la garde admin de /api.
 */
export function mountTournamentScheduleRoutes(app, { client, guildId, requireAdmin }) {
  const view = (s, t) => ({ ...s, ...occurrenceTimes(s), running: isOccurrenceTournament(s, t) });

  app.get("/api/tournament/schedules", requireAdmin, async (req, res) => {
    try {
      const [list, t, guild] = await Promise.all([listSchedules(guildId), getTournament(guildId), client.guilds.fetch(guildId).catch(() => null)]);
      list.sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity) || a.name.localeCompare(b.name));
      // null = invérifiable (Discord injoignable) : le dashboard n'affiche alors aucun avertissement.
      const events = guild ? await canCreateEvents(guild).catch(() => null) : null;
      res.json({ schedules: list.map((s) => view(s, t)), canCreateEvents: events, tournament: t ? { name: t.name, status: t.status } : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tournament/schedules", requireAdmin, async (req, res) => {
    try {
      const s = await createSchedule(guildId, req.body || {});
      res.json(view(s, await getTournament(guildId)));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/tournament/schedules/:id", requireAdmin, async (req, res) => {
    try {
      const s = await updateSchedule(guildId, req.params.id, req.body || {});
      res.json(view(s, await getTournament(guildId)));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/tournament/schedules/:id", requireAdmin, async (req, res) => {
    try {
      await deleteSchedule(guildId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Force l'ouverture de la prochaine occurrence (pour tester un modèle).
  app.post("/api/tournament/schedules/:id/run-now", requireAdmin, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(guildId);
      res.json(await runScheduleNow(client, guild, req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}
