import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { TIERS } from "../config.js";
import { WEAPON_META } from "../combos.js";

// Definitions (JSON) de toutes les slash commands du bot.
// Donnees pures : aucune logique de handler ici. Le routage est dans commands.js,
// et l'enregistrement Discord se fait via deploy-commands.js (qui importe commandsData).
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
    .setName("help")
    .setDescription("Liste les commandes les plus utiles du bot.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("Affiche tes succès débloqués (ou ceux d'un membre).")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à inspecter (defaut : toi).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("combos")
    .setDescription("Parcours les true combos Brawlhalla par arme (vidéos via BrawlDatabase).")
    .addStringOption((o) =>
      o
        .setName("arme")
        .setDescription("Arme de départ (sinon la première).")
        .addChoices(
          ...Object.entries(WEAPON_META).map(([slug, m]) => ({ name: m.label, value: slug })),
        )
        .setRequired(false),
    )
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
    .setName("setup-succes")
    .setDescription("(Admin) Définit le salon où sont annoncés les succès (sans ping).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName("salon")
        .setDescription("Salon des annonces de succès (laisse vide pour désactiver).")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
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
    .setName("setup-tickets")
    .setDescription("(Admin) Panneau du système de tickets de support.")
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
