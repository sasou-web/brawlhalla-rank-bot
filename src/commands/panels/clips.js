import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { getClipsConfig, setClipsConfig, parseReactions, parseDomains } from "../../clips.js";
import { EPHEMERAL } from "../shared.js";

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

export async function handleSetupClips(interaction, ctx) {
  const panel = await buildClipsPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshClipsPanel(interaction) {
  return interaction.update(await buildClipsPanel(interaction.guild.id));
}

export async function handleClipsPanelButton(interaction, ctx) {
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

export async function handleClipsPanelSelect(interaction, ctx) {
  if (interaction.customId === "clp_channels") {
    await setClipsConfig(interaction.guild.id, { channelIds: interaction.values });
    return refreshClipsPanel(interaction);
  }
}

export async function handleClipsPanelModal(interaction, ctx) {
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
