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
import { getGuessRankConfig, setGuessRankConfig } from "../../guessrank.js";
import { parseReactions, parseDomains } from "../../clips.js";
import { EPHEMERAL } from "../shared.js";

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

export async function handleSetupGuessRank(interaction, ctx) {
  return interaction.reply({ ...(await buildGuessRankPanel(interaction.guild.id)), flags: EPHEMERAL });
}

async function refreshGuessRankPanel(interaction) {
  return interaction.update(await buildGuessRankPanel(interaction.guild.id));
}

export async function handleGuessRankPanelButton(interaction, ctx) {
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

export async function handleGuessRankPanelSelect(interaction, ctx) {
  if (interaction.customId === "gr_channels") {
    await setGuessRankConfig(interaction.guild.id, { channelIds: interaction.values });
    return refreshGuessRankPanel(interaction);
  }
}

export async function handleGuessRankPanelModal(interaction, ctx) {
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
