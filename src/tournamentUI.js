import { getTournament, tournamentWinner, matchBestOf, tournamentPodium } from "./tournament.js";
import { config } from "./config.js";

const STATUS_LABEL = {
  draft: "🔧 Brouillon",
  registration: "🟢 Inscriptions ouvertes",
  checkin: "✅ Check-in en cours",
  running: "⚔️ En cours",
  completed: "🏆 Terminé",
};

// Panneau d'inscription (embed + boutons) en JSON brut.
export function buildSignupPayload(t) {
  const showCheck = t.checkInEnabled && (t.status === "checkin" || t.status === "running");
  const list =
    t.participants
      .map((p, i) => `\`${String(i + 1).padStart(2, " ")}.\` ${p.name}${showCheck ? (p.checkedIn ? " ✅" : " ⌛") : ""}`)
      .join("\n") || "*Personne inscrit·e pour l'instant.*";

  const fields = [
    { name: "Format", value: t.format, inline: true },
    { name: "Région", value: t.region || "—", inline: true },
    { name: "Places", value: `${t.participants.length}/${t.maxParticipants}`, inline: true },
    { name: "Matchs", value: `BO${t.bestOf} · finale BO${t.finalsBestOf}`, inline: true },
    { name: "Statut", value: STATUS_LABEL[t.status] || t.status, inline: true },
  ];
  if (t.startTime) fields.push({ name: "Début", value: t.startTime, inline: true });

  let desc = "";
  if (t.rulesText) desc += `📋 **Règles** — ${t.rulesText}\n`;
  if (t.prizeText) desc += `🎁 **Récompenses** — ${t.prizeText}\n`;
  if (t.mapPool) desc += `🗺️ **Maps** — ${t.mapPool}\n`;
  desc += `\n**Participants (${t.participants.length})**\n${list}`;

  const win = tournamentWinner(t);
  if (win) desc += `\n\n🏆 **Vainqueur : ${win.name}** 🎉`;

  const embed = { title: `🏆 ${t.name}`, description: desc.slice(0, 4096), color: 0xf1c40f, fields };

  const buttons = [];
  if (t.status === "registration") {
    buttons.push({ type: 2, style: 3, label: "S'inscrire", emoji: { name: "✅" }, custom_id: "trn_join" });
    buttons.push({ type: 2, style: 4, label: "Se désinscrire", emoji: { name: "🚪" }, custom_id: "trn_leave" });
  } else if (t.status === "checkin") {
    buttons.push({ type: 2, style: 1, label: "Check-in", emoji: { name: "📥" }, custom_id: "trn_checkin" });
    buttons.push({ type: 2, style: 4, label: "Se désinscrire", emoji: { name: "🚪" }, custom_id: "trn_leave" });
  }
  return { embeds: [embed], components: buttons.length ? [{ type: 1, components: buttons }] : [] };
}

// Embed "aucun tournoi en cours" — posté dans le salon d'inscription quand
// un tournoi est archivé/supprimé, pour que les membres ne soient pas perdus.
export function buildNoTournamentPayload() {
  const embed = {
    title: "🏆 Aucun tournoi en cours",
    color: 0x5a606b,
    description:
      "Il n'y a pas de tournoi pour le moment.\n\n" +
      "Reste à l'affût : le prochain sera annoncé **ici même**. " +
      "Prends le rôle **🏆 Tournoi** pour être prévenu·e dès l'ouverture des inscriptions !",
    footer: { text: "Brawlhalla · à très vite sur le ring ⚔️" },
  };
  return { embeds: [embed] };
}

// Poste l'embed "aucun tournoi" dans le salon d'inscription (best-effort).
export async function postNoTournamentPanel(client, channelId) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch?.isTextBased?.()) await ch.send(buildNoTournamentPayload());
  } catch {
    /* ignore */
  }
}

// Rafraîchit le message du panneau d'inscription si publié.
export async function refreshSignupPanel(client, guildId) {
  const t = await getTournament(guildId);
  if (!t || !t.signupChannelId || !t.signupMessageId) return;
  try {
    const ch = await client.channels.fetch(t.signupChannelId);
    const msg = await ch.messages.fetch(t.signupMessageId);
    await msg.edit(buildSignupPayload(t));
  } catch {
    /* message supprimé : on ignore */
  }
}

// Annonce dans le salon d'annonces du tournoi (ou le salon d'inscription).
export async function tournamentAnnounce(client, guildId, content, embeds) {
  const t = await getTournament(guildId);
  if (!t) return;
  const chId = t.announceChannelId || t.signupChannelId;
  if (!chId) return;
  try {
    const ch = await client.channels.fetch(chId);
    if (ch?.isTextBased?.()) await ch.send({ content, embeds, allowedMentions: { parse: ["users"] } });
  } catch {
    /* ignore */
  }
}

// Envoi d'un payload complet (embed + bouton + ping) dans le salon d'annonces.
export async function tournamentAnnouncePayload(client, guildId, payload) {
  const t = await getTournament(guildId);
  if (!t) return;
  const chId = t.announceChannelId || t.signupChannelId;
  if (!chId) return;
  try {
    const ch = await client.channels.fetch(chId);
    if (ch?.isTextBased?.()) await ch.send(payload);
  } catch {
    /* ignore */
  }
}

// Belle annonce d'ouverture des inscriptions (embed épuré + bouton vers le salon d'inscription).
export function buildRegistrationAnnounce(t) {
  const ping = t.pingRoleId ? `<@&${t.pingRoleId}>` : "";
  const fields = [
    { name: "🎮 Format", value: `${t.format} · BO${t.bestOf}`, inline: true },
    { name: "🌍 Région", value: t.region || "—", inline: true },
    { name: "👥 Places", value: `${t.maxParticipants}`, inline: true },
  ];
  if (t.startTime) fields.push({ name: "🕒 Début", value: t.startTime, inline: true });
  if (t.prizeText) fields.push({ name: "🎁 Récompenses", value: t.prizeText, inline: true });

  const embed = {
    title: `🏆 ${t.name}`,
    description: "**Les inscriptions sont ouvertes !**\nClique sur le bouton ci-dessous pour rejoindre le tournoi.",
    color: 0xf1c40f,
    fields,
    footer: { text: "Brawlhalla · place limitée, dépêche-toi !" },
    timestamp: new Date().toISOString(),
  };

  const components = [];
  if (t.signupChannelId) {
    components.push({
      type: 1,
      components: [{ type: 2, style: 5, label: "S'inscrire", emoji: { name: "📋" }, url: `https://discord.com/channels/${config.guildId}/${t.signupChannelId}` }],
    });
  }
  return { content: ping || undefined, embeds: [embed], components, allowedMentions: { roles: t.pingRoleId ? [t.pingRoleId] : [] } };
}

// Annonce d'ouverture du check-in (embed + bouton vers le salon d'inscription, ping des inscrits).
export function buildCheckinAnnounce(t) {
  const pingId = t.participantRoleId || t.pingRoleId || null;
  const ping = pingId ? `<@&${pingId}>` : "";
  const fields = [
    { name: "🎮 Format", value: `${t.format} · BO${t.bestOf}`, inline: true },
    { name: "👥 Inscrits", value: `${t.participants.length}/${t.maxParticipants}`, inline: true },
  ];
  if (t.startTime) fields.push({ name: "🕒 Début", value: t.startTime, inline: true });

  const embed = {
    title: `✅ ${t.name} — Check-in ouvert`,
    description:
      "Le tournoi commence bientôt ! **Confirme ta présence** sur le panneau d'inscription.\n" +
      "⚠️ Sans check-in, ta place pourra être libérée.",
    color: 0x2ecc71,
    fields,
    footer: { text: "Brawlhalla · clique pour faire ton check-in" },
    timestamp: new Date().toISOString(),
  };

  const components = [];
  if (t.signupChannelId) {
    components.push({
      type: 1,
      components: [{ type: 2, style: 5, label: "Faire mon check-in", emoji: { name: "✅" }, url: `https://discord.com/channels/${config.guildId}/${t.signupChannelId}` }],
    });
  }
  return { content: ping || undefined, embeds: [embed], components, allowedMentions: { roles: pingId ? [pingId] : [] } };
}

// Embed de fin de match (annoncé dans le salon d'annonces du tournoi).
export function buildMatchResultEmbed(t, m) {
  const A = t.participants.find((p) => p.id === m.aId);
  const B = t.participants.find((p) => p.id === m.bId);
  const winner = m.winnerId === m.aId ? A : B;
  const loser = m.winnerId === m.aId ? B : A;
  const ws = Math.max(m.scoreA, m.scoreB);
  const ls = Math.min(m.scoreA, m.scoreB);
  const roundName = (r) => {
    const fe = t.rounds - 1 - r;
    if (fe === 0) return "🏆 Finale";
    if (fe === 1) return "🥈 Demi-finale";
    if (fe === 2) return "Quart de finale";
    return `Round ${r + 1}`;
  };
  return {
    title: "✅ Match terminé",
    color: 0x2ecc71,
    description: `🏆 **${winner?.name ?? "?"}** l'emporte **${ws}-${ls}** face à **${loser?.name ?? "?"}**.`,
    fields: [{ name: "Tour", value: roundName(m.round), inline: true }],
    footer: { text: t.name },
    timestamp: new Date().toISOString(),
  };
}

// Annonce de lancement du bracket (embed + bouton + ping des inscrits).
export function buildBracketAnnounce(t) {
  const pingId = t.participantRoleId || t.pingRoleId || null;
  const ping = pingId ? `<@&${pingId}>` : "";
  const embed = {
    title: `⚔️ ${t.name} — Le bracket est lancé !`,
    description: "Les matchs sont prêts. Retrouve ton adversaire et joue ta place !\n\n" + bracketSummary(t),
    color: 0x7c5cff,
    fields: [
      { name: "🎮 Format", value: `${t.format} · BO${t.bestOf}`, inline: true },
      { name: "👥 Joueurs", value: `${t.participants.length}`, inline: true },
    ],
    footer: { text: "Brawlhalla · que le meilleur gagne ⚔️" },
    timestamp: new Date().toISOString(),
  };
  const components = [];
  if (t.signupChannelId) {
    components.push({
      type: 1,
      components: [{ type: 2, style: 5, label: "Voir le tournoi", emoji: { name: "🗺️" }, url: `https://discord.com/channels/${config.guildId}/${t.signupChannelId}` }],
    });
  }
  return { content: ping || undefined, embeds: [embed], components, allowedMentions: { roles: pingId ? [pingId] : [] } };
}

// Résumé du bracket pour annonce (texte par round).
export function bracketSummary(t) {  if (!t.rounds) return "Bracket non généré.";
  const nameOf = (id) => (id ? t.participants.find((p) => p.id === id)?.name || "?" : "—");
  const roundName = (r) => {
    const fromEnd = t.rounds - 1 - r;
    if (fromEnd === 0) return "🏆 Finale";
    if (fromEnd === 1) return "🥈 Demi-finales";
    if (fromEnd === 2) return "Quarts de finale";
    return `Round ${r + 1}`;
  };
  let out = "";
  for (let r = 0; r < t.rounds; r++) {
    const ms = Object.values(t.matches).filter((m) => m.round === r).sort((a, b) => a.index - b.index);
    out += `\n**${roundName(r)}**\n`;
    for (const m of ms) {
      const a = nameOf(m.aId), b = nameOf(m.bId);
      const score = m.status === "done" ? ` — ${m.scoreA}:${m.scoreB}` : "";
      const mark = m.winnerId ? ` (✅ ${nameOf(m.winnerId)})` : "";
      out += `• ${a} vs ${b}${score}${mark}\n`;
    }
  }
  return out.slice(0, 4000);
}

// Message posté dans le salon de match : scoreboard live + boutons manche par manche.
export function buildMatchPayload(t, matchId) {
  const m = t.matches[matchId];
  const A = t.participants.find((p) => p.id === m.aId);
  const B = t.participants.find((p) => p.id === m.bId);
  const host = t.participants.indexOf(A) <= t.participants.indexOf(B) ? A : B;
  const bo = matchBestOf(t, m);
  const wins = Math.ceil(bo / 2);
  const mentions = [...A.members, ...B.members];
  const done = m.status === "done";
  const winName = done ? t.participants.find((p) => p.id === m.winnerId)?.name : null;

  const scoreLine = `**${A.name}**  \`${m.scoreA}\`  —  \`${m.scoreB}\`  **${B.name}**`;
  let desc = `**BO${bo}** — premier à **${wins}** point(s)\n`;
  if (t.mapPool) desc += `🗺️ ${t.mapPool}\n`;
  if (t.rulesText) desc += `📋 ${t.rulesText}\n`;
  desc += `\n🏠 **${host.name}** (meilleur seed) crée la salle privée — région **${t.region}**.\n\n`;
  desc += `${scoreLine}\n`;
  desc += done
    ? `\n🏆 **${winName} remporte le match !**`
    : `\nAprès **chaque match gagné**, le vainqueur (ou son adversaire) clique sur le bouton pour lui attribuer **+1 point**. Le bot déclare le gagnant automatiquement à **${wins} points**.`;

  const embed = {
    title: `⚔️ ${A.name} vs ${B.name}`,
    color: done ? 0x2ecc71 : m.status === "dispute" ? 0xff4d5e : 0x4ea1ff,
    description: desc,
    footer: { text: done ? "Match terminé — salon fermé sous peu." : "1 match gagné = 1 point · ↩️ pour corriger · ⚠️ Litige si désaccord" },
  };

  const components = done
    ? []
    : [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: `Point ${A.name}`.slice(0, 78), custom_id: `trn_game:${matchId}:a` },
            { type: 2, style: 1, label: `Point ${B.name}`.slice(0, 78), custom_id: `trn_game:${matchId}:b` },
            { type: 2, style: 2, label: "Annuler", emoji: { name: "↩️" }, custom_id: `trn_undo:${matchId}` },
            { type: 2, style: 4, label: "Litige", emoji: { name: "⚠️" }, custom_id: `trn_dispute:${matchId}` },
          ],
        },
      ];

  return { content: done ? undefined : mentions.map((id) => `<@${id}>`).join(" "), embeds: [embed], components, allowedMentions: { users: mentions } };
}

// Alerte modérateur (litige / inactivité).
export function buildModAlert(t, matchId, reason) {
  const m = t.matches[matchId];
  const A = t.participants.find((p) => p.id === m.aId);
  const B = t.participants.find((p) => p.id === m.bId);
  const ra = m.reports?.[m.aId];
  const rb = m.reports?.[m.bId];
  const fmt = (r) => (r ? `${r.a}-${r.b}` : "—");
  const ping = t.modRoleId ? `<@&${t.modRoleId}> ` : "";

  const embed = {
    title: "🚨 Litige / Match bloqué",
    color: 0xff4d5e,
    description: `**${A.name}** vs **${B.name}**\n**Raison** : ${reason}\n**Scores déclarés** — ${A.name} : ${fmt(ra)} · ${B.name} : ${fmt(rb)}`,
  };
  const row = {
    type: 1,
    components: [
      { type: 2, style: 3, label: `Victoire ${A.name}`.slice(0, 80), custom_id: `trn_modwin:${matchId}:${m.aId}` },
      { type: 2, style: 3, label: `Victoire ${B.name}`.slice(0, 80), custom_id: `trn_modwin:${matchId}:${m.bId}` },
    ],
  };
  if (m.channelId) {
    row.components.push({ type: 2, style: 5, label: "Ouvrir le salon", url: `https://discord.com/channels/${config.guildId}/${m.channelId}` });
  }
  return { content: ping || undefined, embeds: [embed], components: [row], allowedMentions: { roles: t.modRoleId ? [t.modRoleId] : [] } };
}

// Met à jour le scoreboard du salon de match.
export async function refreshMatchMessage(client, guildId, matchId) {
  const t = await getTournament(guildId);
  const m = t?.matches?.[matchId];
  if (!m || !m.channelId || !m.messageId) return;
  try {
    const ch = await client.channels.fetch(m.channelId);
    const msg = await ch.messages.fetch(m.messageId);
    await msg.edit(buildMatchPayload(t, matchId));
  } catch {
    /* message introuvable */
  }
}

// Embed "Hall of Fame" : podium + MVP, pour l'archivage d'un tournoi.
export function buildHallOfFamePayload(t) {
  const podium = tournamentPodium(t) || {};
  const medal = (p, emoji) => (p ? `${emoji} **${p.name}**` : null);

  const lines = [];
  if (podium.first) lines.push(`🥇 **${podium.first.name}** — Champion !`);
  if (podium.second) lines.push(`🥈 ${podium.second.name}`);
  if (podium.thirds?.length) lines.push(`🥉 ${podium.thirds.map((p) => p.name).join(" · ")}`);

  const fields = [
    { name: "🎮 Format", value: `${t.format} · BO${t.bestOf}`, inline: true },
    { name: "👥 Participants", value: `${t.participants.length}`, inline: true },
    { name: "🌍 Région", value: t.region || "—", inline: true },
  ];
  if (podium.mvp) {
    fields.push({ name: "⭐ MVP", value: `**${podium.mvp.name}** — ${podium.mostWins} manche(s) gagnée(s)`, inline: false });
  }

  const embed = {
    title: `🏛️ Hall of Fame — ${t.name}`,
    color: 0xffd700,
    description: lines.join("\n") || "Tournoi terminé.",
    fields,
    footer: { text: "Brawlhalla · GG à toutes et tous 🎉" },
    timestamp: new Date().toISOString(),
  };
  const ping = t.pingRoleId ? `<@&${t.pingRoleId}>` : undefined;
  return { content: ping, embeds: [embed], allowedMentions: { roles: t.pingRoleId ? [t.pingRoleId] : [] } };
}
