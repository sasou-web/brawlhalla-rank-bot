import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  getTournament,
  matchesNeedingChannels,
  setMatchChannel,
  setMatchMessage,
  liveMatchesWithChannel,
  doneMatchesWithChannel,
  clearMatchChannel,
  markAlerted,
} from "./tournament.js";
import { buildMatchPayload, buildModAlert } from "./tournamentUI.js";

/**
 * Automatisation des matchs de tournoi (extrait d'index.js) :
 * - création des salons texte/vocal par match (avec permissions par joueur/modo),
 * - timers : alerte staff sur litige ou inactivité,
 * - nettoyage des salons des matchs terminés.
 *
 * Point d'entrée : `tournamentTick(client, guild)` (appelé périodiquement).
 */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20) || "x";
}

async function sendModAlert(guild, t, matchId, reason) {
  if (!t.modAlertChannelId) return;
  const ch = await guild.channels.fetch(t.modAlertChannelId).catch(() => null);
  if (ch?.isTextBased?.()) await ch.send(buildModAlert(t, matchId, reason)).catch(() => {});
}

async function ensureMatchChannels(client, guild) {
  const t = await getTournament(guild.id);
  if (!t || t.status !== "running") return;
  for (const m of matchesNeedingChannels(t)) {
    const A = t.participants.find((p) => p.id === m.aId);
    const B = t.participants.find((p) => p.id === m.bId);
    if (!A || !B) continue;
    const players = [...A.members, ...B.members];
    const ow = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    for (const uid of players) ow.push({ id: uid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    if (t.modRoleId) ow.push({ id: t.modRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

    let channel;
    try {
      channel = await guild.channels.create({
        name: `match-${m.id}-${slug(A.name)}-vs-${slug(B.name)}`.slice(0, 95),
        type: ChannelType.GuildText,
        parent: t.matchCategoryId || null,
        permissionOverwrites: ow,
        reason: "Salon de match (tournoi)",
      });
    } catch (e) {
      console.warn("Salon de match échoué :", e.message);
      continue;
    }
    let voiceId = "";
    if (t.createVoice) {
      try {
        const vow = ow.map((o) => (o.deny ? o : { ...o, allow: [...o.allow, PermissionFlagsBits.Connect] }));
        const vc = await guild.channels.create({
          name: `🔊 ${slug(A.name)} vs ${slug(B.name)}`.slice(0, 95),
          type: ChannelType.GuildVoice,
          parent: t.matchCategoryId || null,
          userLimit: t.format === "2v2" ? 4 : 2,
          permissionOverwrites: vow,
          reason: "Vocal de match (tournoi)",
        });
        voiceId = vc.id;
      } catch {
        /* vocal optionnel */
      }
    }
    await setMatchChannel(guild.id, m.id, channel.id, voiceId);
    const fresh = await getTournament(guild.id);
    const sent = await channel.send(buildMatchPayload(fresh, m.id)).catch(() => null);
    if (sent) await setMatchMessage(guild.id, m.id, sent.id);
  }
}

async function tickMatchTimers(guild) {
  const t = await getTournament(guild.id);
  if (!t || t.status !== "running") return;
  const now = Date.now();
  for (const m of liveMatchesWithChannel(t)) {
    const elapsed = (now - (m.startedAt || now)) / 60000;
    const gamesPlayed = (m.scoreA || 0) + (m.scoreB || 0);

    if (m.status === "dispute") {
      if (!m.alerted) {
        await sendModAlert(guild, t, m.id, "Litige en cours");
        await markAlerted(guild.id, m.id);
      }
      continue;
    }
    // Aucune manche jouée après le délai → joueurs probablement inactifs : alerte staff.
    if (gamesPlayed === 0 && elapsed >= t.alertMinutes && !m.alerted) {
      await sendModAlert(guild, t, m.id, `Aucune manche jouée après ${Math.round(elapsed)} min — joueurs peut-être inactifs`);
      await markAlerted(guild.id, m.id);
    }
  }
}

async function cleanupMatchChannels(guild) {
  const t = await getTournament(guild.id);
  if (!t) return;
  for (const m of doneMatchesWithChannel(t)) {
    for (const id of [m.channelId, m.voiceChannelId]) {
      if (!id) continue;
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (ch) await ch.delete("Match terminé").catch(() => {});
    }
    await clearMatchChannel(guild.id, m.id);
  }
}

export async function tournamentTick(client, guild) {
  try {
    await ensureMatchChannels(client, guild);
    await tickMatchTimers(guild);
    await cleanupMatchChannels(guild);
  } catch (err) {
    console.warn("Tournoi tick :", err.message);
  }
}
