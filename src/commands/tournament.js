import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
} from "discord.js";
import {
  getTournament, updateTournament, resolveMatch, userEntrant, reportGame, matchBestOf,
  undoGame, disputeMatch, heldMatches, unlockMatch, setCastThreshold,
  registerEntrant, unregisterEntrant, checkInEntrant,
} from "../tournament.js";
import {
  buildSignupPayload, refreshSignupPanel, buildModAlert, buildMatchPayload,
  refreshMatchMessage, tournamentAnnounce, buildMatchResultEmbed,
} from "../tournamentUI.js";
import { renderBracketImage } from "../bracketImage.js";
import { EPHEMERAL, logAudit } from "./shared.js";

// ====================================================================
// Tournoi : panneau d'inscription + interactions des membres
// ====================================================================

export async function handleTournoiPanneau(interaction, ctx) {
  const t = await getTournament(interaction.guild.id);
  if (!t) {
    return interaction.reply({ content: "Aucun tournoi configuré. Crée-le d'abord dans le dashboard (section Tournoi).", flags: EPHEMERAL });
  }
  const msg = await interaction.channel.send(buildSignupPayload(t));
  await updateTournament(interaction.guild.id, { signupChannelId: interaction.channel.id, signupMessageId: msg.id });
  return interaction.reply({ content: "Panneau d'inscription publié ✅", flags: EPHEMERAL });
}

// ---------- /bracket : bracket en image ----------

export async function handleBracket(interaction, ctx) {
  await interaction.deferReply();
  const t = await getTournament(interaction.guild.id);
  if (!t || !t.rounds) {
    return interaction.editReply("Aucun bracket généré pour l'instant.");
  }
  // Vue "top N" : on calcule le round de départ pour ne dessiner que la fin du bracket.
  const vue = interaction.options.getString("vue") || "full";
  let fromRound = 0;
  let label = "bracket";
  if (vue !== "full") {
    const n = Number(vue);
    const log = Math.log2(n);
    if (Number.isInteger(log)) {
      fromRound = Math.max(0, t.rounds - log);
      if (fromRound > 0) label = `bracket (top ${n})`;
    }
  }
  try {
    const buffer = renderBracketImage(t, { fromRound });
    const file = new AttachmentBuilder(buffer, { name: "bracket.png" });
    return interaction.editReply({ content: `🏆 **${t.name}** — ${label}`, files: [file] });
  } catch (err) {
    return interaction.editReply(`Impossible de générer le bracket : ${err.message}`);
  }
}

// ---------- /caster : gestion des matchs verrouillés (cast gate) ----------

export async function handleCaster(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  let t = await getTournament(interaction.guild.id);
  if (!t) return interaction.editReply("Aucun tournoi en cours.");

  const top = interaction.options.getInteger("top");
  if (top !== null) {
    t = await setCastThreshold(interaction.guild.id, top);
    await logAudit(interaction.guild, `🎥 <@${interaction.user.id}> a réglé le cast gate sur ${top ? `top ${top}` : "désactivé"}.`);
  }

  const gateTxt = t.castFromTopN ? `**top ${t.castFromTopN}**` : "**désactivé**";
  const held = heldMatches(t);
  if (!held.length) {
    return interaction.editReply(
      `🎥 Cast gate : ${gateTxt}.\n` +
        (t.castFromTopN
          ? "Aucun match verrouillé prêt pour l'instant. Quand des matchs du palier seront prêts, ils apparaîtront ici à débloquer."
          : "Utilise l'option `top` pour verrouiller les matchs à partir d'un palier (ex: top 8)."),
    );
  }

  const nameOf = (id) => t.participants.find((p) => p.id === id)?.name ?? "?";
  // Boutons de déblocage (max 5 par ligne, 5 lignes = 25 matchs).
  const rows = [];
  for (let i = 0; i < held.length && rows.length < 5; i += 5) {
    rows.push({
      type: 1,
      components: held.slice(i, i + 5).map((m) => ({
        type: 2,
        style: 3,
        label: `▶ ${nameOf(m.aId)} vs ${nameOf(m.bId)}`.slice(0, 78),
        custom_id: `castgo:${m.id}`,
      })),
    });
  }
  return interaction.editReply({
    content: `🎥 Cast gate : ${gateTxt}. **${held.length}** match(s) verrouillé(s) prêt(s).\nClique pour lancer un match (le salon se crée et les joueurs peuvent jouer) :`,
    components: rows,
  });
}

export async function handleCastGo(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Réservé au staff.", flags: EPHEMERAL });
  }
  const matchId = interaction.customId.split(":")[1];
  try {
    const t = await unlockMatch(interaction.guild.id, matchId);
    const m = t.matches[matchId];
    const nameOf = (id) => t.participants.find((p) => p.id === id)?.name ?? "?";
    await logAudit(interaction.guild, `🎬 <@${interaction.user.id}> a lancé le match ${nameOf(m.aId)} vs ${nameOf(m.bId)} (cast).`);
    return interaction.reply({
      content: `🎬 Match **${nameOf(m.aId)} vs ${nameOf(m.bId)}** débloqué — le salon va se créer dans quelques secondes.`,
      flags: EPHEMERAL,
    });
  } catch (err) {
    return interaction.reply({ content: `Erreur : ${err.message}`, flags: EPHEMERAL });
  }
}

async function giveParticipantRoles(guild, t, userIds) {
  if (!t.participantRoleId) return;
  for (const uid of userIds) {
    const m = await guild.members.fetch(uid).catch(() => null);
    if (m) await m.roles.add(t.participantRoleId, "Inscription tournoi").catch(() => {});
  }
}

export async function handleTournamentButton(interaction, ctx) {
  const id = interaction.customId;
  const guildId = interaction.guild.id;

  // Report joueur : manche par manche (édite le scoreboard du salon).
  if (id.startsWith("trn_game:") || id.startsWith("trn_undo:") || id.startsWith("trn_dispute:") || id.startsWith("trn_gameok:") || id.startsWith("trn_disputeok:")) {
    const parts = id.split(":");
    const action = parts[0];
    const matchId = parts[1];
    const t = await getTournament(guildId);
    const m = t?.matches?.[matchId];
    if (!m) return interaction.reply({ content: "Match introuvable.", flags: EPHEMERAL });
    const entrant = userEntrant(t, interaction.user.id);
    const isPlayer = entrant && [m.aId, m.bId].includes(entrant.id);
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || (t.modRoleId && interaction.member?.roles?.cache?.has(t.modRoleId));
    if (!isPlayer && !isMod) return interaction.reply({ content: "Réservé aux joueurs de ce match.", flags: EPHEMERAL });

    const A = t.participants.find((p) => p.id === m.aId);
    const B = t.participants.find((p) => p.id === m.bId);
    const nameOf = (s) => (s === "a" ? A?.name : B?.name);

    try {
      // --- Étape 1 : clic sur un bouton risqué → demande de confirmation ---
      if (action === "trn_game") {
        const side = parts[2];
        const bo = matchBestOf(t, m);
        const need = Math.ceil(bo / 2);
        const cur = side === "a" ? m.scoreA + 1 : m.scoreB + 1;
        return interaction.reply({
          content: `⚠️ Confirmer : **match gagné par ${nameOf(side)}** → +1 point (${cur}/${need}) ?`,
          components: [{ type: 1, components: [{ type: 2, style: 3, label: "Oui, attribuer le point", custom_id: `trn_gameok:${matchId}:${side}` }] }],
          flags: EPHEMERAL,
        });
      }
      if (action === "trn_dispute") {
        return interaction.reply({
          content: "⚠️ Signaler un **litige** sur ce match ? Le staff sera alerté.",
          components: [{ type: 1, components: [{ type: 2, style: 4, label: "Oui, signaler", custom_id: `trn_disputeok:${matchId}` }] }],
          flags: EPHEMERAL,
        });
      }
      // --- Action directe : annuler le dernier point ---
      if (action === "trn_undo") {
        const t2 = await undoGame(guildId, matchId);
        return interaction.update(buildMatchPayload(t2, matchId));
      }
      // --- Étape 2 : confirmations ---
      if (action === "trn_gameok") {
        const r = await reportGame(guildId, matchId, parts[2]);
        await refreshMatchMessage(interaction.client, guildId, matchId);
        await refreshSignupPanel(interaction.client, guildId);
        if (r.finished) {
          const w = r.tournament.participants.find((p) => p.id === r.match.winnerId)?.name || "?";
          await tournamentAnnounce(interaction.client, guildId, undefined, [buildMatchResultEmbed(r.tournament, r.match)]);
          return interaction.update({ content: `🏆 Point attribué — **${w}** remporte le match !`, components: [] });
        }
        return interaction.update({ content: `✅ Point attribué (${r.match.scoreA}-${r.match.scoreB}).`, components: [] });
      }
      if (action === "trn_disputeok") {
        const t3 = await disputeMatch(guildId, matchId);
        if (t3.modAlertChannelId) {
          const ch = await interaction.guild.channels.fetch(t3.modAlertChannelId).catch(() => null);
          if (ch?.isTextBased?.()) await ch.send(buildModAlert(t3, matchId, `Litige signalé par ${interaction.user.username}`)).catch(() => {});
        }
        await refreshMatchMessage(interaction.client, guildId, matchId);
        return interaction.update({ content: "⚠️ Litige signalé, le staff a été prévenu.", components: [] });
      }
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
    }
  }

  // Décision modérateur (avec confirmation).
  if (id.startsWith("trn_modwin:") || id.startsWith("trn_modwinok:")) {
    const [, matchId, entrantId] = id.split(":");
    const tt = await getTournament(guildId);
    const isMod =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      (tt?.modRoleId && interaction.member?.roles?.cache?.has(tt.modRoleId));
    if (!isMod) return interaction.reply({ content: "Réservé au staff.", flags: EPHEMERAL });
    const name = tt?.participants.find((p) => p.id === entrantId)?.name || "?";

    if (id.startsWith("trn_modwin:")) {
      return interaction.reply({
        content: `⚠️ Donner la **victoire à ${name}** ? Cette décision fait avancer le bracket.`,
        components: [{ type: 1, components: [{ type: 2, style: 3, label: `Oui, victoire ${name}`.slice(0, 80), custom_id: `trn_modwinok:${matchId}:${entrantId}` }] }],
        flags: EPHEMERAL,
      });
    }
    try {
      const t = await resolveMatch(guildId, matchId, entrantId);
      await refreshSignupPanel(interaction.client, guildId);
      await refreshMatchMessage(interaction.client, guildId, matchId);
      await tournamentAnnounce(interaction.client, guildId, `🛠️ Décision staff — **${name}** est déclaré vainqueur du match.`);
      return interaction.update({ content: `✅ Victoire attribuée à **${name}**.`, components: [] });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
    }
  }

  const t = await getTournament(guildId);
  if (!t) return interaction.reply({ content: "Aucun tournoi en cours.", flags: EPHEMERAL });

  if (id === "trn_join") {
    if (t.status !== "registration") return interaction.reply({ content: "Les inscriptions ne sont pas ouvertes.", flags: EPHEMERAL });
    if (t.format === "2v2") {
      // Choix du coéquipier
      const select = new UserSelectMenuBuilder().setCustomId("trn_partner_select").setPlaceholder("Choisis ton coéquipier").setMinValues(1).setMaxValues(1);
      return interaction.reply({ content: "👥 Tournoi en 2v2 — choisis ton coéquipier :", components: [new ActionRowBuilder().addComponents(select)], flags: EPHEMERAL });
    }
    // Double confirmation de présence avant inscription.
    return interaction.reply({
      content: `🎮 **${t.name}**\nEs-tu sûr·e de vouloir t'inscrire et d'être **présent·e** le jour du tournoi ?`,
      components: [{ type: 1, components: [{ type: 2, style: 3, label: "Oui, je serai là — m'inscrire", emoji: { name: "✅" }, custom_id: "trn_joinok" }] }],
      flags: EPHEMERAL,
    });
  }

  if (id === "trn_joinok") {
    if (t.status !== "registration") return interaction.update({ content: "Les inscriptions ne sont pas ouvertes.", components: [] });
    try {
      await registerEntrant(guildId, { members: [interaction.user.id], name: interaction.member.displayName });
      await giveParticipantRoles(interaction.guild, t, [interaction.user.id]);
      await refreshSignupPanel(interaction.client, guildId);
      return interaction.update({ content: "✅ Inscription confirmée ! Bonne chance. 🍀", components: [] });
    } catch (e) {
      return interaction.update({ content: `❌ ${e.message}`, components: [] });
    }
  }

  if (id === "trn_leave") {
    try {
      await unregisterEntrant(guildId, interaction.user.id);
      if (t.participantRoleId) await interaction.member.roles.remove(t.participantRoleId).catch(() => {});
      await refreshSignupPanel(interaction.client, guildId);
      return interaction.reply({ content: "🚪 Tu es désinscrit·e.", flags: EPHEMERAL });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
    }
  }

  if (id === "trn_checkin") {
    try {
      await checkInEntrant(guildId, interaction.user.id);
      await refreshSignupPanel(interaction.client, guildId);
      return interaction.reply({ content: "📥 Check-in validé ! Tu es prêt·e.", flags: EPHEMERAL });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
    }
  }
}

export async function handleTournamentSelect(interaction, ctx) {
  if (interaction.customId === "trn_partner_select") {
    const partnerId = interaction.values[0];
    if (partnerId === interaction.user.id) {
      return interaction.reply({ content: "Tu ne peux pas être ton propre coéquipier.", flags: EPHEMERAL });
    }
    const modal = new ModalBuilder().setCustomId(`trn_team_modal:${partnerId}`).setTitle("Nom de l'équipe").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("team").setLabel("Nom de ton équipe").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
      ),
    );
    return interaction.showModal(modal);
  }
}

export async function handleTournamentModal(interaction, ctx) {
  if (interaction.customId.startsWith("trn_team_modal:")) {
    const partnerId = interaction.customId.split(":")[1];
    const guildId = interaction.guild.id;
    const t = await getTournament(guildId);
    if (!t) return interaction.reply({ content: "Aucun tournoi.", flags: EPHEMERAL });
    const teamName = interaction.fields.getTextInputValue("team")?.trim() || `Team ${interaction.member.displayName}`;
    try {
      await registerEntrant(guildId, { members: [interaction.user.id, partnerId], name: teamName });
      await giveParticipantRoles(interaction.guild, t, [interaction.user.id, partnerId]);
      await refreshSignupPanel(interaction.client, guildId);
      return interaction.reply({ content: `✅ Équipe **${teamName}** inscrite avec <@${partnerId}> !`, flags: EPHEMERAL });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
    }
  }
}
