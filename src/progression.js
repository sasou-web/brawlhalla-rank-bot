import { getAllLinks } from "./store.js";
import { getRatingHistory } from "./ratingStore.js";
import { getSettings, setSetting } from "./settings.js";

/**
 * Récap hebdomadaire de progression : classe les membres liés par gain de rating 1v1
 * sur les 7 derniers jours, et publie un embed dans le salon d'annonces.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Calcule le top des progressions (fonction PURE, testable).
 * @param entries [{ discordId, name, history: [{ts, r1, r2, ...}] }]  (history triée par ts asc)
 * @param opts { now, windowMs, limit }
 * Renvoie [{ discordId, name, startR1, endR1, delta }] trié par delta décroissant (gains > 0).
 */
export function computeWeeklyProgress(entries, { now = Date.now(), windowMs = WEEK_MS, limit = 5 } = {}) {
  const cutoff = now - windowMs;
  const out = [];
  for (const e of entries || []) {
    const pts = (e.history || []).filter((p) => p && typeof p.ts === "number" && p.ts >= cutoff);
    if (pts.length < 2) continue; // pas assez de points dans la fenêtre pour mesurer un delta
    const start = pts[0];
    const end = pts[pts.length - 1];
    const delta = (end.r1 || 0) - (start.r1 || 0);
    if (delta <= 0) continue; // on ne met en avant que les progressions positives
    out.push({ discordId: e.discordId, name: e.name, startR1: start.r1 || 0, endR1: end.r1 || 0, delta });
  }
  out.sort((a, b) => b.delta - a.delta);
  return out.slice(0, Math.max(0, limit));
}

/** Construit l'embed du récap (objet brut prêt pour channel.send({ embeds: [...] })). */
export function buildWeeklyRecapEmbed(top, { guildName = "Serveur" } = {}) {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((e, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    return `${place} <@${e.discordId}> — **+${e.delta}** (${e.startR1} → ${e.endR1})`;
  });
  return {
    color: 0x2ecc71,
    title: "📈 Progression de la semaine — 1v1",
    description: lines.join("\n") || "*Personne n'a progressé cette semaine.*",
    footer: { text: `${guildName} · gains de rating 1v1 sur 7 jours` },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Exécute le récap si l'intervalle d'une semaine est écoulé (ou force=true).
 * Best-effort. Renvoie { posted, reason?, count? }.
 */
export async function runWeeklyRecap(client, guildId, { force = false } = {}) {
  const s = await getSettings();
  if (!s.announceChannelId) return { posted: false, reason: "no-announce-channel" };

  const now = Date.now();
  if (!force && now - (s.lastWeeklyRecapTs || 0) < WEEK_MS) {
    return { posted: false, reason: "not-due" };
  }

  const links = await getAllLinks();
  const entries = [];
  for (const [discordId, link] of Object.entries(links)) {
    const history = await getRatingHistory(link.brawlhallaId).catch(() => []);
    entries.push({ discordId, name: link.name, history });
  }
  const top = computeWeeklyProgress(entries, { now });

  // Quoi qu'il arrive (posté ou pas), on cale le prochain récap à dans une semaine.
  await setSetting("lastWeeklyRecapTs", now);

  if (!top.length) return { posted: false, reason: "no-gainers" };

  try {
    const guild = await client.guilds.fetch(guildId);
    const ch = await guild.channels.fetch(s.announceChannelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send({ embeds: [buildWeeklyRecapEmbed(top, { guildName: guild.name })], allowedMentions: { parse: [] } });
      return { posted: true, count: top.length };
    }
  } catch {
    /* best-effort */
  }
  return { posted: false, reason: "send-failed" };
}
