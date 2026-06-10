import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { TIERS } from "./config.js";
import { getAllLinks } from "./store.js";
import { getSettings, setSetting } from "./settings.js";
import { seasonalRoleNames, updateTopServerRole } from "./roles.js";
import {
  handleTop,
  handleStats,
  handleRank,
  handleLegendes,
  handleEquipe,
  handleCarte,
  handleProgression,
  handleVersus,
  handleLeaderboard,
  handleProfilePick,
  handleProfileNav,
  handlePing,
  handleHelp,
} from "./commands/profile.js";
import {
  handleNiveau,
  handleClassementNiveaux,
  handleLeaderboardXp,
  handleLeaderboardXpPage,
  handleNiveauxConfig,
  handleNiveauxRecompense,
  handleNiveauxSet,
  handleNiveauxReset,
  handleNiveauxResync,
  handleLevelsResetAllConfirm,
  handleSetupLevels,
  handleLevelsPanelButton,
  handleLevelsPanelSelect,
  handleLevelsPanelModal,
} from "./commands/levels.js";
import {
  handleSetupTikTok,
  handleTikTokPanelButton,
  handleTikTokPanelSelect,
  handleTikTokPanelModal,
} from "./commands/panels/tiktok.js";
import {
  handleSetupClips,
  handleClipsPanelButton,
  handleClipsPanelSelect,
  handleClipsPanelModal,
} from "./commands/panels/clips.js";
import {
  handleSetupGuessRank,
  handleGuessRankPanelButton,
  handleGuessRankPanelSelect,
  handleGuessRankPanelModal,
} from "./commands/panels/guessrank.js";
import {
  handleSetupTempVoice,
  handleTempVoicePanelButton,
  handleTempVoicePanelSelect,
  handleTempVoicePanelModal,
  handleVoiceControlButton,
  handleVoiceControlSelect,
  handleVoiceControlModal,
} from "./commands/panels/tempvoice.js";
import {
  handleTournoiPanneau,
  handleBracket,
  handleCaster,
  handleCastGo,
  handleTournamentButton,
  handleTournamentSelect,
  handleTournamentModal,
} from "./commands/tournament.js";
import { setupRankVoiceChannels, rankVoiceSummary } from "./rankvoice.js";
import { loadCombos, weaponsWithCombos, buildComboViewer } from "./combos.js";
import { EPHEMERAL, logAudit, dmUser, doSync, requirePermission } from "./commands/shared.js";
import { enforceCooldown } from "./commands/cooldowns.js";
import { awardSeasonRewards } from "./season.js";
import { ACHIEVEMENTS, listUnlocked } from "./achievements.js";
import {
  handleLier,
  handlePick,
  handleApprove,
  handleReject,
  handleForcelink,
  handleForceLinkPick,
  handleUnlink,
  handleWhois,
  handleDelier,
} from "./commands/linking.js";

// Les definitions (JSON) des slash commands vivent dans ./commands/definitions.js.
// Re-export ici pour compatibilite (deploy-commands.js importe { commandsData } depuis ce fichier).
export { commandsData } from "./commands/definitions.js";

// Défense en profondeur : commandes exigeant une permission, revérifiée à l'exécution
// (en plus de setDefaultMemberPermissions qui ne filtre que côté client Discord).
// `bracket` est volontairement absent (commande publique d'affichage).
export const MANAGE_GUILD_COMMANDS = new Set([
  "whois", "forcelink", "unlink", "refresh", "reset-saison", "setup", "setup-succes",
  "niveaux-config", "niveaux-recompense", "niveaux-set", "niveaux-reset", "niveaux-resync",
  "setup-levels", "setup-tiktok", "setup-clips", "setup-tempvoice", "setup-vocaux-rank",
  "setup-guessrank", "tournoi-panneau", "caster",
]);
export const MANAGE_MESSAGES_COMMANDS = new Set(["clear"]);

export async function handleChatInput(interaction, ctx) {
  // Garde de permission centralisée (défense en profondeur) avant tout dispatch.
  if (MANAGE_GUILD_COMMANDS.has(interaction.commandName)) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
  } else if (MANAGE_MESSAGES_COMMANDS.has(interaction.commandName)) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages, "⛔ Permission « Gérer les messages » requise."))) return;
  }

  switch (interaction.commandName) {
    case "lier": return handleLier(interaction, ctx);
    case "delier": return handleDelier(interaction, ctx);
    case "top": return handleTop(interaction, ctx);
    case "ping": return handlePing(interaction, ctx);
    case "help": return handleHelp(interaction, ctx);
    case "achievements": return handleAchievements(interaction, ctx);
    case "combos": return handleCombos(interaction, ctx);
    case "stats": return handleStats(interaction, ctx);
    case "rank": return handleRank(interaction, ctx);
    case "legendes": return handleLegendes(interaction, ctx);
    case "equipe": return handleEquipe(interaction, ctx);
    case "progression": return handleProgression(interaction, ctx);
    case "versus": return handleVersus(interaction, ctx);
    case "carte": return handleCarte(interaction, ctx);
    case "leaderboard": return handleLeaderboard(interaction, ctx);
    case "whois": return handleWhois(interaction, ctx);
    case "forcelink": return handleForcelink(interaction, ctx);
    case "unlink": return handleUnlink(interaction, ctx);
    case "refresh": return handleRefresh(interaction, ctx);
    case "reset-saison": return handleResetSeason(interaction, ctx);
    case "setup": return handleSetup(interaction, ctx);
    case "setup-succes": return handleSetupSucces(interaction, ctx);
    case "clear": return handleClear(interaction, ctx);
    case "niveau": return handleNiveau(interaction, ctx);
    case "classement-niveaux": return handleClassementNiveaux(interaction, ctx);
    case "leaderboard-xp": return handleLeaderboardXp(interaction, ctx);
    case "niveaux-config": return handleNiveauxConfig(interaction, ctx);
    case "niveaux-recompense": return handleNiveauxRecompense(interaction, ctx);
    case "niveaux-set": return handleNiveauxSet(interaction, ctx);
    case "niveaux-reset": return handleNiveauxReset(interaction, ctx);
    case "niveaux-resync": return handleNiveauxResync(interaction, ctx);
    case "setup-levels": return handleSetupLevels(interaction, ctx);
    case "setup-tiktok": return handleSetupTikTok(interaction, ctx);
    case "setup-clips": return handleSetupClips(interaction, ctx);
    case "setup-tempvoice": return handleSetupTempVoice(interaction, ctx);
    case "setup-vocaux-rank": return handleSetupVocauxRank(interaction, ctx);
    case "setup-guessrank": return handleSetupGuessRank(interaction, ctx);
    case "tournoi-panneau": return handleTournoiPanneau(interaction, ctx);
    case "bracket": return handleBracket(interaction, ctx);
    case "caster": return handleCaster(interaction, ctx);
  }
}

export async function handleModal(interaction, ctx) {
  if (interaction.customId.startsWith("lvl_")) return handleLevelsPanelModal(interaction, ctx);
  if (interaction.customId.startsWith("tt_")) return handleTikTokPanelModal(interaction, ctx);
  if (interaction.customId.startsWith("clp_")) return handleClipsPanelModal(interaction, ctx);
  if (interaction.customId.startsWith("tv_")) return handleTempVoicePanelModal(interaction, ctx);
  if (interaction.customId.startsWith("vc_")) return handleVoiceControlModal(interaction, ctx);
  if (interaction.customId.startsWith("gr_")) return handleGuessRankPanelModal(interaction, ctx);
  if (interaction.customId.startsWith("trn_")) return handleTournamentModal(interaction, ctx);
  if (!interaction.customId.startsWith("rm:")) return;
  const [, requesterId, , channelId, messageId] = interaction.customId.split(":");
  const reason = interaction.fields.getTextInputValue("raison")?.trim() || "Non précisée";
  await interaction.deferReply({ flags: EPHEMERAL });

  // Met a jour le message de review d'origine.
  try {
    const ch = await interaction.guild.channels.fetch(channelId);
    const msg = await ch.messages.fetch(messageId);
    const embed = msg.embeds[0] ? EmbedBuilder.from(msg.embeds[0]) : new EmbedBuilder();
    embed.addFields({ name: "Résultat", value: `❌ Refusé par <@${interaction.user.id}> — ${reason}` });
    await msg.edit({ embeds: [embed], components: [] });
  } catch {
    /* message introuvable : on continue */
  }

  await dmUser(interaction.client, requesterId, `❌ Ta demande de liaison Brawlhalla a été refusée. Raison : ${reason}`);
  await logAudit(interaction.guild, `❌ <@${interaction.user.id}> a refusé <@${requesterId}> — ${reason}`);
  return interaction.editReply("Refus enregistré et membre notifié.");
}

// ---------- /setup-vocaux-rank ----------

async function handleSetupVocauxRank(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  const category = interaction.options.getChannel("categorie", true);
  const rangMin = interaction.options.getString("rang-min") ?? "Bronze";
  const limite = interaction.options.getInteger("limite") ?? 0;
  await interaction.deferReply({ flags: EPHEMERAL });

  if (category.type !== ChannelType.GuildCategory) {
    return interaction.editReply("Choisis une **catégorie** (pas un salon).");
  }

  try {
    const res = await setupRankVoiceChannels(interaction.guild, { categoryId: category.id, rangMin, limite });
    return interaction.editReply(
      rankVoiceSummary(res) +
        "\n\nAccès : seuls les rangs **égal ou supérieur** peuvent rejoindre. " +
        "Comme les rôles viennent de `/lier` (vérifié par l'API), personne ne peut tricher.",
    );
  } catch (err) {
    return interaction.editReply(`Erreur : ${err.message}`);
  }
}

// ---------- /clear ----------

async function handleClear(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: "Tu n'as pas la permission de supprimer des messages.", flags: EPHEMERAL });
  }
  if (!interaction.channel?.isTextBased?.()) {
    return interaction.reply({ content: "Cette commande s'utilise dans un salon textuel.", flags: EPHEMERAL });
  }

  const count = interaction.options.getInteger("nombre", true);
  const targetUser = interaction.options.getUser("membre");
  await interaction.deferReply({ flags: EPHEMERAL });

  // bulkDelete ne supprime pas les messages de plus de 14 jours.
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWO_WEEKS;

  // On récupère un peu plus de messages quand on filtre par membre.
  const fetchLimit = targetUser ? 100 : count;
  let messages;
  try {
    messages = await interaction.channel.messages.fetch({ limit: fetchLimit });
  } catch (err) {
    return interaction.editReply(`Impossible de récupérer les messages : ${err.message}`);
  }

  let toDelete = [...messages.values()].filter((m) => m.createdTimestamp > cutoff && !m.pinned);
  if (targetUser) toDelete = toDelete.filter((m) => m.author.id === targetUser.id);
  toDelete = toDelete.slice(0, count);

  if (toDelete.length === 0) {
    return interaction.editReply(
      "Aucun message à supprimer (les messages de plus de 14 jours ne peuvent pas être supprimés en masse).",
    );
  }

  let deleted;
  try {
    deleted = await interaction.channel.bulkDelete(toDelete, true);
  } catch (err) {
    return interaction.editReply(`Échec de la suppression : ${err.message}`);
  }

  const n = deleted.size ?? deleted.length ?? 0;
  await logAudit(
    interaction.guild,
    `🧹 <@${interaction.user.id}> a supprimé ${n} message(s) dans <#${interaction.channelId}>${targetUser ? ` (de <@${targetUser.id}>)` : ""}.`,
  );
  return interaction.editReply(
    `🧹 ${n} message(s) supprimé(s)${targetUser ? ` de <@${targetUser.id}>` : ""}.` +
      (n < count ? "\n(Certains messages étaient trop anciens — plus de 14 jours — pour être supprimés.)" : ""),
  );
}

// ---------- /combos ----------

async function handleCombos(interaction) {
  if (!(await enforceCooldown(interaction, "combos", 5000))) return;
  const combos = await loadCombos();
  if (!combos.length) {
    return interaction.reply({ content: "La base de combos est vide. Un admin doit la mettre à jour depuis le dashboard (section Combos) ou lancer `node scripts/scrape-combos.js`.", flags: EPHEMERAL });
  }
  const opt = interaction.options.getString("arme");
  const weapons = await weaponsWithCombos();
  const weapon = opt && weapons.includes(opt) ? opt : weapons[0];
  await interaction.deferReply({ flags: EPHEMERAL }); // affichage privé + le téléchargement vidéo peut dépasser 3s
  return interaction.editReply(await buildComboViewer(weapon));
}

// Panneau public : ouvre un affichage PRIVÉ par utilisateur (usage simultané sans conflit).
async function handleCombosOpen(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  return interaction.editReply(await buildComboViewer(interaction.values[0]));
}
// Dans l'affichage privé : changer d'arme.
async function handleCombosWeapon(interaction) {
  await interaction.deferUpdate();
  return interaction.editReply({ ...(await buildComboViewer(interaction.values[0])), attachments: [] });
}
// Dans l'affichage privé : choisir un combo par son nom.
async function handleCombosPick(interaction) {
  const weapon = interaction.customId.split(":")[1];
  await interaction.deferUpdate();
  return interaction.editReply({ ...(await buildComboViewer(weapon, interaction.values[0])), attachments: [] });
}

// ---------- /achievements ----------

async function handleAchievements(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "achievements", 4000))) return;
  await interaction.deferReply();
  const target = interaction.options.getUser("membre") ?? interaction.user;
  if (target.bot) return interaction.editReply("Les bots n'ont pas de succès. 🤖");

  const unlocked = listUnlocked(interaction.guild.id, target.id); // Map id -> ts
  const lines = ACHIEVEMENTS.map((a) => {
    const got = unlocked.has(a.id);
    return `${got ? "✅" : "🔒"} ${a.emoji} **${a.name}** — ${got ? a.desc : `*${a.desc}*`}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🏅 Succès — ${target.username}`)
    .setColor(0xffd700)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${unlocked.size}/${ACHIEVEMENTS.length} débloqués` });
  return interaction.editReply({ embeds: [embed] });
}

async function handleResetSeason(interaction, ctx) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("season_reset").setLabel("Confirmer le reset").setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    content:
      "⚠️ Cela va **retirer tous les rôles de rank** de tous les membres (les liaisons sont conservées). " +
      "Avant le reset, chaque membre lié reçoit un **badge permanent** de la saison (🏅 selon son meilleur tier). " +
      "Les rôles seront ré-attribués au fur et à mesure que les membres rejouent en ranked. Confirmer ?",
    components: [row],
    flags: EPHEMERAL,
  });
}

async function handleSeasonResetConfirm(interaction, ctx) {
  if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  await interaction.deferUpdate();
  const { season } = await getSettings();

  // 1) Badges PERMANENTS de la saison qui se termine (avant de retirer les rôles de rank).
  let award = { awarded: 0 };
  try {
    award = await awardSeasonRewards(interaction.guild, season);
  } catch {
    /* best-effort : on continue le reset même si l'attribution échoue */
  }

  // 2) Retrait des rôles saisonniers (tiers + Top).
  const managed = seasonalRoleNames();
  const members = await interaction.guild.members.fetch();
  let touched = 0;
  for (const member of members.values()) {
    const toRemove = member.roles.cache.filter((r) => managed.has(r.name));
    if (toRemove.size) {
      await member.roles.remove([...toRemove.values()], "Reset de saison Brawlhalla").catch(() => {});
      touched++;
    }
  }

  // 3) Incrémente le numéro de saison.
  await setSetting("season", season + 1);

  await logAudit(
    interaction.guild,
    `🔄 <@${interaction.user.id}> a clôturé la **saison ${season}** : ${award.awarded} badge(s) attribué(s), rôles retirés à ${touched} membre(s). Nouvelle saison : **${season + 1}**.`,
  );
  return interaction.editReply({
    content:
      `✅ Saison ${season} clôturée.\n` +
      `🏅 **${award.awarded}** badge(s) de saison attribué(s).\n` +
      `🧹 Rôles de rank retirés à **${touched}** membre(s).\n` +
      `▶️ Nouvelle saison : **${season + 1}**.`,
    components: [],
  });
}

// ---------- /refresh (admin) ----------

async function handleRefresh(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const links = await getAllLinks();
  const entries = Object.entries(links);
  let ok = 0;
  let fail = 0;
  for (const [discordId, { brawlhallaId }] of entries) {
    try {
      const member = await interaction.guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      await doSync(member, brawlhallaId, ctx);
      ok++;
    } catch {
      fail++;
    }
  }

  // Met a jour le role "n°1 du serveur" apres avoir rafraichi tous les ratings.
  try {
    await updateTopServerRole(interaction.guild);
  } catch {
    /* best-effort */
  }

  return interaction.editReply(`Rafraîchissement : ${ok} ok, ${fail} échec(s) sur ${entries.length}.`);
}

// ---------- /setup ----------

async function handleSetup(interaction, ctx) {
  const s = await getSettings();
  const channelTxt = s.reviewChannelId ? `<#${s.reviewChannelId}>` : "*(non défini → liaison directe)*";
  const roleTxt = s.reviewerRoleId ? `<@&${s.reviewerRoleId}>` : "*(rôle validateur auto / permission Gérer le serveur)*";
  const auditTxt = s.auditChannelId ? `<#${s.auditChannelId}>` : "*(aucun)*";
  const announceTxt = s.announceChannelId ? `<#${s.announceChannelId}>` : "*(aucun)*";

  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId("setup_channel").setPlaceholder("Salon de validation").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1),
  );
  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId("setup_role").setPlaceholder("Rôle validateur").setMinValues(1).setMaxValues(1),
  );
  const auditRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId("setup_audit").setPlaceholder("Salon d'audit (logs)").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1),
  );
  const announceRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId("setup_announce").setPlaceholder("Salon des annonces de montée").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1),
  );
  const thresholdRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup_threshold")
      .setPlaceholder(`Seuil d'auto-validation (actuel : ${s.autoApproveTier})`)
      .addOptions(
        TIERS.map((t) => ({
          label: `Auto jusqu'à ${t}`,
          value: t,
          description: `Valide auto <= ${t}, validation manuelle au-dessus`,
        })),
      ),
  );

  return interaction.reply({
    content:
      "**Configuration du bot**\n" +
      `• Salon de validation : ${channelTxt}\n` +
      `• Rôle validateur : ${roleTxt}\n` +
      `• Salon d'audit : ${auditTxt}\n` +
      `• Salon des annonces de montée : ${announceTxt}\n` +
      `• Salon des succès : ${s.achievementsChannelId ? `<#${s.achievementsChannelId}>` : "*(aucun → `/setup-succes`)*"}\n` +
      `• Seuil d'auto-validation : **${s.autoApproveTier}** (au-dessus = validation manuelle)\n\n` +
      "Modifie via les menus ci-dessous (appliqué immédiatement). Pour le salon des succès : `/setup-succes`.",
    components: [channelRow, roleRow, auditRow, announceRow, thresholdRow],
    flags: EPHEMERAL,
  });
}

// ---------- /setup-succes ----------

async function handleSetupSucces(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  const salon = interaction.options.getChannel("salon");
  await setSetting("achievementsChannelId", salon?.id ?? "");
  return interaction.reply({
    content: salon
      ? `Salon des succès : <#${salon.id}> ✅ — les déblocages y seront annoncés (sans ping).`
      : "Annonces de succès **désactivées**. ✅",
    flags: EPHEMERAL,
  });
}

export async function handleSelect(interaction, ctx) {
  if (interaction.customId === "cbp_open") return handleCombosOpen(interaction);
  if (interaction.customId === "cbp_weapon") return handleCombosWeapon(interaction);
  if (interaction.customId.startsWith("cbp_pick:")) return handleCombosPick(interaction);
  if (interaction.customId.startsWith("lvl_")) return handleLevelsPanelSelect(interaction, ctx);
  if (interaction.customId.startsWith("tt_")) return handleTikTokPanelSelect(interaction, ctx);
  if (interaction.customId.startsWith("clp_")) return handleClipsPanelSelect(interaction, ctx);
  if (interaction.customId.startsWith("tv_")) return handleTempVoicePanelSelect(interaction, ctx);
  if (interaction.customId.startsWith("vc_")) return handleVoiceControlSelect(interaction, ctx);
  if (interaction.customId.startsWith("gr_")) return handleGuessRankPanelSelect(interaction, ctx);
  if (interaction.customId.startsWith("trn_")) return handleTournamentSelect(interaction, ctx);
  switch (interaction.customId) {
    case "setup_channel":
      await setSetting("reviewChannelId", interaction.values[0]);
      return interaction.reply({ content: `Salon de validation : <#${interaction.values[0]}> ✅ (le bot doit pouvoir y écrire).`, flags: EPHEMERAL });
    case "setup_role":
      await setSetting("reviewerRoleId", interaction.values[0]);
      return interaction.reply({ content: `Rôle validateur : <@&${interaction.values[0]}> ✅`, flags: EPHEMERAL });
    case "setup_audit":
      await setSetting("auditChannelId", interaction.values[0]);
      return interaction.reply({ content: `Salon d'audit : <#${interaction.values[0]}> ✅`, flags: EPHEMERAL });
    case "setup_announce":
      await setSetting("announceChannelId", interaction.values[0]);
      return interaction.reply({ content: `Salon des annonces de montée : <#${interaction.values[0]}> ✅`, flags: EPHEMERAL });
    case "setup_threshold":
      await setSetting("autoApproveTier", interaction.values[0]);
      return interaction.reply({ content: `Seuil d'auto-validation : **${interaction.values[0]}** ✅`, flags: EPHEMERAL });
  }
}

// ---------- Routeur boutons ----------

export async function handleButton(interaction, ctx) {
  const id = interaction.customId;
  if (id.startsWith("lvl_")) return handleLevelsPanelButton(interaction, ctx);
  if (id.startsWith("tt_")) return handleTikTokPanelButton(interaction, ctx);
  if (id.startsWith("clp_")) return handleClipsPanelButton(interaction, ctx);
  if (id.startsWith("tv_")) return handleTempVoicePanelButton(interaction, ctx);
  if (id.startsWith("vc_")) return handleVoiceControlButton(interaction, ctx);
  if (id.startsWith("gr_")) return handleGuessRankPanelButton(interaction, ctx);
  if (id.startsWith("trn_")) return handleTournamentButton(interaction, ctx);
  if (id.startsWith("castgo:")) return handleCastGo(interaction, ctx);
  if (id.startsWith("pick:")) return handlePick(interaction, ctx);
  if (id.startsWith("profpick:")) return handleProfilePick(interaction);
  if (id.startsWith("prof:")) return handleProfileNav(interaction);
  if (id.startsWith("ap:")) return handleApprove(interaction, ctx);
  if (id.startsWith("rj:")) return handleReject(interaction, ctx);
  if (id.startsWith("fl:")) return handleForceLinkPick(interaction, ctx);
  if (id === "season_reset") return handleSeasonResetConfirm(interaction, ctx);
  if (id === "levels_reset_all") return handleLevelsResetAllConfirm(interaction, ctx);
  if (id.startsWith("xplb:")) return handleLeaderboardXpPage(interaction, ctx);
}
