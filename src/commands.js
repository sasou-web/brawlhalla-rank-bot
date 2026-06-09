import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { TIERS, tierIndex, highestTier, tierEmojiText, tierEmojiResolvable, roleName, TOP_ROLE_NAME } from "./config.js";
import {
  searchPlayers,
  getPlayerProfile,
  getRankings,
  getLegends,
  estimateGlory,
  tierFromRating,
  pingApi,
} from "./brawlhalla.js";
import {
  setLink,
  removeLink,
  getLink,
  getAllLinks,
  findUserByBrawlhallaId,
} from "./store.js";
import { getSettings, setSetting } from "./settings.js";
import { syncMember } from "./sync.js";
import { managedRoleNames, seasonalRoleNames, updateTopServerRole } from "./roles.js";
import { getRatingHistory } from "./ratingStore.js";
import { renderProfileCard } from "./profileCard.js";
import { renderLevelCard } from "./levelCard.js";
import {
  getUserStats,
  getLeaderboard,
  getLevelConfig,
  setLevelConfig,
  setReward,
  setUserLevel,
  addUserXp,
  resetLevels,
  rewardRolePlan,
} from "./levels.js";
import { getTikTokConfig, setTikTokConfig, postTest as tiktokPostTest, fetchFeedItems } from "./tiktok.js";
import { getClipsConfig, setClipsConfig, parseReactions, parseDomains } from "./clips.js";
import { getGuessRankConfig, setGuessRankConfig } from "./guessrank.js";
import { getTempConfig, setTempConfig, addHub, removeHub, getTempOwner, setTempOwner } from "./tempvoice.js";
import {
  getTournament,
  registerEntrant,
  unregisterEntrant,
  checkInEntrant,
  updateTournament,
  resolveMatch,
  userEntrant,
  reportGame,
  matchBestOf,
  undoGame,
  disputeMatch,
  heldMatches,
  unlockMatch,
  setCastThreshold,
} from "./tournament.js";
import { buildSignupPayload, refreshSignupPanel, buildModAlert, buildMatchPayload, refreshMatchMessage, tournamentAnnounce } from "./tournamentUI.js";
import { setupRankVoiceChannels, rankVoiceSummary } from "./rankvoice.js";
import { renderBracketImage } from "./bracketImage.js";

const EPHEMERAL = MessageFlags.Ephemeral;
const LIER_COOLDOWN_MS = 30_000;
const lierCooldowns = new Map(); // userId -> timestamp

export const commandsData = [
  new SlashCommandBuilder()
    .setName("lier")
    .setDescription("Lie ton compte Brawlhalla pour recevoir tes roles de rank.")
    .addStringOption((o) => o.setName("pseudo").setDescription("Ton pseudo Brawlhalla en ranked.").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("delier")
    .setDescription("Supprime la liaison de ton compte Brawlhalla et retire tes roles.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Classement 1v1 des membres lies du serveur.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifie l'état de l'API Brawlhalla et la latence du bot.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Fiche joueur Brawlhalla (vue d'ensemble · onglets : Ranked, Légendes, Équipes).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Fiche joueur, onglet Ranked (1v1 + 2v2 détaillés).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("legendes")
    .setDescription("Fiche joueur, onglet Légendes (top jouées).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("equipe")
    .setDescription("Fiche joueur, onglet Équipes 2v2.")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("progression")
    .setDescription("Courbe d'évolution du rating (1v1 et 2v2) au fil du temps.")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("carte")
    .setDescription("Carte profil Brawlhalla en image (rank, winrate, main, Glory).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre lié (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo").setDescription("Ou un pseudo Brawlhalla.").setRequired(false))
    .addIntegerOption((o) => o.setName("id").setDescription("Ou un Brawlhalla ID (le plus fiable).").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("versus")
    .setDescription("Compare deux joueurs Brawlhalla (rank, winrate, niveau, Glory).")
    .addUserOption((o) => o.setName("membre1").setDescription("Premier membre (defaut : toi).").setRequired(false))
    .addStringOption((o) => o.setName("pseudo1").setDescription("Ou pseudo du 1er joueur.").setRequired(false))
    .addIntegerOption((o) => o.setName("id1").setDescription("Ou Brawlhalla ID du 1er joueur.").setMinValue(1).setRequired(false))
    .addUserOption((o) => o.setName("membre2").setDescription("Second membre.").setRequired(false))
    .addStringOption((o) => o.setName("pseudo2").setDescription("Ou pseudo du 2e joueur.").setRequired(false))
    .addIntegerOption((o) => o.setName("id2").setDescription("Ou Brawlhalla ID du 2e joueur.").setMinValue(1).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top 10 du classement Brawlhalla.")
    .addStringOption((o) =>
      o.setName("mode").setDescription("1v1 ou 2v2").addChoices({ name: "1v1", value: "1v1" }, { name: "2v2", value: "2v2" }),
    )
    .addStringOption((o) =>
      o
        .setName("region")
        .setDescription("Région (defaut : toutes)")
        .addChoices(
          { name: "Toutes", value: "ALL" },
          { name: "US-E", value: "US-E" },
          { name: "EU", value: "EU" },
          { name: "SEA", value: "SEA" },
          { name: "BRZ", value: "BRZ" },
          { name: "AUS", value: "AUS" },
          { name: "US-W", value: "US-W" },
          { name: "JPN", value: "JPN" },
          { name: "SA", value: "SA" },
          { name: "ME", value: "ME" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("whois")
    .setDescription("(Staff) Affiche le compte Brawlhalla lie a un membre.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Le membre a inspecter.").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("forcelink")
    .setDescription("(Admin) Lie un membre a un compte Brawlhalla sans validation.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Le membre a lier.").setRequired(true))
    .addStringOption((o) => o.setName("pseudo").setDescription("Pseudo Brawlhalla.").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("(Admin) Supprime la liaison d'un autre membre.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Le membre a delier.").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("(Admin) Rafraichit les roles de rank de tous les membres lies.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("reset-saison")
    .setDescription("(Admin) Retire tous les roles de rank de tous les membres (fin de saison).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Configure salon de validation, role validateur, audit et seuil auto.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("(Staff) Supprime rapidement un nombre de messages dans ce salon.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o
        .setName("nombre")
        .setDescription("Nombre de messages à supprimer (1 à 100).")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    )
    .addUserOption((o) => o.setName("membre").setDescription("Ne supprimer que les messages de ce membre.").setRequired(false))
    .toJSON(),
  // ---------- Systeme de niveaux ----------
  new SlashCommandBuilder()
    .setName("niveau")
    .setDescription("Affiche ton niveau et ton XP (ou ceux d'un membre).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre a inspecter (defaut : toi).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("classement-niveaux")
    .setDescription("Top 10 des membres par XP sur le serveur.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leaderboard-xp")
    .setDescription("Classement XP complet du serveur, avec pages.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("niveaux-config")
    .setDescription("(Admin) Configure le systeme de niveaux.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName("active").setDescription("Activer/desactiver le gain d'XP.").setRequired(false))
    .addChannelOption((o) =>
      o
        .setName("salon-annonce")
        .setDescription("Salon des annonces de level-up (vide = salon du message).")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addIntegerOption((o) => o.setName("cooldown").setDescription("Secondes entre deux gains d'XP (defaut 60).").setMinValue(0).setRequired(false))
    .addIntegerOption((o) => o.setName("xp-min").setDescription("XP minimum par message (defaut 15).").setMinValue(1).setRequired(false))
    .addIntegerOption((o) => o.setName("xp-max").setDescription("XP maximum par message (defaut 25).").setMinValue(1).setRequired(false))
    .addBooleanOption((o) => o.setName("vocal-actif").setDescription("Activer/desactiver le gain d'XP en vocal.").setRequired(false))
    .addIntegerOption((o) => o.setName("vocal-xp").setDescription("XP gagnee par minute en vocal (defaut 10).").setMinValue(0).setRequired(false))
    .addStringOption((o) =>
      o
        .setName("annonce")
        .setDescription("Ou annoncer les montees de niveau.")
        .addChoices(
          { name: "Salon (dédié ou courant)", value: "channel" },
          { name: "Message privé", value: "dm" },
          { name: "Désactivé", value: "off" },
        )
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o.setName("cumul-roles").setDescription("Cumuler les rôles de palier (oui) ou garder seulement le plus haut (non).").setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("niveaux-recompense")
    .setDescription("(Admin) Attribue/retire un role de recompense pour un niveau.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName("niveau").setDescription("Niveau a partir duquel le role est donne.").setMinValue(1).setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role a donner (laisse vide pour retirer la recompense).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("niveaux-set")
    .setDescription("(Admin) Definit le niveau ou ajoute de l'XP a un membre.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Le membre concerne.").setRequired(true))
    .addIntegerOption((o) => o.setName("niveau").setDescription("Definit ce niveau exact.").setMinValue(0).setRequired(false))
    .addIntegerOption((o) => o.setName("xp").setDescription("Ajoute (ou retire si negatif) cette quantite d'XP.").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("niveaux-reset")
    .setDescription("(Admin) Remet a zero l'XP d'un membre, ou de tout le serveur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Membre a reset (vide = tout le serveur).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("niveaux-resync")
    .setDescription("(Admin) Réaligne les rôles de récompense de tous les membres sur leur niveau.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName("membre").setDescription("Membre a resync (vide = tous les membres lies).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-levels")
    .setDescription("(Admin) Panneau de configuration du système de niveaux.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-tiktok")
    .setDescription("(Admin) Panneau des notifications TikTok automatiques.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-clips")
    .setDescription("(Admin) Panneau des réactions automatiques sur les salons de clips.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-tempvoice")
    .setDescription("(Admin) Panneau des salons vocaux temporaires (rejoindre pour créer).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-vocaux-rank")
    .setDescription("(Admin) Crée des salons vocaux réservés par rank (accès vérifié, impossible de mytho).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName("categorie")
        .setDescription("Catégorie où créer les vocaux de rank.")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("rang-min")
        .setDescription("Rang le plus bas à créer (défaut : Bronze).")
        .addChoices(...TIERS.map((t) => ({ name: t, value: t })))
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o.setName("limite").setDescription("Nombre max de membres par vocal (0 = illimité).").setMinValue(0).setMaxValue(99).setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setup-guessrank")
    .setDescription("(Admin) Panneau « devine ton rang » : réactions emojis de rank sur les clips.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("tournoi-panneau")
    .setDescription("(Admin) Publie le panneau d'inscription du tournoi dans ce salon.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("bracket")
    .setDescription("Affiche le bracket du tournoi en cours (image).")
    .addStringOption((o) =>
      o
        .setName("vue")
        .setDescription("Portion du bracket (utile pour les gros tournois).")
        .addChoices(
          { name: "Complet", value: "full" },
          { name: "À partir du top 16", value: "16" },
          { name: "À partir du top 8", value: "8" },
          { name: "À partir du top 4", value: "4" },
        )
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("caster")
    .setDescription("(Staff) Gère les matchs verrouillés à caster (top N) : déblocage manuel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) =>
      o
        .setName("top")
        .setDescription("Verrouille les matchs à partir de ce top (8 = top 8). 0 = désactiver.")
        .addChoices(
          { name: "Désactiver", value: 0 },
          { name: "Top 4", value: 4 },
          { name: "Top 8", value: 8 },
          { name: "Top 16", value: 16 },
          { name: "Top 32", value: 32 },
        )
        .setRequired(false),
    )
    .toJSON(),
];

export async function handleChatInput(interaction, ctx) {
  switch (interaction.commandName) {
    case "lier": return handleLier(interaction, ctx);
    case "delier": return handleDelier(interaction, ctx);
    case "top": return handleTop(interaction, ctx);
    case "ping": return handlePing(interaction, ctx);
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

// ---------- Helpers ----------

function tierSummary(tiers) {
  const parts = [];
  if (tiers?.["1v1"]) parts.push(`1v1 ${tierEmoji(tiers["1v1"])} **${tiers["1v1"]}**`);
  if (tiers?.["2v2"]) parts.push(`2v2 ${tierEmoji(tiers["2v2"])} **${tiers["2v2"]}**`);
  return parts.length ? parts.join(" · ") : "aucun rank classé";
}

async function logAudit(guild, text) {
  try {
    const { auditChannelId } = await getSettings();
    if (!auditChannelId) return;
    const ch = await guild.channels.fetch(auditChannelId).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send(text);
  } catch {
    /* audit best-effort */
  }
}

async function dmUser(client, userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch {
    /* DMs fermes : on ignore */
  }
}

async function doSync(member, brawlhallaId, ctx, profile) {
  return syncMember(member, brawlhallaId, ctx.rolesByName, profile ? { profile } : {});
}

async function isReviewer(interaction) {
  const { reviewerRoleId, validatorRoleId } = await getSettings();
  const roles = interaction.member?.roles?.cache;
  if (reviewerRoleId && roles?.has(reviewerRoleId)) return true;
  if (validatorRoleId && roles?.has(validatorRoleId)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

// ---------- /lier ----------

async function handleLier(interaction, ctx) {
  const now = Date.now();
  const last = lierCooldowns.get(interaction.user.id) ?? 0;
  if (now - last < LIER_COOLDOWN_MS) {
    const wait = Math.ceil((LIER_COOLDOWN_MS - (now - last)) / 1000);
    return interaction.reply({ content: `Patiente ${wait}s avant de réessayer.`, flags: EPHEMERAL });
  }
  lierCooldowns.set(interaction.user.id, now);

  const pseudo = interaction.options.getString("pseudo", true).trim();
  await interaction.deferReply(); // public : le joueur sera mentionne/notifie au moment du choix

  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    const msg = err.pending ? err.message : `Erreur lors de la recherche : ${err.message}`;
    return interaction.editReply(`<@${interaction.user.id}> ${msg}`);
  }
  if (players.length === 0) {
    return interaction.editReply(
      `<@${interaction.user.id}> aucun joueur classé trouvé pour **${pseudo}**. Seuls les joueurs ayant joué en ranked cette saison apparaissent.`,
    );
  }

  const row = new ActionRowBuilder().addComponents(
    players.map((p) => {
      const btn = new ButtonBuilder()
        .setCustomId(`pick:${interaction.user.id}:${p.id}`)
        .setLabel(`${p.username} — ${p.tier ?? "?"} (${p.region}, ${p.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Primary);
      const emoji = tierEmojiResolvable(p.tier ? String(p.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `<@${interaction.user.id}> sélectionne **ton** compte Brawlhalla :`,
    components: [row],
    allowedMentions: { users: [interaction.user.id] },
  });
}

async function handlePick(interaction, ctx) {
  // customId : pick:<ownerId>:<brawlhallaId>
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  const brawlhallaId = Number(parts[2]);

  // Message public : seul l'auteur de la commande /lier peut choisir son compte.
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "Ce choix ne t'appartient pas. Lance ta propre commande `/lier`.",
      flags: EPHEMERAL,
    });
  }
  await interaction.deferUpdate();

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== interaction.user.id) {
    return interaction.editReply({
      content: `Ce compte est **déjà lié** par <@${owner}>. Si c'est le tien, contacte le staff.`,
      components: [],
    });
  }

  let data;
  try {
    data = await getPlayerProfile(brawlhallaId);
  } catch (err) {
    return interaction.editReply({ content: `Erreur API : ${err.message}`, components: [] });
  }

  const settings = await getSettings();
  const top = highestTier(data.tiers);
  const autoApprove =
    !settings.reviewChannelId || tierIndex(top) <= tierIndex(settings.autoApproveTier);

  if (autoApprove) {
    try {
      const result = await doSync(interaction.member, brawlhallaId, ctx, data);
      await logAudit(
        interaction.guild,
        `✅ Auto-liaison : <@${interaction.user.id}> → \`${data.name}\` (${tierSummary(result.tiers)})`,
      );
      const note = data.partial
        ? "\n⚠️ API Brawlhalla indisponible : seul ton rank 1v1 a pu être appliqué. Le reste se mettra à jour automatiquement plus tard."
        : "\nTes rôles seront mis à jour automatiquement.";
      return interaction.editReply({
        content: `<@${interaction.user.id}> compte lié ! ${tierSummary(result.tiers)}.${note}`,
        components: [],
        allowedMentions: { users: [interaction.user.id] },
      });
    } catch (err) {
      return interaction.editReply({ content: `Échec de la liaison : ${err.message}`, components: [] });
    }
  }

  // Sinon : demande de validation au staff.
  const channel = await interaction.guild.channels.fetch(settings.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({
      content: "Salon de validation introuvable. Préviens un admin (/setup).",
      components: [],
    });
  }

  const embed = buildReviewEmbed(interaction.user, brawlhallaId, data);
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ap:${interaction.user.id}:${brawlhallaId}`).setLabel("Valider").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rj:${interaction.user.id}:${brawlhallaId}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
  );

  try {
    await channel.send({ embeds: [embed], components: [actions] });
  } catch (err) {
    return interaction.editReply({ content: `Impossible d'envoyer la demande : ${err.message}`, components: [] });
  }
  return interaction.editReply({
    content: `<@${interaction.user.id}> ta demande a été envoyée au staff ✅. Tu recevras tes rôles une fois validée.`,
    components: [],
    allowedMentions: { users: [interaction.user.id] },
  });
}

function buildReviewEmbed(user, brawlhallaId, data) {
  return new EmbedBuilder()
    .setTitle("Demande de liaison Brawlhalla")
    .setColor(0x4ea1ff)
    .addFields(
      { name: "Membre", value: `<@${user.id}>`, inline: true },
      { name: "Compte", value: `\`${data.name ?? "?"}\``, inline: true },
      { name: "Brawlhalla ID", value: `\`${brawlhallaId}\``, inline: true },
      { name: "1v1", value: `${data.tiers["1v1"] ? `${tierEmoji(data.tiers["1v1"])} ${data.tiers["1v1"]}` : "—"} (${data.ratings["1v1"]})`, inline: true },
      { name: "2v2", value: `${data.tiers["2v2"] ? `${tierEmoji(data.tiers["2v2"])} ${data.tiers["2v2"]}` : "—"} (${data.ratings["2v2"]})`, inline: true },
      { name: "Région / Peak / Rang", value: `${data.region} · peak ${data.peak1v1} · #${data.globalRank}`, inline: true },
    )
    .setFooter({ text: "Valide uniquement si ce compte appartient bien à ce membre." })
    .setTimestamp(new Date());
}

// ---------- Validation (boutons + modal) ----------

async function handleApprove(interaction, ctx) {
  if (!(await isReviewer(interaction))) {
    return interaction.reply({ content: "Tu n'as pas la permission de valider.", flags: EPHEMERAL });
  }
  const [, requesterId, bhId] = interaction.customId.split(":");
  const brawlhallaId = Number(bhId);
  await interaction.deferUpdate();

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== requesterId) {
    return concludeReview(interaction, `❌ Déjà lié par <@${owner}> entre-temps.`);
  }
  const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
  if (!member) return concludeReview(interaction, "❌ Membre introuvable.");

  try {
    const result = await doSync(member, brawlhallaId, ctx);
    await dmUser(interaction.client, requesterId, `✅ Ta liaison Brawlhalla a été validée ! ${tierSummary(result.tiers)}.`);
    await logAudit(interaction.guild, `✅ <@${interaction.user.id}> a validé <@${requesterId}> (${tierSummary(result.tiers)}).`);
    return concludeReview(interaction, `✅ Validé par <@${interaction.user.id}> — <@${requesterId}> : ${tierSummary(result.tiers)}.`);
  } catch (err) {
    return concludeReview(interaction, `⚠️ Erreur : ${err.message}`);
  }
}

async function handleReject(interaction, ctx) {
  if (!(await isReviewer(interaction))) {
    return interaction.reply({ content: "Tu n'as pas la permission de refuser.", flags: EPHEMERAL });
  }
  const [, requesterId, bhId] = interaction.customId.split(":");
  const modal = new ModalBuilder()
    .setCustomId(`rm:${requesterId}:${bhId}:${interaction.channelId}:${interaction.message.id}`)
    .setTitle("Refuser la demande")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("raison")
          .setLabel("Raison (envoyée au membre)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200),
      ),
    );
  return interaction.showModal(modal);
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

async function concludeReview(interaction, conclusion) {
  const original = interaction.message?.embeds?.[0];
  const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder();
  embed.addFields({ name: "Résultat", value: conclusion });
  return interaction.editReply({ embeds: [embed], components: [] });
}

// ---------- /forcelink (admin) ----------

async function handleForcelink(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  const pseudo = interaction.options.getString("pseudo", true).trim();
  await interaction.deferReply({ flags: EPHEMERAL });

  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    return interaction.editReply(`Erreur : ${err.message}`);
  }
  if (players.length === 0) return interaction.editReply(`Aucun joueur classé pour **${pseudo}**.`);

  const row = new ActionRowBuilder().addComponents(
    players.map((p) => {
      const btn = new ButtonBuilder()
        .setCustomId(`fl:${target.id}:${p.id}`)
        .setLabel(`${p.username} — ${p.tier ?? "?"} (${p.region}, ${p.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
      const emoji = tierEmojiResolvable(p.tier ? String(p.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `Choisis le compte à lier à <@${target.id}> :`,
    components: [row],
  });
}

async function handleForceLinkPick(interaction, ctx) {
  if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  const [, targetId, bhId] = interaction.customId.split(":");
  const brawlhallaId = Number(bhId);
  await interaction.deferUpdate();

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== targetId) {
    return interaction.editReply({
      content: `Ce compte est déjà lié par <@${owner}>. Fais d'abord /unlink sur lui.`,
      components: [],
    });
  }
  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) return interaction.editReply({ content: "Membre introuvable.", components: [] });

  try {
    const result = await doSync(member, brawlhallaId, ctx);
    await logAudit(interaction.guild, `🔧 <@${interaction.user.id}> a force-lié <@${targetId}> (${tierSummary(result.tiers)}).`);
    return interaction.editReply({
      content: `<@${targetId}> lié ! ${tierSummary(result.tiers)}.`,
      components: [],
    });
  } catch (err) {
    return interaction.editReply({ content: `Échec : ${err.message}`, components: [] });
  }
}

// ---------- /unlink (admin) ----------

async function handleUnlink(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  await interaction.deferReply({ flags: EPHEMERAL });
  const existed = await removeLink(target.id);
  if (!existed) return interaction.editReply(`<@${target.id}> n'avait aucune liaison.`);

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (member) {
    const managed = managedRoleNames();
    const toRemove = member.roles.cache.filter((r) => managed.has(r.name));
    if (toRemove.size) await member.roles.remove([...toRemove.values()], "Unlink admin");
  }
  await logAudit(interaction.guild, `🗑️ <@${interaction.user.id}> a délié <@${target.id}>.`);
  return interaction.editReply(`Liaison de <@${target.id}> supprimée.`);
}

// ---------- /whois ----------

async function handleWhois(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  await interaction.deferReply({ flags: EPHEMERAL });
  const link = await getLink(target.id);
  if (!link) return interaction.editReply(`<@${target.id}> n'a aucun compte lié.`);

  let live = "";
  try {
    const data = await getPlayerProfile(link.brawlhallaId);
    live = `\nEn direct : ${tierSummary(data.tiers)}`;
  } catch {
    /* ignore */
  }
  return interaction.editReply(
    `<@${target.id}> → **${link.name}** (ID \`${link.brawlhallaId}\`)\n` +
      `Dernier enregistré : ${tierSummary(link.tiers)}${live}`,
  );
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

// ---------- /top ----------

async function handleTop(interaction, ctx) {
  await interaction.deferReply();
  const links = await getAllLinks();
  const entries = Object.entries(links)
    .map(([id, l]) => ({ id, name: l.name, rating: l.rating1v1 ?? 0, tiers: l.tiers }))
    .filter((e) => e.rating > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 15);

  if (entries.length === 0) return interaction.editReply("Aucun membre lié avec un rank 1v1 pour le moment.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = entries.map((e, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    const t = e.tiers?.["1v1"];
    return `${place} <@${e.id}> — ${t ? `${tierEmoji(t)} ${t}` : "?"} (${e.rating})`;
  });
  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement 1v1 — membres liés")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /stats /rank /legendes /equipe (lookup) ----------

/**
 * Determine le compte cible : option pseudo > option membre > soi-meme.
 * Renvoie { brawlhallaId, label } ou { error }.
 */
async function resolveTarget(interaction) {
  const idOpt = interaction.options.getInteger("id");
  const pseudo = interaction.options.getString("pseudo")?.trim();
  const memberOpt = interaction.options.getUser("membre");

  // Brawlhalla ID fourni : chemin le plus fiable (on va direct au profil, aucune recherche).
  if (idOpt) {
    return { brawlhallaId: idOpt, label: `ID ${idOpt}` };
  }

  if (pseudo) {
    let players;
    try {
      players = await searchPlayers(pseudo);
    } catch (err) {
      return { error: err.pending ? err.message : `Erreur API : ${err.message}` };
    }
    if (!players.length) return { error: `Aucun joueur classé trouvé pour **${pseudo}**.` };
    return { brawlhallaId: players[0].id, label: players[0].username };
  }
  const targetUser = memberOpt ?? interaction.user;
  const link = await getLink(targetUser.id);
  if (!link) {
    return {
      error: memberOpt
        ? `<@${targetUser.id}> n'a aucun compte lié.`
        : "Tu n'as pas de compte lié. Fais /lier d'abord, ou précise un pseudo.",
    };
  }
  return { brawlhallaId: link.brawlhallaId, label: link.name };
}

function winrate(wins, games) {
  return games > 0 ? `${((wins / games) * 100).toFixed(1)}%` : "—";
}

// Formate une duree en secondes facon Raybot : "1 211h 56m 14s".
function formatPlaytime(totalSec) {
  if (!totalSec || totalSec <= 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h.toLocaleString("fr-FR")}h ${m}m ${s}s`;
}

// Emoji custom du serveur par tier de base (decoratif, ne change rien aux roles).
// "Gold 4" -> base "Gold". Repli unicode pour Tin / tier inconnu.
function tierEmoji(tier) {
  const base = tier ? String(tier).split(" ")[0] : null;
  return tierEmojiText(base) || "▪️";
}

// ============================================================
//  Fiche joueur unifiee : 4 onglets distincts (Vue d'ensemble,
//  Ranked, Legendes, Equipes 2v2) navigables par boutons.
//  Les commandes /stats /rank /legendes /equipe ouvrent chacune
//  un onglet, mais partagent le MEME embed + boutons : aucune
//  info en double, et on change d'onglet sans retaper la commande
//  (le profil est en cache -> instantane).
// ============================================================

const PROFILE_VIEWS = [
  ["overview", "Vue d'ensemble", "🪪"],
  ["ranked", "Ranked", "🥊"],
  ["legends", "Légendes", "⚔️"],
  ["teams", "Équipes 2v2", "👥"],
];

// Rangee de boutons d'onglets (l'onglet actif est mis en avant et desactive).
function profileNavRow(active, brawlhallaId) {
  return new ActionRowBuilder().addComponents(
    PROFILE_VIEWS.map(([view, label, emoji]) =>
      new ButtonBuilder()
        .setCustomId(`prof:${view}:${brawlhallaId}`)
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(view === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(view === active),
    ),
  );
}

// Coequipier d'une equipe 2v2 (l'autre que le joueur consulte).
function teammate(team, brawlhallaId) {
  return team.brawlhalla_id_one !== brawlhallaId ? team.username_one : team.username_two;
}

// Construit l'embed correspondant a un onglet. p = profil, legends = Map id->info.
function buildProfileEmbed(view, p, legends) {
  const footer = { text: `Brawlhalla ID : ${p.brawlhallaId} · change d'onglet avec les boutons` };

  // ---------- Onglet RANKED : tout le competitif (1v1 + 2v2 + legende classee) ----------
  if (view === "ranked") {
    const embed = new EmbedBuilder().setTitle(`🥊 Ranked — ${p.name}`).setColor(0x9b59b6).setFooter(footer);

    if (p.ratings["1v1"] > 0) {
      const tier = p.tiers["1v1"] === "Valhallan" ? "Valhallan" : tierFromRating(p.ratings["1v1"]);
      const losses = Math.max(0, p.games1v1 - p.wins1v1);
      const lines = [
        `${tierEmoji(p.tiers["1v1"])} **${tier}** — ${p.ratings["1v1"]} / ${p.peak1v1} (peak)`,
        `**${p.wins1v1}** V • **${losses}** D — ${p.games1v1} games (**${winrate(p.wins1v1, p.games1v1)}**)`,
        `🌍 Rang mondial : **#${p.globalRank || "?"}** · Région : **${p.region}**`,
      ];
      const glory = estimateGlory(p);
      if (glory) lines.push(`🏅 Glory estimée : **≈ ${glory.totalGlory.toLocaleString("fr-FR")}**`);
      embed.addFields({ name: "🥊 1v1", value: lines.join("\n") });
    } else {
      embed.addFields({ name: "🥊 1v1", value: "Non classé" });
    }

    const bestLeg = [...p.legendsRanked].sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0];
    if (bestLeg && bestLeg.games > 0) {
      const name = legends.get(bestLeg.legend_id)?.name ?? `#${bestLeg.legend_id}`;
      const lossL = Math.max(0, bestLeg.games - bestLeg.wins);
      embed.addFields({
        name: "⭐ Meilleure légende classée",
        value:
          `**${name}** — ${bestLeg.tier ?? tierFromRating(bestLeg.rating)} (${bestLeg.rating} / ${bestLeg.peak_rating})\n` +
          `${bestLeg.wins} V • ${lossL} D (${winrate(bestLeg.wins, bestLeg.games)})`,
        inline: true,
      });
    }

    if (p.best2v2) {
      const t = p.best2v2;
      const tier = p.tiers["2v2"] === "Valhallan" ? "Valhallan" : tierFromRating(t.rating);
      const loss2 = Math.max(0, t.games - t.wins);
      embed.addFields({
        name: "👥 Meilleure équipe 2v2",
        value:
          `${tierEmoji(p.tiers["2v2"])} **${tier}** — ${t.rating} / ${t.peak_rating} (peak)\n` +
          `🤝 avec **${teammate(t, p.brawlhallaId) ?? "?"}**\n` +
          `${t.wins} V • ${loss2} D (${winrate(t.wins, t.games)})`,
        inline: true,
      });
    } else {
      embed.addFields({ name: "👥 Meilleure équipe 2v2", value: "Non classé", inline: true });
    }
    return embed;
  }

  // ---------- Onglet LEGENDES : top legendes les plus jouees (tous modes) ----------
  if (view === "legends") {
    const embed = new EmbedBuilder().setTitle(`⚔️ Légendes — ${p.name}`).setColor(0xe67e22).setFooter(footer);
    const top = [...p.legendsAll].sort((a, b) => (b.games ?? 0) - (a.games ?? 0)).slice(0, 8);
    if (!top.length) {
      embed.setDescription("*Aucune statistique de légende.*");
    } else {
      embed.setDescription(
        top
          .map((l, i) => {
            const name = legends.get(l.legend_id)?.name ?? `#${l.legend_id}`;
            return `**${i + 1}.** ${name} — ${l.games.toLocaleString("fr-FR")} games · **${winrate(l.wins, l.games)}** WR`;
          })
          .join("\n"),
      );
    }
    return embed;
  }

  // ---------- Onglet EQUIPES 2v2 : toutes les equipes classees ----------
  if (view === "teams") {
    const embed = new EmbedBuilder().setTitle(`👥 Équipes 2v2 — ${p.name}`).setColor(0x1abc9c).setFooter(footer);
    const teams = [...p.teams].sort((a, b) => b.rating - a.rating).slice(0, 12);
    if (!teams.length) {
      embed.setDescription("*Aucune équipe 2v2 classée.*");
    } else {
      embed.setDescription(
        teams
          .map((t) => {
            const tier = t.tier ?? tierFromRating(t.rating);
            const loss = Math.max(0, t.games - t.wins);
            return `**${teammate(t, p.brawlhallaId) ?? "?"}** — ${tierEmoji(tier.split(" ")[0])} ${tier} (${t.rating}) · ${t.wins}V/${loss}D · ${winrate(t.wins, t.games)}`;
          })
          .join("\n"),
      );
    }
    return embed;
  }

  // ---------- Onglet VUE D'ENSEMBLE : la carte de visite (carriere, pas le detail ranked) ----------
  const embed = new EmbedBuilder().setTitle(`🪪 Profil — ${p.name}`).setColor(0x4ea1ff).setFooter(footer);
  const playSec = p.legendsAll.reduce((a, l) => a + (l.match_time ?? 0), 0);
  const totLoss = Math.max(0, p.totalGames - p.totalWins);
  const fav = [...p.legendsAll].sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0];
  const favTxt = fav
    ? `${legends.get(fav.legend_id)?.name ?? `#${fav.legend_id}`} (${fav.games.toLocaleString("fr-FR")} games · ${winrate(fav.wins, fav.games)})`
    : "—";
  const rank1 = p.tiers["1v1"]
    ? `${tierEmoji(p.tiers["1v1"])} **${p.tiers["1v1"]}**${p.ratings["1v1"] ? ` (${p.ratings["1v1"]})` : ""}`
    : "Non classé";
  const rank2 = p.tiers["2v2"]
    ? `${tierEmoji(p.tiers["2v2"])} **${p.tiers["2v2"]}**${p.ratings["2v2"] ? ` (${p.ratings["2v2"]})` : ""}`
    : "Non classé";
  embed.addFields(
    { name: "Niveau", value: `**${p.level}**`, inline: true },
    { name: "Région", value: `${p.region}`, inline: true },
    { name: "Temps de jeu", value: formatPlaytime(playSec), inline: true },
    {
      name: "Games (tous modes)",
      value: `**${p.totalGames.toLocaleString("fr-FR")}** · ${winrate(p.totalWins, p.totalGames)} WR`,
      inline: true,
    },
    {
      name: "Victoires / Défaites",
      value: `${p.totalWins.toLocaleString("fr-FR")} • ${totLoss.toLocaleString("fr-FR")}`,
      inline: true,
    },
    { name: "Légende préférée", value: favTxt, inline: true },
    { name: "Rangs", value: `🥊 1v1 : ${rank1}\n👥 2v2 : ${rank2}`, inline: false },
  );
  return embed;
}

// Logique commune aux 4 commandes : resout la cible, charge le profil, repond avec l'onglet + boutons.
// ---------- /progression : courbe d'evolution du rating ----------

// ---------- /carte : carte profil en image ----------

async function handleCarte(interaction, ctx) {
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let profile;
  try {
    profile = await getPlayerProfile(target.brawlhallaId);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }

  // Avatar Discord : seulement si la cible est un membre (option "membre" ou soi-meme par defaut).
  const memberOpt = interaction.options.getUser("membre");
  const noLookup = !interaction.options.getString("pseudo") && !interaction.options.getInteger("id");
  const avatarUser = memberOpt ?? (noLookup ? interaction.user : null);
  let avatarBuffer = null;
  if (avatarUser) {
    try {
      const res = await fetch(avatarUser.displayAvatarURL({ extension: "png", size: 256 }));
      if (res.ok) avatarBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      /* pas d'avatar : la carte s'affiche sans */
    }
  }

  // Main legende (la plus jouee, >= 1 game) pour l'afficher sur la carte.
  let mainLegend = null;
  try {
    const legends = Array.isArray(profile.legendsAll) ? profile.legendsAll : [];
    let best = null;
    for (const l of legends) if ((l.games ?? 0) > 0 && (!best || (l.games ?? 0) > (best.games ?? 0))) best = l;
    if (best) mainLegend = (await getLegends()).get(best.legend_id)?.name ?? null;
  } catch {
    /* best-effort */
  }

  const glory = estimateGlory(profile)?.totalGlory ?? null;

  let buffer;
  try {
    buffer = await renderProfileCard(profile, {
      avatarBuffer,
      displayName: avatarUser?.username ?? profile.name,
      mainLegend,
      glory,
    });
  } catch (err) {
    return interaction.editReply(`Impossible de générer la carte : ${err.message}`);
  }

  const file = new AttachmentBuilder(buffer, { name: "carte.png" });
  return interaction.editReply({ files: [file] });
}

// ---------- /progression : courbe d'evolution du rating ----------

async function handleProgression(interaction, ctx) {
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let profile = null;
  try {
    profile = await getPlayerProfile(target.brawlhallaId);
  } catch {
    /* on continue : le nom de repli suffit */
  }
  const name = profile?.name ?? target.label ?? "Joueur";

  const history = await getRatingHistory(target.brawlhallaId);
  if (history.length < 2) {
    return interaction.editReply(
      `📈 Pas encore assez de données pour **${name}**.\n` +
        "L'historique se construit automatiquement à chaque rafraîchissement des rôles. Reviens dans quelques jours !",
    );
  }

  // On borne a 120 points pour garder l'URL du graphe raisonnable.
  const points = history.slice(-120);
  const labels = points.map((p) => new Date(p.ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }));
  const r1 = points.map((p) => p.r1 || null);
  const r2 = points.map((p) => (p.r2 ? p.r2 : null));

  const chart = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "1v1", data: r1, borderColor: "#4ea1ff", backgroundColor: "#4ea1ff", fill: false, tension: 0.3, spanGaps: true, pointRadius: 0 },
        { label: "2v2", data: r2, borderColor: "#9b59b6", backgroundColor: "#9b59b6", fill: false, tension: 0.3, spanGaps: true, pointRadius: 0 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: "#ffffff" } } },
      scales: { x: { ticks: { color: "#bbbbbb", maxTicksLimit: 10 } }, y: { ticks: { color: "#bbbbbb" } } },
    },
  };
  const chartUrl =
    "https://quickchart.io/chart?bkg=" + encodeURIComponent("#2b2d31") + "&w=720&h=400&c=" + encodeURIComponent(JSON.stringify(chart));

  const first = points[0];
  const last = points[points.length - 1];
  const d1 = (last.r1 || 0) - (first.r1 || 0);
  const d2 = (last.r2 || 0) - (first.r2 || 0);
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  const embed = new EmbedBuilder()
    .setColor(0x4ea1ff)
    .setTitle(`📈 Progression — ${name}`)
    .setImage(chartUrl)
    .addFields(
      { name: "1v1 actuel", value: `**${last.r1 || 0}**${d1 ? ` (${sign(d1)})` : ""}`, inline: true },
      { name: "2v2 actuel", value: `**${last.r2 || 0}**${d2 ? ` (${sign(d2)})` : ""}`, inline: true },
      { name: "Période", value: `${labels[0]} → ${labels[labels.length - 1]}`, inline: true },
    )
    .setFooter({ text: "Historique enregistré à chaque refresh des rôles." });

  return interaction.editReply({ embeds: [embed] });
}

// ---------- /versus : comparaison de deux joueurs ----------

// Resout un cote de la comparaison depuis les options suffixees (membre1/pseudo1/id1...).
async function resolveVersusSide(interaction, suffix, allowSelf) {
  const idOpt = interaction.options.getInteger(`id${suffix}`);
  const pseudo = interaction.options.getString(`pseudo${suffix}`)?.trim();
  const memberOpt = interaction.options.getUser(`membre${suffix}`);

  if (idOpt) return { brawlhallaId: idOpt, label: `ID ${idOpt}` };
  if (pseudo) {
    let players;
    try {
      players = await searchPlayers(pseudo);
    } catch (err) {
      return { error: err.pending ? err.message : `Erreur API : ${err.message}` };
    }
    if (!players.length) return { error: `Aucun joueur classé trouvé pour **${pseudo}**.` };
    return { brawlhallaId: players[0].id, label: players[0].username };
  }
  if (memberOpt) {
    const link = await getLink(memberOpt.id);
    if (!link) return { error: `<@${memberOpt.id}> n'a aucun compte lié.` };
    return { brawlhallaId: link.brawlhallaId, label: link.name };
  }
  if (allowSelf) {
    const link = await getLink(interaction.user.id);
    if (!link) return { error: "Tu n'as pas de compte lié. Précise un pseudo/membre pour le 1er joueur." };
    return { brawlhallaId: link.brawlhallaId, label: link.name };
  }
  return { error: "Précise le **2e joueur** (membre, pseudo ou id)." };
}

function vsWinrate(games, wins) {
  if (!games || games <= 0) return null;
  return Math.round((wins / games) * 1000) / 10; // un chiffre apres la virgule
}

async function handleVersus(interaction, ctx) {
  await interaction.deferReply();
  const a = await resolveVersusSide(interaction, "1", true);
  if (a.error) return interaction.editReply(a.error);
  const b = await resolveVersusSide(interaction, "2", false);
  if (b.error) return interaction.editReply(b.error);
  if (String(a.brawlhallaId) === String(b.brawlhallaId)) {
    return interaction.editReply("Choisis deux joueurs **différents** 😅");
  }

  let pa, pb;
  try {
    [pa, pb] = await Promise.all([getPlayerProfile(a.brawlhallaId), getPlayerProfile(b.brawlhallaId)]);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }

  const na = pa.name ?? a.label;
  const nb = pb.name ?? b.label;
  const wrA = vsWinrate(pa.games1v1, pa.wins1v1);
  const wrB = vsWinrate(pb.games1v1, pb.wins1v1);
  const gloryA = estimateGlory(pa)?.totalGlory ?? null;
  const gloryB = estimateGlory(pb)?.totalGlory ?? null;

  // Construit un tableau aligne (monospace) avec un marqueur sur le meilleur de chaque ligne.
  const rows = [];
  const addRow = (label, va, vb, rawA, rawB, higherWins = true) => {
    let mA = "  ";
    let mB = "  ";
    if (rawA != null && rawB != null && rawA !== rawB) {
      const aWins = higherWins ? rawA > rawB : rawA < rawB;
      if (aWins) mA = "▲ ";
      else mB = "▲ ";
    }
    rows.push(
      `${label.padEnd(11)}│ ${mA}${String(va).padEnd(10)}│ ${mB}${String(vb)}`,
    );
  };

  addRow("Niveau", pa.level || 0, pb.level || 0, pa.level || 0, pb.level || 0);
  addRow("Rating 1v1", pa.ratings["1v1"] || 0, pb.ratings["1v1"] || 0, pa.ratings["1v1"] || 0, pb.ratings["1v1"] || 0);
  addRow("Peak 1v1", pa.peak1v1 || 0, pb.peak1v1 || 0, pa.peak1v1 || 0, pb.peak1v1 || 0);
  addRow("Tier 1v1", pa.tiers["1v1"] ?? "—", pb.tiers["1v1"] ?? "—", null, null);
  addRow("Rating 2v2", pa.ratings["2v2"] || 0, pb.ratings["2v2"] || 0, pa.ratings["2v2"] || 0, pb.ratings["2v2"] || 0);
  addRow("Winrate", wrA != null ? `${wrA}%` : "—", wrB != null ? `${wrB}%` : "—", wrA, wrB);
  addRow("Glory est.", gloryA ?? "—", gloryB ?? "—", gloryA, gloryB);

  const header = `${"".padEnd(11)}│ ${na.slice(0, 10).padEnd(12)}│ ${nb.slice(0, 10)}`;
  const table = "```\n" + header + "\n" + "─".repeat(header.length) + "\n" + rows.join("\n") + "\n```";

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⚔️ ${na}  vs  ${nb}`)
    .setDescription(table)
    .setFooter({ text: "▲ = avantage sur la ligne · Glory = estimation" });

  return interaction.editReply({ embeds: [embed] });
}

async function respondProfile(interaction, view) {
  await interaction.deferReply();

  const idOpt = interaction.options.getInteger("id");
  const pseudo = interaction.options.getString("pseudo")?.trim();

  // Cas direct : Brawlhalla ID, ou membre/soi-meme lie -> profil direct (aucune recherche).
  if (idOpt || !pseudo) {
    const target = await resolveTarget(interaction);
    if (target.error) return interaction.editReply(target.error);
    return showProfile(interaction, view, target.brawlhallaId);
  }

  // Cas pseudo : on recherche, et s'il y a plusieurs candidats on laisse choisir.
  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    return interaction.editReply(err.pending ? err.message : `Erreur API : ${err.message}`);
  }
  if (!players.length) return interaction.editReply(`Aucun joueur classé trouvé pour **${pseudo}**.`);
  if (players.length === 1) return showProfile(interaction, view, players[0].id);

  // Plusieurs joueurs (memes pseudos / pseudos proches) : on affiche un sélecteur.
  const row = new ActionRowBuilder().addComponents(
    players.slice(0, 5).map((pl) => {
      const btn = new ButtonBuilder()
        .setCustomId(`profpick:${view}:${pl.id}`)
        .setLabel(`${pl.username} — ${pl.tier ?? "?"} (${pl.region}, ${pl.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
      const emoji = tierEmojiResolvable(pl.tier ? String(pl.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `Plusieurs joueurs correspondent à **${pseudo}**. Choisis le bon :`,
    components: [row],
  });
}

// Charge le profil et affiche l'onglet demande (utilise par les commandes ET le sélecteur).
async function showProfile(interaction, view, brawlhallaId) {
  let p;
  try {
    p = await getPlayerProfile(brawlhallaId);
  } catch (err) {
    return interaction.editReply({ content: `Erreur API : ${err.message}`, embeds: [], components: [] });
  }
  const legends = await getLegends().catch(() => new Map());
  return interaction.editReply({
    content: "",
    embeds: [buildProfileEmbed(view, p, legends)],
    components: [profileNavRow(view, p.brawlhallaId)],
  });
}

const handleStats = (interaction) => respondProfile(interaction, "overview");
const handleRank = (interaction) => respondProfile(interaction, "ranked");
const handleLegendes = (interaction) => respondProfile(interaction, "legends");
const handleEquipe = (interaction) => respondProfile(interaction, "teams");

// Clic sur un candidat du sélecteur : ouvre la fiche de ce joueur dans l'onglet demande.
async function handleProfilePick(interaction) {
  const [, view, idStr] = interaction.customId.split(":");
  await interaction.deferUpdate();
  return showProfile(interaction, view, Number(idStr));
}

// Clic sur un onglet : recharge le profil (cache -> instantane) et remplace l'embed.
async function handleProfileNav(interaction) {
  const [, view, idStr] = interaction.customId.split(":");
  const brawlhallaId = Number(idStr);
  await interaction.deferUpdate();

  let p;
  try {
    p = await getPlayerProfile(brawlhallaId);
  } catch (err) {
    return interaction.editReply({ content: `Erreur API : ${err.message}`, embeds: [], components: [] });
  }
  const legends = await getLegends().catch(() => new Map());
  return interaction.editReply({
    embeds: [buildProfileEmbed(view, p, legends)],
    components: [profileNavRow(view, brawlhallaId)],
  });
}

async function handleLeaderboard(interaction, ctx) {
  await interaction.deferReply();
  const mode = interaction.options.getString("mode") ?? "1v1";
  const region = interaction.options.getString("region") ?? "ALL";

  let rankings;
  try {
    rankings = await getRankings(mode, region, 1, 10);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }
  if (!rankings.length) return interaction.editReply("Aucun résultat.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rankings.slice(0, 10).map((r, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    const name = mode === "2v2" ? r.teamname : r.players?.[0]?.username ?? r.name ?? "?";
    const t = r.tier ?? null;
    return `${place} ${name} — ${t ? `${tierEmoji(t)} ${t}` : "?"} (${r.rating})`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Leaderboard ${mode} — ${region}`)
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /ping ----------

async function handlePing(interaction, ctx) {
  await interaction.deferReply();
  const r = await pingApi();

  const fmt = (c) =>
    c.ok ? `🟢 OK (${c.ms} ms)` : `🔴 ${c.status ? `HTTP ${c.status}` : c.error || "réseau"} (${c.ms} ms)`;

  const ws = interaction.client.ws.ping;
  const botTxt = ws >= 0 ? `${Math.round(ws)} ms` : "mesure en cours…";

  const allOk = r.leaderboard.ok && r.player.ok;
  const embed = new EmbedBuilder()
    .setTitle("🏓 Pong")
    .setColor(allOk ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: "API — leaderboard", value: fmt(r.leaderboard), inline: true },
      { name: "API — joueurs", value: fmt(r.player), inline: true },
      { name: "Latence bot (gateway)", value: botTxt, inline: false },
    )
    .setFooter({
      text: allOk
        ? "Tout est opérationnel."
        : "Si 'joueurs' est rouge mais 'leaderboard' vert, c'est une panne côté API Brawlhalla (pas le bot).",
    })
    .setTimestamp(new Date());
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /reset-saison (admin) ----------

async function handleResetSeason(interaction, ctx) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("season_reset").setLabel("Confirmer le reset").setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    content:
      "⚠️ Cela va **retirer tous les rôles de rank** de tous les membres (les liaisons sont conservées). " +
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
  await logAudit(interaction.guild, `🔄 <@${interaction.user.id}> a reset la saison (${touched} membre(s) nettoyé(s)).`);
  return interaction.editReply({ content: `Reset terminé : rôles retirés à ${touched} membre(s).`, components: [] });
}

// ---------- /delier ----------

async function handleDelier(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const existed = await removeLink(interaction.user.id);
  if (!existed) return interaction.editReply("Tu n'avais aucun compte lié.");

  const managed = managedRoleNames();
  const toRemove = interaction.member.roles.cache.filter((r) => managed.has(r.name));
  if (toRemove.size) await interaction.member.roles.remove([...toRemove.values()], "Déliaison Brawlhalla");
  return interaction.editReply("Compte délié et rôles de rank retirés.");
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
      `• Seuil d'auto-validation : **${s.autoApproveTier}** (au-dessus = validation manuelle)\n\n` +
      "Modifie via les menus ci-dessous (appliqué immédiatement) :",
    components: [channelRow, roleRow, auditRow, announceRow, thresholdRow],
    flags: EPHEMERAL,
  });
}

export async function handleSelect(interaction, ctx) {
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

// ---------- Systeme de niveaux ----------

// Petite barre de progression textuelle (ex: ████░░░░░░).
function progressBar(current, total, size = 12) {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}

async function handleNiveau(interaction, ctx) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser("membre") ?? interaction.user;
  if (targetUser.bot) return interaction.editReply("Les bots ne gagnent pas d'XP. 🤖");

  const s = await getUserStats(interaction.guild.id, targetUser.id);
  if (s.xp === 0) {
    return interaction.editReply(
      targetUser.id === interaction.user.id
        ? "Tu n'as pas encore d'XP. Discute sur le serveur pour en gagner !"
        : `<@${targetUser.id}> n'a pas encore d'XP.`,
    );
  }

  // Carte image (façon MEE6/Arcane). Repli sur un embed si le rendu échoue.
  try {
    let avatarBuffer = null;
    try {
      const res = await fetch(targetUser.displayAvatarURL({ extension: "png", size: 256 }));
      if (res.ok) avatarBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      /* sans avatar */
    }
    const buffer = await renderLevelCard({
      displayName: targetUser.username,
      avatarBuffer,
      level: s.level,
      rank: s.rank,
      totalMembers: s.totalMembers,
      xp: s.xp,
      xpIntoLevel: s.xpIntoLevel,
      xpForNext: s.xpForNext,
      messages: s.messages,
    });
    const file = new AttachmentBuilder(buffer, { name: "niveau.png" });
    return interaction.editReply({ files: [file] });
  } catch {
    const bar = progressBar(s.xpIntoLevel, s.xpForNext);
    const embed = new EmbedBuilder()
      .setTitle(`Niveau — ${targetUser.username}`)
      .setColor(0x5865f2)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: "Niveau", value: `**${s.level}**`, inline: true },
        { name: "Rang serveur", value: s.rank ? `#${s.rank} / ${s.totalMembers}` : "—", inline: true },
        { name: "Messages", value: `${s.messages}`, inline: true },
        { name: "XP totale", value: `${s.xp}`, inline: true },
        { name: "Progression", value: `${bar}\n${s.xpIntoLevel} / ${s.xpForNext} XP avant le niveau ${s.level + 1}`, inline: false },
      );
    return interaction.editReply({ embeds: [embed] });
  }
}

async function handleClassementNiveaux(interaction, ctx) {
  await interaction.deferReply();
  const top = await getLeaderboard(interaction.guild.id, 10);
  if (!top.length) return interaction.editReply("Personne n'a encore gagné d'XP sur le serveur.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((e, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    return `${place} <@${e.id}> — Niveau **${e.level}** (${e.xp} XP)`;
  });
  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement des niveaux")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /leaderboard-xp : classement XP complet pagine ----------

const XP_LB_PER_PAGE = 10;

async function buildXpLeaderboardPage(guild, page) {
  const all = await getLeaderboard(guild.id, Number.MAX_SAFE_INTEGER);
  const totalPages = Math.max(1, Math.ceil(all.length / XP_LB_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = all.slice(p * XP_LB_PER_PAGE, p * XP_LB_PER_PAGE + XP_LB_PER_PAGE);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = slice.map((e, i) => {
    const rank = p * XP_LB_PER_PAGE + i;
    const place = rank < 3 ? medals[rank] : `**${rank + 1}.**`;
    return `${place} <@${e.id}> — Niveau **${e.level}** · ${e.xp.toLocaleString("fr-FR")} XP`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement XP du serveur")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n") || "Personne n'a encore d'XP.")
    .setFooter({ text: `Page ${p + 1}/${totalPages} • ${all.length} membre(s) classé(s)` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`xplb:${p - 1}`).setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(`xplb:${p + 1}`).setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
  );

  return { embeds: [embed], components: all.length > XP_LB_PER_PAGE ? [row] : [] };
}

async function handleLeaderboardXp(interaction, ctx) {
  await interaction.deferReply();
  const page = await buildXpLeaderboardPage(interaction.guild, 0);
  return interaction.editReply(page);
}

async function handleLeaderboardXpPage(interaction, ctx) {
  const page = Number(interaction.customId.split(":")[1]) || 0;
  const built = await buildXpLeaderboardPage(interaction.guild, page);
  return interaction.update(built);
}

async function handleNiveauxConfig(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const patch = {};
  const active = interaction.options.getBoolean("active");
  const salon = interaction.options.getChannel("salon-annonce");
  const cooldown = interaction.options.getInteger("cooldown");
  const xpMin = interaction.options.getInteger("xp-min");
  const xpMax = interaction.options.getInteger("xp-max");
  const voiceActive = interaction.options.getBoolean("vocal-actif");
  const voiceXp = interaction.options.getInteger("vocal-xp");
  const annonce = interaction.options.getString("annonce");
  const cumul = interaction.options.getBoolean("cumul-roles");

  if (active !== null) patch.enabled = active;
  if (salon) {
    patch.announceChannelId = salon.id;
    patch.announceMode = "channel";
  }
  if (cooldown !== null) patch.cooldownSec = cooldown;
  if (xpMin !== null) patch.minXp = xpMin;
  if (xpMax !== null) patch.maxXp = xpMax;
  if (voiceActive !== null) patch.voiceEnabled = voiceActive;
  if (voiceXp !== null) patch.voiceXpPerMin = voiceXp;
  if (annonce !== null) patch.announceMode = annonce;
  if (cumul !== null) patch.stackRewards = cumul;

  const cfg = Object.keys(patch).length ? await setLevelConfig(interaction.guild.id, patch) : await getLevelConfig(interaction.guild.id);

  const rewards = Object.entries(cfg.rewards ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([lvl, roleId]) => `• Niveau ${lvl} → <@&${roleId}>`)
    .join("\n") || "*(aucune)*";

  const annonceTxt =
    cfg.announceMode === "off"
      ? "désactivée"
      : cfg.announceMode === "dm"
        ? "message privé"
        : cfg.announceChannelId
          ? `salon <#${cfg.announceChannelId}>`
          : "salon courant";

  return interaction.editReply(
    "**Config des niveaux**\n" +
      `• Activé : **${cfg.enabled ? "oui" : "non"}**\n` +
      `• Annonces : **${annonceTxt}**\n` +
      `• Cooldown : **${cfg.cooldownSec}s**\n` +
      `• XP par message : **${cfg.minXp}–${cfg.maxXp}**\n` +
      `• XP vocal : **${cfg.voiceEnabled ? "oui" : "non"}** (${cfg.voiceXpPerMin} XP/min)\n` +
      `• Cumul des rôles de palier : **${cfg.stackRewards ? "oui" : "seulement le plus haut"}**\n` +
      `• Récompenses :\n${rewards}`,
  );
}

async function handleNiveauxRecompense(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const niveau = interaction.options.getInteger("niveau", true);
  const role = interaction.options.getRole("role");

  if (role) {
    const me = interaction.guild.members.me;
    if (me && role.position >= me.roles.highest.position) {
      return interaction.editReply(
        `Je ne peux pas attribuer <@&${role.id}> : ce rôle est au-dessus du mien. Place mon rôle plus haut dans la hiérarchie.`,
      );
    }
  }

  await setReward(interaction.guild.id, niveau, role?.id ?? null);
  return interaction.editReply(
    role
      ? `Récompense définie : niveau **${niveau}** → <@&${role.id}> ✅`
      : `Récompense du niveau **${niveau}** supprimée. ✅`,
  );
}

async function handleNiveauxSet(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const target = interaction.options.getUser("membre", true);
  if (target.bot) return interaction.editReply("Les bots ne gagnent pas d'XP.");

  const niveau = interaction.options.getInteger("niveau");
  const xp = interaction.options.getInteger("xp");
  if (niveau === null && xp === null) {
    return interaction.editReply("Précise `niveau` (valeur exacte) ou `xp` (à ajouter/retirer).");
  }

  let stats;
  if (niveau !== null) stats = await setUserLevel(interaction.guild.id, target.id, niveau);
  if (xp !== null) stats = await addUserXp(interaction.guild.id, target.id, xp);

  // Applique les roles de recompense correspondant au nouveau niveau (ajout + retrait).
  try {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) await applyRewardRolesForMember(member, stats.level);
  } catch {
    /* best-effort */
  }

  await logAudit(interaction.guild, `📈 <@${interaction.user.id}> a modifié l'XP de <@${target.id}> → niveau ${stats.level} (${stats.xp} XP).`);
  return interaction.editReply(`<@${target.id}> est maintenant **niveau ${stats.level}** (${stats.xp} XP). ✅`);
}

// Aligne les roles de recompense d'un membre sur son niveau (ajoute ceux manquants,
// retire ceux qu'il ne devrait plus avoir). Renvoie true si un changement a eu lieu.
async function applyRewardRolesForMember(member, level) {
  const { desired, all } = await rewardRolePlan(member.guild.id, level);
  const desiredSet = new Set(desired);
  const toAdd = desired.filter((id) => id && !member.roles.cache.has(id));
  const toRemove = all.filter((id) => id && !desiredSet.has(id) && member.roles.cache.has(id));
  if (toAdd.length) await member.roles.add(toAdd, "Resync récompense de niveau").catch(() => {});
  if (toRemove.length) await member.roles.remove(toRemove, "Resync récompense de niveau").catch(() => {});
  return toAdd.length > 0 || toRemove.length > 0;
}

async function handleNiveauxReset(interaction, ctx) {
  const target = interaction.options.getUser("membre");
  if (target) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const existed = await resetLevels(interaction.guild.id, target.id);
    await logAudit(interaction.guild, `🧹 <@${interaction.user.id}> a reset l'XP de <@${target.id}>.`);
    return interaction.editReply(existed ? `XP de <@${target.id}> remise à zéro. ✅` : `<@${target.id}> n'avait pas d'XP.`);
  }

  // Reset global : confirmation par bouton.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("levels_reset_all").setLabel("Confirmer le reset total").setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    content: "⚠️ Cela va **remettre à zéro l'XP de tous les membres** du serveur. Action irréversible. Confirmer ?",
    components: [row],
    flags: EPHEMERAL,
  });
}

async function handleLevelsResetAllConfirm(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  await interaction.deferUpdate();
  await resetLevels(interaction.guild.id, null);
  await logAudit(interaction.guild, `🧹 <@${interaction.user.id}> a reset l'XP de tout le serveur.`);
  return interaction.editReply({ content: "XP de tous les membres remise à zéro. ✅", components: [] });
}

async function handleNiveauxResync(interaction, ctx) {
  const target = interaction.options.getUser("membre");
  await interaction.deferReply({ flags: EPHEMERAL });

  if (target) {
    if (target.bot) return interaction.editReply("Les bots n'ont pas de rôles de niveau.");
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply("Membre introuvable sur le serveur.");
    const s = await getUserStats(interaction.guild.id, target.id);
    const changed = await applyRewardRolesForMember(member, s.level);
    return interaction.editReply(
      changed
        ? `Rôles de <@${target.id}> réalignés sur le niveau ${s.level}. ✅`
        : `Aucun changement : <@${target.id}> a déjà les bons rôles.`,
    );
  }

  // Resync global : tous les membres ayant de l'XP.
  const r = await resyncAllRewards(interaction.guild, (n) =>
    interaction.editReply(`Resync de ${n} membre(s) en cours… (cela peut prendre un moment)`),
  );
  if (r.total === 0) return interaction.editReply("Aucun membre avec de l'XP à resync.");
  await logAudit(interaction.guild, `🔁 <@${interaction.user.id}> a resync les niveaux (${r.changed} membre(s) mis a jour).`);
  return interaction.editReply(`Resync terminé : **${r.changed}** membre(s) mis à jour, ${r.skipped} absent(s) du serveur.`);
}

// Réaligne les rôles de récompense de tous les membres ayant de l'XP sur leur niveau.
// onStart(total) est appelé une fois le nombre connu (pour informer l'admin).
async function resyncAllRewards(guild, onStart) {
  const all = await getLeaderboard(guild.id, Number.MAX_SAFE_INTEGER);
  if (!all.length) return { total: 0, changed: 0, skipped: 0 };
  if (onStart) await onStart(all.length).catch(() => {});

  // Pre-charge le cache des membres pour eviter un fetch reseau par membre.
  await guild.members.fetch().catch(() => {});

  let changed = 0;
  let skipped = 0;
  for (const e of all) {
    const member = guild.members.cache.get(e.id);
    if (!member) {
      skipped++;
      continue;
    }
    try {
      if (await applyRewardRolesForMember(member, e.level)) changed++;
    } catch {
      /* ignore membre */
    }
  }
  return { total: all.length, changed, skipped };
}

// ====================================================================
// Panneau interactif /setup-levels
// ====================================================================

// Construit l'embed + les composants du panneau a partir de la config actuelle.
async function buildLevelsPanel(guildId) {
  const cfg = await getLevelConfig(guildId);

  const annonceTxt =
    cfg.announceMode === "off"
      ? "🔕 désactivées"
      : cfg.announceMode === "dm"
        ? "📩 en message privé"
        : cfg.announceChannelId
          ? `💬 dans <#${cfg.announceChannelId}>`
          : "💬 dans le salon où le membre écrit";

  const rewardsTxt =
    Object.entries(cfg.rewards ?? {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([lvl, roleId]) => `• Niveau **${lvl}** → <@&${roleId}>`)
      .join("\n") || "*(aucune récompense configurée)*";

  const embed = new EmbedBuilder()
    .setTitle("⚙️ Configuration du système de niveaux")
    .setColor(cfg.enabled ? 0x5865f2 : 0x747f8d)
    .setDescription(
      "Les membres gagnent de l'XP en discutant et en restant en vocal, montent de niveau et débloquent des rôles.\n" +
        "Chaque réglage ci-dessous est **appliqué immédiatement**.\n\u200b",
    )
    .addFields(
      {
        name: "État du système",
        value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé** (aucun gain d'XP)",
        inline: true,
      },
      {
        name: "XP par message",
        value: `**${cfg.minXp}–${cfg.maxXp}** XP\ncooldown **${cfg.cooldownSec}s** entre 2 gains`,
        inline: true,
      },
      {
        name: "XP vocal",
        value: cfg.voiceEnabled
          ? `🟢 **${cfg.voiceXpPerMin}** XP/min\n(pas seul, pas mute, hors AFK)`
          : "🔴 désactivé",
        inline: true,
      },
      { name: "Annonces de montée", value: annonceTxt, inline: true },
      {
        name: "Cumul des rôles",
        value: cfg.stackRewards ? "📚 tous les paliers atteints" : "🥇 seulement le plus haut",
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🎁 Récompenses par niveau", value: rewardsTxt, inline: false },
    )
    .setFooter({ text: "Boutons = activer/désactiver • Menus = salon & mode • ⚙️ valeurs XP • 🎁 récompenses" });

  const rowChannel = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("lvl_announce_channel")
      .setPlaceholder("💬 Salon des annonces de montée de niveau")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const rowMode = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("lvl_announce_mode")
      .setPlaceholder("📣 Où annoncer les montées de niveau ?")
      .addOptions(
        { label: "Dans un salon", value: "channel", description: "Salon dédié ci-dessus, sinon le salon du message", emoji: "💬", default: cfg.announceMode === "channel" },
        { label: "En message privé", value: "dm", description: "Le membre est notifié en MP (zéro spam public)", emoji: "📩", default: cfg.announceMode === "dm" },
        { label: "Désactivées", value: "off", description: "Aucune annonce de montée de niveau", emoji: "🔕", default: cfg.announceMode === "off" },
      ),
  );

  const rowToggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lvl_toggle_enabled")
      .setLabel(cfg.enabled ? "Système : ON" : "Système : OFF")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("lvl_toggle_voice")
      .setLabel(cfg.voiceEnabled ? "XP vocal : ON" : "XP vocal : OFF")
      .setEmoji("🎙️")
      .setStyle(cfg.voiceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("lvl_toggle_stack")
      .setLabel(cfg.stackRewards ? "Cumul rôles : ON" : "Cumul rôles : OFF")
      .setEmoji("📚")
      .setStyle(cfg.stackRewards ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const rowActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lvl_open_xp_modal").setLabel("Valeurs XP").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lvl_open_reward_modal").setLabel("Récompenses").setEmoji("🎁").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lvl_resync").setLabel("Resync rôles").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowChannel, rowMode, rowToggles, rowActions] };
}

async function handleSetupLevels(interaction, ctx) {
  const panel = await buildLevelsPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

// Rafraichit le panneau en place apres une modification.
async function refreshLevelsPanel(interaction) {
  const panel = await buildLevelsPanel(interaction.guild.id);
  return interaction.update(panel);
}

// ---------- Boutons du panneau ----------

async function handleLevelsPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getLevelConfig(interaction.guild.id);

  if (id === "lvl_toggle_enabled") {
    await setLevelConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshLevelsPanel(interaction);
  }
  if (id === "lvl_toggle_voice") {
    await setLevelConfig(interaction.guild.id, { voiceEnabled: !cfg.voiceEnabled });
    return refreshLevelsPanel(interaction);
  }
  if (id === "lvl_toggle_stack") {
    await setLevelConfig(interaction.guild.id, { stackRewards: !cfg.stackRewards });
    return refreshLevelsPanel(interaction);
  }

  if (id === "lvl_open_xp_modal") {
    const modal = new ModalBuilder().setCustomId("lvl_xp_modal").setTitle("Valeurs d'XP").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("xpmin").setLabel("XP min par message").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.minXp)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("xpmax").setLabel("XP max par message").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.maxXp)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("cooldown").setLabel("Cooldown messages (secondes)").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.cooldownSec)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("voicexp").setLabel("XP vocal par minute").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.voiceXpPerMin)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "lvl_open_reward_modal") {
    const modal = new ModalBuilder().setCustomId("lvl_reward_modal").setTitle("Ajouter / retirer une récompense").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("niveau").setLabel("Niveau (ex: 10)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("10"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("role")
          .setLabel("Rôle : @mention, ID ou nom (vide = retirer)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("@VIP  ou  123456789012345678  ou  VIP"),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "lvl_resync") {
    await interaction.reply({ content: "🔄 Resync en cours…", flags: EPHEMERAL });
    const r = await resyncAllRewards(interaction.guild);
    await logAudit(interaction.guild, `🔁 <@${interaction.user.id}> a resync les niveaux via le panneau (${r.changed} mis à jour).`);
    return interaction.editReply(
      r.total === 0
        ? "Aucun membre avec de l'XP à resync."
        : `Resync terminé : **${r.changed}** membre(s) mis à jour, ${r.skipped} absent(s).`,
    );
  }
}

// ---------- Menus du panneau ----------

async function handleLevelsPanelSelect(interaction, ctx) {
  if (interaction.customId === "lvl_announce_channel") {
    await setLevelConfig(interaction.guild.id, { announceChannelId: interaction.values[0], announceMode: "channel" });
    return refreshLevelsPanel(interaction);
  }
  if (interaction.customId === "lvl_announce_mode") {
    await setLevelConfig(interaction.guild.id, { announceMode: interaction.values[0] });
    return refreshLevelsPanel(interaction);
  }
}

// ---------- Modals du panneau ----------

function parseRoleInput(guild, input) {
  if (!input) return { role: null, empty: true };
  const idMatch = input.match(/(\d{5,})/); // ID brut ou mention <@&ID>
  if (idMatch) {
    const r = guild.roles.cache.get(idMatch[1]);
    if (r) return { role: r, empty: false };
  }
  const byName = guild.roles.cache.find((r) => r.name.toLowerCase() === input.trim().toLowerCase());
  return { role: byName ?? null, empty: false };
}

async function handleLevelsPanelModal(interaction, ctx) {
  if (interaction.customId === "lvl_xp_modal") {
    const patch = {};
    const num = (key) => {
      const raw = interaction.fields.getTextInputValue(key)?.trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.floor(n) : null;
    };
    const xpmin = num("xpmin");
    const xpmax = num("xpmax");
    const cooldown = num("cooldown");
    const voicexp = num("voicexp");

    if (xpmin !== null) patch.minXp = Math.max(1, xpmin);
    if (xpmax !== null) patch.maxXp = Math.max(1, xpmax);
    if (cooldown !== null) patch.cooldownSec = Math.max(0, cooldown);
    if (voicexp !== null) patch.voiceXpPerMin = Math.max(0, voicexp);

    // Coherence min <= max.
    if (patch.minXp != null && patch.maxXp != null && patch.minXp > patch.maxXp) {
      const t = patch.minXp;
      patch.minXp = patch.maxXp;
      patch.maxXp = t;
    }

    await setLevelConfig(interaction.guild.id, patch);
    if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
    return interaction.reply({ content: "Valeurs d'XP mises à jour. ✅", flags: EPHEMERAL });
  }

  if (interaction.customId === "lvl_reward_modal") {
    const niveauRaw = interaction.fields.getTextInputValue("niveau")?.trim();
    const roleRaw = interaction.fields.getTextInputValue("role")?.trim();
    const niveau = Number(niveauRaw);

    if (!Number.isInteger(niveau) || niveau < 1) {
      return interaction.reply({ content: "Niveau invalide. Indique un entier ≥ 1.", flags: EPHEMERAL });
    }

    const { role, empty } = parseRoleInput(interaction.guild, roleRaw);

    if (empty) {
      // Retrait de la recompense pour ce niveau.
      await setReward(interaction.guild.id, niveau, null);
      if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
      return interaction.reply({ content: `Récompense du niveau ${niveau} retirée. ✅`, flags: EPHEMERAL });
    }

    if (!role) {
      return interaction.reply({ content: `Rôle introuvable pour « ${roleRaw} ». Donne une @mention, un ID ou le nom exact.`, flags: EPHEMERAL });
    }
    const me = interaction.guild.members.me;
    if (me && role.position >= me.roles.highest.position) {
      return interaction.reply({
        content: `Je ne peux pas attribuer <@&${role.id}> : ce rôle est au-dessus du mien dans la hiérarchie. Place mon rôle plus haut puis réessaie.`,
        flags: EPHEMERAL,
      });
    }

    await setReward(interaction.guild.id, niveau, role.id);
    if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
    return interaction.reply({ content: `Récompense définie : niveau ${niveau} → <@&${role.id}>. ✅`, flags: EPHEMERAL });
  }
}

// ====================================================================
// Panneau interactif /setup-tiktok
// ====================================================================

async function buildTikTokPanel(guildId) {
  const cfg = await getTikTokConfig(guildId);
  const userTxt = cfg.username ? `**@${cfg.username.replace(/^@+/, "")}**` : "*(non défini)*";
  const feedTxt = cfg.feedUrl ? "✅ défini" : "❌ manquant";
  const chanTxt = cfg.channelId ? `<#${cfg.channelId}>` : "*(non défini)*";
  const roleTxt = cfg.roleId ? `<@&${cfg.roleId}>` : "*(aucun ping)*";

  const embed = new EmbedBuilder()
    .setTitle("📱 Notifications TikTok")
    .setColor(cfg.enabled ? 0x69c9d0 : 0x747f8d)
    .setDescription(
      "Le bot poste automatiquement les **nouvelles vidéos** d'un compte TikTok dans un salon, avec un ping de rôle.\n\n" +
        "**Comment ça marche :** TikTok ne fournit pas d'accès direct gratuit. Tu génères un **flux RSS** du compte " +
        "(via un service gratuit comme **rss.app**) et tu colles l'URL ici. Le bot lit ce flux.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Flux RSS", value: feedTxt, inline: true },
      { name: "Vérification", value: `toutes les **${cfg.pollIntervalMin} min**`, inline: true },
      { name: "Pseudo affiché", value: userTxt, inline: true },
      { name: "Salon", value: chanTxt, inline: true },
      { name: "Rôle pingé", value: roleTxt, inline: true },
    )
    .setFooter({ text: "Le bouton Tester poste la dernière publication du flux dans le salon." });

  const rowChannel = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tt_channel")
      .setPlaceholder("📢 Salon où poster les vidéos")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowRole = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId("tt_role").setPlaceholder("🔔 Rôle à ping (optionnel)").setMinValues(0).setMaxValues(1),
  );
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tt_set_feed").setLabel("Flux & pseudo").setEmoji("🔗").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tt_interval").setLabel("Intervalle").setEmoji("⏱️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tt_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("tt_test").setLabel("Tester").setEmoji("🧪").setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowChannel, rowRole, rowButtons] };
}

async function handleSetupTikTok(interaction, ctx) {
  const panel = await buildTikTokPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshTikTokPanel(interaction) {
  return interaction.update(await buildTikTokPanel(interaction.guild.id));
}

async function handleTikTokPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getTikTokConfig(interaction.guild.id);

  if (id === "tt_toggle") {
    if (!cfg.enabled && (!cfg.feedUrl || !cfg.channelId)) {
      return interaction.reply({
        content: "Définis d'abord un **flux RSS** et un **salon** avant d'activer.",
        flags: EPHEMERAL,
      });
    }
    await setTikTokConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshTikTokPanel(interaction);
  }

  if (id === "tt_set_feed") {
    const modal = new ModalBuilder().setCustomId("tt_feed_modal").setTitle("Flux RSS TikTok").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("feedurl")
          .setLabel("URL du flux RSS (rss.app, etc.)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("https://rss.app/feeds/xxxxx.xml")
          .setValue(cfg.feedUrl || ""),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("username")
          .setLabel("Pseudo TikTok affiché (optionnel, sans @)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("brawlhalla")
          .setValue(cfg.username || ""),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("avatar")
          .setLabel("URL photo de profil (optionnel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("clic droit sur la PP TikTok > copier l'image")
          .setValue(cfg.avatarUrl || ""),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tt_interval") {
    const modal = new ModalBuilder().setCustomId("tt_interval_modal").setTitle("Fréquence de vérification").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("interval")
          .setLabel("Minutes entre deux vérifications (min. 2)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg.pollIntervalMin)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tt_test") {
    await interaction.reply({ content: "🧪 Test en cours…", flags: EPHEMERAL });
    const r = await tiktokPostTest(interaction.client, interaction.guild.id);
    if (r.ok) {
      return interaction.editReply(`✅ Test réussi — dernière vidéo postée dans <#${cfg.channelId}>.`);
    }
    return interaction.editReply(`❌ Test échoué : ${r.reason}`);
  }
}

async function handleTikTokPanelSelect(interaction, ctx) {
  if (interaction.customId === "tt_channel") {
    await setTikTokConfig(interaction.guild.id, { channelId: interaction.values[0] });
    return refreshTikTokPanel(interaction);
  }
  if (interaction.customId === "tt_role") {
    // minValues=0 : si rien n'est choisi, on retire le ping.
    await setTikTokConfig(interaction.guild.id, { roleId: interaction.values[0] || "" });
    return refreshTikTokPanel(interaction);
  }
}

async function handleTikTokPanelModal(interaction, ctx) {
  if (interaction.customId === "tt_feed_modal") {
    const feedUrl = interaction.fields.getTextInputValue("feedurl")?.trim();
    const username = interaction.fields.getTextInputValue("username")?.trim().replace(/^@+/, "") || "";
    const avatarUrl = interaction.fields.getTextInputValue("avatar")?.trim() || "";
    if (!/^https?:\/\/\S+$/i.test(feedUrl)) {
      return interaction.reply({ content: "URL invalide. Donne une URL http(s) complète vers le flux RSS.", flags: EPHEMERAL });
    }
    if (avatarUrl && !/^https?:\/\/\S+$/i.test(avatarUrl)) {
      return interaction.reply({ content: "URL de photo de profil invalide (doit commencer par http).", flags: EPHEMERAL });
    }

    // Vérifie que le flux est lisible et contient des publications.
    let items;
    try {
      items = await fetchFeedItems(feedUrl);
    } catch (err) {
      return interaction.reply({ content: `Impossible de lire ce flux : ${err.message}`, flags: EPHEMERAL });
    }
    if (!items.length) {
      return interaction.reply({ content: "Ce flux ne contient aucune publication lisible.", flags: EPHEMERAL });
    }
    // On repart du dernier item connu pour ne pas reposter l'historique.
    await setTikTokConfig(interaction.guild.id, { feedUrl, username, avatarUrl, lastItemId: items[0].id });
    if (interaction.isFromMessage()) return refreshTikTokPanel(interaction);
    return interaction.reply({ content: "Flux enregistré ✅", flags: EPHEMERAL });
  }

  if (interaction.customId === "tt_interval_modal") {
    const n = Number(interaction.fields.getTextInputValue("interval")?.trim());
    if (!Number.isFinite(n) || n < 2) {
      return interaction.reply({ content: "Valeur invalide (minimum 2 minutes).", flags: EPHEMERAL });
    }
    await setTikTokConfig(interaction.guild.id, { pollIntervalMin: Math.floor(n) });
    if (interaction.isFromMessage()) return refreshTikTokPanel(interaction);
    return interaction.reply({ content: `Vérification toutes les ${Math.floor(n)} min. ✅`, flags: EPHEMERAL });
  }
}

// ====================================================================
// Panneau interactif /setup-clips
// ====================================================================

async function buildClipsPanel(guildId) {
  const cfg = await getClipsConfig(guildId);
  const chans = cfg.channelIds.length ? cfg.channelIds.map((id) => `<#${id}>`).join(" ") : "*(aucun)*";
  const reacts = cfg.reactions.length ? cfg.reactions.join(" ") : "*(aucune)*";

  const embed = new EmbedBuilder()
    .setTitle("🎬 Réactions auto sur les clips")
    .setColor(cfg.enabled ? 0xe67e22 : 0x747f8d)
    .setDescription(
      "Le bot ajoute automatiquement des réactions à chaque clip posté dans les salons choisis, " +
        "pour que la commu puisse **noter** (le nombre de réactions = le score).\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Réactions", value: reacts, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Salons surveillés", value: chans, inline: false },
      { name: "Ignorer les bots", value: cfg.ignoreBots ? "oui" : "non", inline: true },
      { name: "Ignorer les réponses", value: cfg.ignoreReplies ? "oui" : "non", inline: true },
      { name: "Vidéos uniquement", value: cfg.requireVideo ? "✅ oui" : "non (tous les posts)", inline: true },
      { name: "Supprimer les non-vidéos", value: cfg.deleteNonVideo ? "🗑️ oui" : "non", inline: true },
      {
        name: "Domaines vidéo perso",
        value: cfg.extraDomains?.length ? cfg.extraDomains.join(", ") : "*(seulement les hébergeurs par défaut)*",
        inline: false,
      },
    )
    .setFooter({ text: "« Supprimer les non-vidéos » nécessite que le bot ait la permission Gérer les messages." });

  const rowChannels = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("clp_channels")
      .setPlaceholder("📂 Salons de clips à surveiller")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(10),
  );
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("clp_set_reactions").setLabel("Réactions").setEmoji("⭐").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clp_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("clp_toggle_bots")
      .setLabel(cfg.ignoreBots ? "Bots: ignorés" : "Bots: inclus")
      .setEmoji("🤖")
      .setStyle(cfg.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("clp_toggle_replies")
      .setLabel(cfg.ignoreReplies ? "Réponses: ignorées" : "Réponses: incluses")
      .setEmoji("💬")
      .setStyle(cfg.ignoreReplies ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("clp_toggle_video")
      .setLabel(cfg.requireVideo ? "Vidéos only" : "Tous posts")
      .setEmoji("🎥")
      .setStyle(cfg.requireVideo ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const rowButtons2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("clp_toggle_delete")
      .setLabel(cfg.deleteNonVideo ? "Supprime les non-vidéos" : "Ne supprime pas")
      .setEmoji("🗑️")
      .setStyle(cfg.deleteNonVideo ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("clp_domains").setLabel("Domaines vidéo").setEmoji("🌐").setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowChannels, rowButtons, rowButtons2] };
}

async function handleSetupClips(interaction, ctx) {
  const panel = await buildClipsPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshClipsPanel(interaction) {
  return interaction.update(await buildClipsPanel(interaction.guild.id));
}

async function handleClipsPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getClipsConfig(interaction.guild.id);

  if (id === "clp_toggle") {
    if (!cfg.enabled && (!cfg.channelIds.length || !cfg.reactions.length)) {
      return interaction.reply({ content: "Définis d'abord au moins un **salon** et des **réactions** avant d'activer.", flags: EPHEMERAL });
    }
    await setClipsConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshClipsPanel(interaction);
  }
  if (id === "clp_toggle_bots") {
    await setClipsConfig(interaction.guild.id, { ignoreBots: !cfg.ignoreBots });
    return refreshClipsPanel(interaction);
  }
  if (id === "clp_toggle_replies") {
    await setClipsConfig(interaction.guild.id, { ignoreReplies: !cfg.ignoreReplies });
    return refreshClipsPanel(interaction);
  }
  if (id === "clp_toggle_video") {
    await setClipsConfig(interaction.guild.id, { requireVideo: !cfg.requireVideo });
    return refreshClipsPanel(interaction);
  }
  if (id === "clp_toggle_delete") {
    await setClipsConfig(interaction.guild.id, { deleteNonVideo: !cfg.deleteNonVideo });
    return refreshClipsPanel(interaction);
  }
  if (id === "clp_domains") {
    const modal = new ModalBuilder().setCustomId("clp_domains_modal").setTitle("Domaines vidéo acceptés").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("domains")
          .setLabel("Domaines en plus (séparés par virgule/espace)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("catbox.moe, dubz.gg, monhebergeur.com")
          .setValue((cfg.extraDomains || []).join(", ")),
      ),
    );
    return interaction.showModal(modal);
  }
  if (id === "clp_set_reactions") {
    const modal = new ModalBuilder().setCustomId("clp_reactions_modal").setTitle("Réactions des clips").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reactions")
          .setLabel("Emojis séparés par un espace (max 20)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("🔥 👍 👎  (ou emojis du serveur)")
          .setValue(cfg.reactions.join(" ")),
      ),
    );
    return interaction.showModal(modal);
  }
}

async function handleClipsPanelSelect(interaction, ctx) {
  if (interaction.customId === "clp_channels") {
    await setClipsConfig(interaction.guild.id, { channelIds: interaction.values });
    return refreshClipsPanel(interaction);
  }
}

async function handleClipsPanelModal(interaction, ctx) {
  if (interaction.customId === "clp_reactions_modal") {
    const raw = interaction.fields.getTextInputValue("reactions");
    const reactions = parseReactions(raw);
    if (!reactions.length) {
      return interaction.reply({ content: "Aucun emoji valide détecté. Réessaie avec des emojis séparés par un espace.", flags: EPHEMERAL });
    }
    await setClipsConfig(interaction.guild.id, { reactions });
    if (interaction.isFromMessage()) return refreshClipsPanel(interaction);
    return interaction.reply({ content: `Réactions définies : ${reactions.join(" ")} ✅`, flags: EPHEMERAL });
  }

  if (interaction.customId === "clp_domains_modal") {
    const domains = parseDomains(interaction.fields.getTextInputValue("domains"));
    await setClipsConfig(interaction.guild.id, { extraDomains: domains });
    if (interaction.isFromMessage()) return refreshClipsPanel(interaction);
    return interaction.reply({
      content: domains.length ? `Domaines acceptés en plus : ${domains.join(", ")} ✅` : "Domaines perso effacés (hébergeurs par défaut seulement).",
      flags: EPHEMERAL,
    });
  }
}

// ====================================================================
// Panneau interactif /setup-tempvoice
// ====================================================================

async function buildTempVoicePanel(guildId) {
  const cfg = await getTempConfig(guildId);
  const catTxt = cfg.categoryId ? `<#${cfg.categoryId}>` : "*(même que chaque hub)*";
  const hubEntries = Object.entries(cfg.hubs || {});
  const hubsTxt = hubEntries.length
    ? hubEntries
        .map(([id, h]) => `• <#${id}> → \`${h.nameTemplate}\`${h.userLimit ? ` (max ${h.userLimit})` : ""}`)
        .join("\n")
    : "*(aucun hub configuré)*";

  const embed = new EmbedBuilder()
    .setTitle("🔊 Salons vocaux temporaires")
    .setColor(cfg.enabled ? 0x1abc9c : 0x747f8d)
    .setDescription(
      "Configure plusieurs **hubs** : chacun crée un salon avec son propre nom.\n" +
        "Ex : un hub « Crée 1v1 » qui nomme les salons `{user} 1v1`.\n" +
        "Le salon est supprimé automatiquement quand il est vide.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Catégorie des salons créés", value: catTxt, inline: true },
      { name: `Hubs configurés (${hubEntries.length})`, value: hubsTxt, inline: false },
    )
    .setFooter({ text: "Ajoute un hub : choisis un salon vocal → règle son nom. {user} = pseudo." });

  const rowAddHub = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tv_add_hub")
      .setPlaceholder("➕ Ajouter/configurer un hub (salon vocal)")
      .setChannelTypes(ChannelType.GuildVoice)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowCat = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tv_category")
      .setPlaceholder("📂 Catégorie des salons créés (optionnel)")
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1),
  );

  const rows = [rowAddHub, rowCat];

  // Menu de suppression : seulement s'il y a des hubs.
  if (hubEntries.length) {
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId("tv_remove_hub")
      .setPlaceholder("🗑️ Retirer un hub")
      .addOptions(
        hubEntries.slice(0, 25).map(([id, h]) => ({
          label: `${h.nameTemplate}`.slice(0, 100),
          description: `Retirer ce hub`,
          value: id,
        })),
      );
    rows.push(new ActionRowBuilder().addComponents(removeSelect));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("tv_toggle")
        .setLabel(cfg.enabled ? "Activé" : "Désactivé")
        .setEmoji(cfg.enabled ? "🟢" : "🔴")
        .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    ),
  );

  return { embeds: [embed], components: rows };
}

async function handleSetupTempVoice(interaction, ctx) {
  const panel = await buildTempVoicePanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshTempVoicePanel(interaction) {
  return interaction.update(await buildTempVoicePanel(interaction.guild.id));
}

async function handleTempVoicePanelButton(interaction, ctx) {
  if (interaction.customId === "tv_toggle") {
    const cfg = await getTempConfig(interaction.guild.id);
    if (!cfg.enabled && !Object.keys(cfg.hubs || {}).length) {
      return interaction.reply({ content: "Ajoute d'abord au moins un **hub** avant d'activer.", flags: EPHEMERAL });
    }
    await setTempConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshTempVoicePanel(interaction);
  }
}

async function handleTempVoicePanelSelect(interaction, ctx) {
  // Choix d'un salon hub a ajouter -> ouvre un modal pour le nom + la limite.
  if (interaction.customId === "tv_add_hub") {
    const channelId = interaction.values[0];
    const cfg = await getTempConfig(interaction.guild.id);
    const existing = cfg.hubs?.[channelId];
    const modal = new ModalBuilder().setCustomId(`tv_hub_modal:${channelId}`).setTitle("Configurer ce hub").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nom des salons ({user} = pseudo)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("{user} 1v1")
          .setValue(existing?.nameTemplate || "🎮 {user}"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit")
          .setLabel("Limite de membres (0 = illimité, max 99)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(existing?.userLimit || 0)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (interaction.customId === "tv_category") {
    await setTempConfig(interaction.guild.id, { categoryId: interaction.values[0] || "" });
    return refreshTempVoicePanel(interaction);
  }

  if (interaction.customId === "tv_remove_hub") {
    await removeHub(interaction.guild.id, interaction.values[0]);
    return refreshTempVoicePanel(interaction);
  }
}

async function handleTempVoicePanelModal(interaction, ctx) {
  if (interaction.customId.startsWith("tv_hub_modal:")) {
    const channelId = interaction.customId.split(":")[1];
    const name = interaction.fields.getTextInputValue("name")?.trim().slice(0, 95) || "🎮 {user}";
    const n = Number(interaction.fields.getTextInputValue("limit")?.trim());
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      return interaction.reply({ content: "Limite invalide (0 à 99).", flags: EPHEMERAL });
    }
    await addHub(interaction.guild.id, channelId, { nameTemplate: name, userLimit: Math.floor(n) });
    if (interaction.isFromMessage()) return refreshTempVoicePanel(interaction);
    return interaction.reply({ content: `Hub <#${channelId}> configuré : \`${name}\` ✅`, flags: EPHEMERAL });
  }
}

// ====================================================================
// Contrôles du salon vocal temporaire (panneau dans le chat de la voc)
// ====================================================================

// Renvoie { channel, owner } si le salon courant est un salon temporaire, sinon répond une erreur.
async function vcContext(interaction) {
  const channel = interaction.channel;
  const owner = await getTempOwner(interaction.guild.id, channel?.id);
  if (!owner) {
    await interaction.reply({ content: "Ce salon n'est pas un salon vocal temporaire.", flags: EPHEMERAL });
    return null;
  }
  return { channel, owner };
}

function vcIsOwner(interaction, owner) {
  return interaction.user.id === owner || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
}

async function handleVoiceControlButton(interaction, ctx) {
  const c = await vcContext(interaction);
  if (!c) return;
  const { channel, owner } = c;
  const id = interaction.customId;

  // Réclamer : autorisé si le créateur n'est plus dans le salon.
  if (id === "vc_claim") {
    if (channel.members?.has(owner)) {
      return interaction.reply({ content: "Le créateur est toujours dans le salon.", flags: EPHEMERAL });
    }
    if (!channel.members?.has(interaction.user.id)) {
      return interaction.reply({ content: "Tu dois être dans le salon pour le réclamer.", flags: EPHEMERAL });
    }
    await setTempOwner(interaction.guild.id, channel.id, interaction.user.id);
    await channel.permissionOverwrites
      .edit(interaction.user.id, { ManageChannels: true, MoveMembers: true, MuteMembers: true })
      .catch(() => {});
    return interaction.reply({ content: `👑 <@${interaction.user.id}> est maintenant propriétaire de ce salon.` });
  }

  if (!vcIsOwner(interaction, owner)) {
    return interaction.reply({ content: "Réservé au créateur du salon. (Utilise 👑 Réclamer s'il est parti.)", flags: EPHEMERAL });
  }

  if (id === "vc_lock") {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false }).catch(() => {});
    return interaction.reply({ content: "🔒 Salon **verrouillé** — seuls les membres autorisés peuvent rejoindre." });
  }
  if (id === "vc_unlock") {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: null }).catch(() => {});
    return interaction.reply({ content: "🔓 Salon **ouvert** à tous." });
  }
  if (id === "vc_limit") {
    const modal = new ModalBuilder().setCustomId("vc_limit_modal").setTitle("Limite de membres").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit")
          .setLabel("Nombre max (0 = illimité, max 99)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(channel.userLimit || 0)),
      ),
    );
    return interaction.showModal(modal);
  }
  if (id === "vc_rename") {
    const modal = new ModalBuilder().setCustomId("vc_rename_modal").setTitle("Renommer le salon").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nouveau nom")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(95)
          .setValue(channel.name || ""),
      ),
    );
    return interaction.showModal(modal);
  }
  if (id === "vc_block" || id === "vc_permit") {
    const block = id === "vc_block";
    const select = new UserSelectMenuBuilder()
      .setCustomId(block ? "vc_block_select" : "vc_permit_select")
      .setPlaceholder(block ? "Membre à bloquer" : "Membre à autoriser")
      .setMinValues(1)
      .setMaxValues(1);
    return interaction.reply({
      content: block ? "⛔ Choisis le membre à bloquer :" : "✅ Choisis le membre à autoriser :",
      components: [new ActionRowBuilder().addComponents(select)],
      flags: EPHEMERAL,
    });
  }
}

async function handleVoiceControlSelect(interaction, ctx) {
  const c = await vcContext(interaction);
  if (!c) return;
  const { channel, owner } = c;
  if (!vcIsOwner(interaction, owner)) {
    return interaction.reply({ content: "Réservé au créateur du salon.", flags: EPHEMERAL });
  }
  const targetId = interaction.values[0];

  if (interaction.customId === "vc_block_select") {
    await channel.permissionOverwrites.edit(targetId, { Connect: false, ViewChannel: true }).catch(() => {});
    const m = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (m && m.voice?.channelId === channel.id) await m.voice.disconnect("Bloqué du salon temporaire").catch(() => {});
    return interaction.update({ content: `⛔ <@${targetId}> est **bloqué** de ce salon.`, components: [] });
  }
  if (interaction.customId === "vc_permit_select") {
    await channel.permissionOverwrites.edit(targetId, { Connect: true, ViewChannel: true }).catch(() => {});
    return interaction.update({ content: `✅ <@${targetId}> peut **rejoindre** ce salon.`, components: [] });
  }
}

async function handleVoiceControlModal(interaction, ctx) {
  const c = await vcContext(interaction);
  if (!c) return;
  const { channel, owner } = c;
  if (!vcIsOwner(interaction, owner)) {
    return interaction.reply({ content: "Réservé au créateur du salon.", flags: EPHEMERAL });
  }

  if (interaction.customId === "vc_limit_modal") {
    const n = Number(interaction.fields.getTextInputValue("limit")?.trim());
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      return interaction.reply({ content: "Valeur invalide (0 à 99).", flags: EPHEMERAL });
    }
    await channel.setUserLimit(Math.floor(n)).catch(() => {});
    return interaction.reply({ content: `👥 Limite réglée sur **${Math.floor(n) || "illimité"}**.` });
  }
  if (interaction.customId === "vc_rename_modal") {
    const name = interaction.fields.getTextInputValue("name")?.trim().slice(0, 95);
    if (!name) return interaction.reply({ content: "Nom vide.", flags: EPHEMERAL });
    await channel.setName(name).catch(() => {});
    return interaction.reply({ content: `✏️ Salon renommé en **${name}**.` });
  }
}

// ====================================================================
// Panneau interactif /setup-guessrank  (réactions emojis de rank)
// ====================================================================

async function buildGuessRankPanel(guildId) {
  const cfg = await getGuessRankConfig(guildId);
  const chans = cfg.channelIds.length ? cfg.channelIds.map((id) => `<#${id}>`).join(" ") : "*(aucun)*";
  const reacts = cfg.reactions.length ? cfg.reactions.join(" ") : "*(aucune — ajoute tes emojis de rank)*";

  const embed = new EmbedBuilder()
    .setTitle("🏅 Devine ton rang")
    .setColor(cfg.enabled ? 0x9b59b6 : 0x747f8d)
    .setDescription(
      "Le bot ajoute des **emojis de rank** à chaque clip posté, pour que la commu **vote le rang** du joueur " +
        "(le rank avec le plus de votes = l'estimation).\n\n" +
        "👉 Uploade tes emojis de rank custom (Tin, Bronze… Valhallan) dans **Paramètres du serveur → Émojis**, " +
        "puis ajoute-les via le bouton **Réactions** ci-dessous.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Vidéos uniquement", value: cfg.requireVideo ? "✅ oui" : "non", inline: true },
      { name: "Supprimer non-vidéos", value: cfg.deleteNonVideo ? "🗑️ oui" : "non", inline: true },
      { name: "Un seul vote / membre", value: cfg.singleVote ? "✅ oui" : "non", inline: true },
      { name: "Emojis de rank", value: reacts, inline: false },
      { name: "Salons surveillés", value: chans, inline: false },
      {
        name: "Domaines vidéo perso",
        value: cfg.extraDomains?.length ? cfg.extraDomains.join(", ") : "*(hébergeurs par défaut)*",
        inline: false,
      },
    )
    .setFooter({ text: "Mets ici un salon différent du salon clips classique (sinon double réactions)." });

  const rowChannels = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("gr_channels")
      .setPlaceholder("📂 Salons « devine ton rang »")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(10),
  );
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("gr_set_reactions").setLabel("Emojis de rank").setEmoji("🏅").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("gr_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("gr_toggle_video")
      .setLabel(cfg.requireVideo ? "Vidéos only" : "Tous posts")
      .setEmoji("🎥")
      .setStyle(cfg.requireVideo ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("gr_toggle_delete")
      .setLabel(cfg.deleteNonVideo ? "Supprime non-vidéos" : "Ne supprime pas")
      .setEmoji("🗑️")
      .setStyle(cfg.deleteNonVideo ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("gr_domains").setLabel("Domaines").setEmoji("🌐").setStyle(ButtonStyle.Secondary),
  );
  const rowButtons2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("gr_toggle_replies")
      .setLabel(cfg.ignoreReplies ? "Réponses: ignorées" : "Réponses: incluses")
      .setEmoji("💬")
      .setStyle(cfg.ignoreReplies ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("gr_toggle_bots")
      .setLabel(cfg.ignoreBots ? "Bots: ignorés" : "Bots: inclus")
      .setEmoji("🤖")
      .setStyle(cfg.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("gr_toggle_single")
      .setLabel(cfg.singleVote ? "1 vote / membre" : "Votes multiples")
      .setEmoji("☝️")
      .setStyle(cfg.singleVote ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowChannels, rowButtons, rowButtons2] };
}

async function handleSetupGuessRank(interaction, ctx) {
  return interaction.reply({ ...(await buildGuessRankPanel(interaction.guild.id)), flags: EPHEMERAL });
}

async function refreshGuessRankPanel(interaction) {
  return interaction.update(await buildGuessRankPanel(interaction.guild.id));
}

async function handleGuessRankPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getGuessRankConfig(interaction.guild.id);

  if (id === "gr_toggle") {
    if (!cfg.enabled && (!cfg.channelIds.length || !cfg.reactions.length)) {
      return interaction.reply({ content: "Définis d'abord un **salon** et les **emojis de rank** avant d'activer.", flags: EPHEMERAL });
    }
    await setGuessRankConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_toggle_video") {
    await setGuessRankConfig(interaction.guild.id, { requireVideo: !cfg.requireVideo });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_toggle_delete") {
    await setGuessRankConfig(interaction.guild.id, { deleteNonVideo: !cfg.deleteNonVideo });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_toggle_bots") {
    await setGuessRankConfig(interaction.guild.id, { ignoreBots: !cfg.ignoreBots });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_toggle_replies") {
    await setGuessRankConfig(interaction.guild.id, { ignoreReplies: !cfg.ignoreReplies });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_toggle_single") {
    await setGuessRankConfig(interaction.guild.id, { singleVote: !cfg.singleVote });
    return refreshGuessRankPanel(interaction);
  }
  if (id === "gr_set_reactions") {
    const modal = new ModalBuilder().setCustomId("gr_reactions_modal").setTitle("Emojis de rank").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reactions")
          .setLabel("Tes emojis de rank, séparés par un espace")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("<:tin:123> <:bronze:456> <:silver:789> ...")
          .setValue(cfg.reactions.join(" ")),
      ),
    );
    return interaction.showModal(modal);
  }
  if (id === "gr_domains") {
    const modal = new ModalBuilder().setCustomId("gr_domains_modal").setTitle("Domaines vidéo acceptés").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("domains")
          .setLabel("Domaines en plus (séparés par virgule/espace)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("catbox.moe, dubz.gg")
          .setValue((cfg.extraDomains || []).join(", ")),
      ),
    );
    return interaction.showModal(modal);
  }
}

async function handleGuessRankPanelSelect(interaction, ctx) {
  if (interaction.customId === "gr_channels") {
    await setGuessRankConfig(interaction.guild.id, { channelIds: interaction.values });
    return refreshGuessRankPanel(interaction);
  }
}

async function handleGuessRankPanelModal(interaction, ctx) {
  if (interaction.customId === "gr_reactions_modal") {
    const reactions = parseReactions(interaction.fields.getTextInputValue("reactions"));
    if (!reactions.length) {
      return interaction.reply({ content: "Aucun emoji valide détecté.", flags: EPHEMERAL });
    }
    await setGuessRankConfig(interaction.guild.id, { reactions });
    if (interaction.isFromMessage()) return refreshGuessRankPanel(interaction);
    return interaction.reply({ content: `Emojis de rank définis : ${reactions.join(" ")} ✅`, flags: EPHEMERAL });
  }
  if (interaction.customId === "gr_domains_modal") {
    const domains = parseDomains(interaction.fields.getTextInputValue("domains"));
    await setGuessRankConfig(interaction.guild.id, { extraDomains: domains });
    if (interaction.isFromMessage()) return refreshGuessRankPanel(interaction);
    return interaction.reply({ content: domains.length ? `Domaines : ${domains.join(", ")} ✅` : "Domaines perso effacés.", flags: EPHEMERAL });
  }
}

// ====================================================================
// Tournoi : panneau d'inscription + interactions des membres
// ====================================================================

async function handleTournoiPanneau(interaction, ctx) {
  const t = await getTournament(interaction.guild.id);
  if (!t) {
    return interaction.reply({ content: "Aucun tournoi configuré. Crée-le d'abord dans le dashboard (section Tournoi).", flags: EPHEMERAL });
  }
  const msg = await interaction.channel.send(buildSignupPayload(t));
  await updateTournament(interaction.guild.id, { signupChannelId: interaction.channel.id, signupMessageId: msg.id });
  return interaction.reply({ content: "Panneau d'inscription publié ✅", flags: EPHEMERAL });
}

// ---------- /bracket : bracket en image ----------

async function handleBracket(interaction, ctx) {
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

async function handleCaster(interaction, ctx) {
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

async function handleCastGo(interaction, ctx) {
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

async function handleTournamentButton(interaction, ctx) {
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
          await tournamentAnnounce(interaction.client, guildId, `✅ Match terminé : **${w}** l'emporte ${r.match.scoreA}-${r.match.scoreB} !`);
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

async function handleTournamentSelect(interaction, ctx) {
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

async function handleTournamentModal(interaction, ctx) {
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
