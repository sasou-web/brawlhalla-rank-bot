import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  TextDisplayBuilder,
  MessageFlags,
} from "discord.js";
import * as discordTranscripts from "discord-html-transcripts";
import {
  getTicketConfig,
  setTicketConfig,
  addTopic,
  removeTopic,
  getTopic,
  nextTicketNumber,
  addOpenTicket,
  removeOpenTicket,
  getOpenTicket,
  setTicketClaim,
  countOpenByOwner,
  buildTicketPanelPayload,
  buildTicketContainer,
} from "../../tickets.js";
import { EPHEMERAL, logAudit } from "../shared.js";

// ====================================================================
// Panneau interactif /setup-tickets (configuration admin)
// ====================================================================

async function buildConfigPanel(guildId) {
  const cfg = await getTicketConfig(guildId);
  const catTxt = cfg.categoryId ? `<#${cfg.categoryId}>` : "*(non définie — requise)*";
  const staffTxt = cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : "*(non défini — requis)*";
  const logTxt = cfg.logChannelId ? `<#${cfg.logChannelId}>` : "*(aucun)*";
  const topicsTxt = cfg.topics.length
    ? cfg.topics.map((t) => `• ${t.emoji} **${t.label}**${t.description ? ` — ${t.description}` : ""}`).join("\n")
    : "*(aucun → un bouton unique « Ouvrir un ticket »)*";

  const ready = Boolean(cfg.categoryId && cfg.staffRoleId);

  const embed = new EmbedBuilder()
    .setTitle("🎫 Configuration des tickets")
    .setColor(cfg.enabled ? 0x5865f2 : 0x747f8d)
    .setDescription(
      "Configure le système de tickets, puis **publie le panneau** dans le salon de ton choix.\n" +
        "Les membres ouvrent un salon privé visible par eux et le staff.\n" +
        "💡 Design avancé (bannière, couleur, vignette, motifs) : **dashboard web → Tickets**.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Catégorie des tickets", value: catTxt, inline: true },
      { name: "Rôle staff", value: staffTxt, inline: true },
      { name: "Salon des transcripts", value: logTxt, inline: true },
      { name: `Motifs (${cfg.topics.length})`, value: topicsTxt, inline: false },
    )
    .setFooter({
      text: ready
        ? "Prêt. Publie le panneau dans un salon avec le bouton ci-dessous."
        : "Définis au moins la catégorie et le rôle staff avant d'activer/publier.",
    });

  const rowCat = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tckcfg_category")
      .setPlaceholder("📂 Catégorie où créer les tickets")
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowStaff = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("tckcfg_staff")
      .setPlaceholder("🛡️ Rôle staff (gère les tickets)")
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowLog = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tckcfg_log")
      .setPlaceholder("📝 Salon des transcripts (optionnel)")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1),
  );

  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("tckcfg_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("tckcfg_text").setLabel("Texte du panneau").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tckcfg_addtopic").setLabel("Ajouter un motif").setEmoji("➕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tckcfg_publish").setLabel("Publier le panneau").setEmoji("📨").setStyle(ButtonStyle.Primary),
  );

  const rows = [rowCat, rowStaff, rowLog];
  if (cfg.topics.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("tckcfg_removetopic")
          .setPlaceholder("🗑️ Retirer un motif")
          .addOptions(
            cfg.topics.map((t) => ({ label: t.label.slice(0, 100), description: "Retirer ce motif", value: t.id })),
          ),
      ),
    );
  }
  rows.push(rowButtons);
  return { embeds: [embed], components: rows };
}

export async function handleSetupTickets(interaction) {
  return interaction.reply({ ...(await buildConfigPanel(interaction.guild.id)), flags: EPHEMERAL });
}

async function refreshConfigPanel(interaction) {
  return interaction.update(await buildConfigPanel(interaction.guild.id));
}

// ---------- Panneau public (vu par les membres) ----------
// Construit par buildTicketPanelPayload (partagé avec le dashboard), à partir de la config.

// ====================================================================
// Routage : boutons de config + actions de ticket
// ====================================================================

export async function handleTicketsButton(interaction, ctx) {
  const id = interaction.customId;

  // ---- Boutons du panneau de config (admin) ----
  if (id === "tckcfg_toggle") {
    const cfg = await getTicketConfig(interaction.guild.id);
    if (!cfg.enabled && !(cfg.categoryId && cfg.staffRoleId)) {
      return interaction.reply({ content: "Définis d'abord la **catégorie** et le **rôle staff**.", flags: EPHEMERAL });
    }
    await setTicketConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshConfigPanel(interaction);
  }

  if (id === "tckcfg_text") {
    const cfg = await getTicketConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId("tckcfg_text_modal").setTitle("Texte du panneau public").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Titre")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120)
          .setValue(cfg.panelTitle || ""),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("desc")
          .setLabel("Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(cfg.panelDescription || ""),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tckcfg_addtopic") {
    const modal = new ModalBuilder().setCustomId("tckcfg_topic_modal").setTitle("Ajouter un motif").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("label").setLabel("Nom du motif").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("Signalement"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("emoji").setLabel("Emoji (optionnel)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setPlaceholder("🚨"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desc").setLabel("Description courte (optionnel)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tckcfg_publish") {
    const cfg = await getTicketConfig(interaction.guild.id);
    if (!cfg.categoryId || !cfg.staffRoleId) {
      return interaction.reply({ content: "Configure la **catégorie** et le **rôle staff** avant de publier.", flags: EPHEMERAL });
    }
    if (!cfg.enabled) {
      return interaction.reply({ content: "Active d'abord le système (bouton 🔴/🟢).", flags: EPHEMERAL });
    }
    await interaction.channel.send(buildTicketPanelPayload(cfg)).catch(() => null);
    return interaction.reply({ content: "📨 Panneau de tickets publié dans ce salon. ✅", flags: EPHEMERAL });
  }

  // ---- Bouton public : ouvrir un ticket (pas de motifs) ----
  if (id === "tckopen_btn") {
    return openTicket(interaction, null);
  }

  // ---- Boutons dans un salon de ticket ----
  if (id === "tck_claim") return claimTicket(interaction);
  if (id === "tck_transcript") return sendTranscriptNow(interaction);
  if (id === "tck_close") return askCloseTicket(interaction);
  if (id === "tck_close_confirm") return closeTicket(interaction);
  if (id === "tck_close_cancel") {
    return interaction.update({ content: "Fermeture annulée.", components: [] });
  }
}

export async function handleTicketsSelect(interaction, ctx) {
  const id = interaction.customId;

  if (id === "tckcfg_category") {
    await setTicketConfig(interaction.guild.id, { categoryId: interaction.values[0] });
    return refreshConfigPanel(interaction);
  }
  if (id === "tckcfg_staff") {
    await setTicketConfig(interaction.guild.id, { staffRoleId: interaction.values[0] });
    return refreshConfigPanel(interaction);
  }
  if (id === "tckcfg_log") {
    await setTicketConfig(interaction.guild.id, { logChannelId: interaction.values[0] || "" });
    return refreshConfigPanel(interaction);
  }
  if (id === "tckcfg_removetopic") {
    await removeTopic(interaction.guild.id, interaction.values[0]);
    return refreshConfigPanel(interaction);
  }

  // Panneau public avec motifs.
  if (id === "tckopen_select") {
    return openTicket(interaction, interaction.values[0]);
  }
}

export async function handleTicketsModal(interaction, ctx) {
  const id = interaction.customId;

  if (id === "tckcfg_text_modal") {
    const title = interaction.fields.getTextInputValue("title")?.trim().slice(0, 120) || "🎫 Support & Tickets";
    const desc = interaction.fields.getTextInputValue("desc")?.trim().slice(0, 2000);
    await setTicketConfig(interaction.guild.id, { panelTitle: title, panelDescription: desc });
    if (interaction.isFromMessage()) return refreshConfigPanel(interaction);
    return interaction.reply({ content: "Texte du panneau mis à jour. ✅", flags: EPHEMERAL });
  }

  if (id === "tckcfg_topic_modal") {
    const label = interaction.fields.getTextInputValue("label")?.trim();
    const emoji = interaction.fields.getTextInputValue("emoji")?.trim();
    const desc = interaction.fields.getTextInputValue("desc")?.trim();
    await addTopic(interaction.guild.id, { label, emoji, description: desc });
    if (interaction.isFromMessage()) return refreshConfigPanel(interaction);
    return interaction.reply({ content: `Motif **${label}** ajouté. ✅`, flags: EPHEMERAL });
  }

  // Modal de création de ticket (sujet rempli par le membre).
  if (id.startsWith("tck_create_modal")) {
    const topicId = id.split(":")[1] || null;
    const subject = interaction.fields.getTextInputValue("subject")?.trim().slice(0, 300) || "(sans objet)";
    return createTicketChannel(interaction, topicId, subject);
  }
}

// ====================================================================
// Cycle de vie d'un ticket
// ====================================================================

// Demande le sujet via un modal avant de créer le salon.
async function openTicket(interaction, topicId) {
  const cfg = await getTicketConfig(interaction.guild.id);
  if (!cfg.enabled) {
    return interaction.reply({ content: "Le système de tickets est désactivé.", flags: EPHEMERAL });
  }
  // Anti-spam : un seul ticket ouvert par membre à la fois.
  const already = await countOpenByOwner(interaction.guild.id, interaction.user.id);
  if (already >= 1) {
    return interaction.reply({ content: "Tu as déjà un ticket ouvert. Ferme-le avant d'en ouvrir un autre.", flags: EPHEMERAL });
  }

  const topic = topicId ? await getTopic(interaction.guild.id, topicId) : null;
  const modal = new ModalBuilder()
    .setCustomId(`tck_create_modal:${topicId || ""}`)
    .setTitle(topic ? `Ticket — ${topic.label}`.slice(0, 45) : "Ouvrir un ticket")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("subject")
          .setLabel("Décris brièvement ta demande")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder("Explique ton problème / ta question en quelques mots."),
      ),
    );
  return interaction.showModal(modal);
}

// Slug court et propre à partir du libellé d'un motif (sans accents, minuscules).
function slugifyTopic(s) {
  return (
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // retire les accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "ticket"
  );
}

// Emoji utilisable dans un nom de salon : unicode uniquement (les emojis custom <:..:id> ne
// s'affichent pas dans un nom de salon, on les ignore).
function channelEmoji(emoji) {
  if (!emoji || /^<a?:\w+:\d+>$/.test(emoji)) return "";
  return emoji;
}

// Nom du salon de ticket : "🛒-devenir-vendeur-0004", ou "ticket-0004" sans motif.
function buildTicketChannelName(topic, number) {
  const num = String(number).padStart(4, "0");
  if (!topic) return `ticket-${num}`;
  const emo = channelEmoji(topic.emoji);
  const slug = slugifyTopic(topic.label);
  return `${emo}${emo ? "-" : ""}${slug}-${num}`.slice(0, 95);
}

async function createTicketChannel(interaction, topicId, subject) {
  const guild = interaction.guild;
  const cfg = await getTicketConfig(guild.id);
  if (!cfg.enabled || !cfg.categoryId || !cfg.staffRoleId) {
    return interaction.reply({ content: "Le système de tickets n'est pas configuré.", flags: EPHEMERAL });
  }
  // Re-vérifie l'unicité (course possible entre l'ouverture du modal et l'envoi).
  if ((await countOpenByOwner(guild.id, interaction.user.id)) >= 1) {
    return interaction.reply({ content: "Tu as déjà un ticket ouvert.", flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const topic = topicId ? await getTopic(guild.id, topicId) : null;
  const number = await nextTicketNumber(guild.id);
  const botId = interaction.client.user.id;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: cfg.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name: buildTicketChannelName(topic, number),
      type: ChannelType.GuildText,
      parent: cfg.categoryId,
      topic: `Ticket #${number} • ${interaction.user.tag} • ${topic ? topic.label : "Général"}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    return interaction.editReply(`Impossible de créer le salon : ${err.message} (vérifie les permissions du bot et la catégorie).`);
  }

  await addOpenTicket(guild.id, channel.id, {
    ownerId: interaction.user.id,
    number,
    topic: topic ? topic.label : "Général",
    subject,
  });

  const container = buildTicketContainer(cfg, { topic, subject, ownerId: interaction.user.id, number });

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tck_claim").setLabel("Prendre en charge").setEmoji("🙋").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tck_transcript").setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("tck_close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );

  await channel
    .send({
      components: [
        new TextDisplayBuilder().setContent(`<@${interaction.user.id}> <@&${cfg.staffRoleId}>`),
        container,
        controls,
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [interaction.user.id], roles: [cfg.staffRoleId] },
    })
    .catch(() => {});

  await logAudit(guild, `🎫 <@${interaction.user.id}> a ouvert le **ticket #${number}** (${topic ? topic.label : "Général"}) → <#${channel.id}>`);
  return interaction.editReply(`Ton ticket a été créé : <#${channel.id}> ✅`);
}

// Vérifie que l'interaction se déroule bien dans un salon de ticket.
async function ticketContext(interaction) {
  const t = await getOpenTicket(interaction.guild.id, interaction.channel?.id);
  if (!t) {
    await interaction.reply({ content: "Ce salon n'est pas un ticket actif.", flags: EPHEMERAL });
    return null;
  }
  return t;
}

function isStaff(interaction, cfg) {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (cfg.staffRoleId && interaction.member?.roles?.cache?.has(cfg.staffRoleId))
  );
}

async function claimTicket(interaction) {
  const t = await ticketContext(interaction);
  if (!t) return;
  const cfg = await getTicketConfig(interaction.guild.id);
  if (!isStaff(interaction, cfg)) {
    return interaction.reply({ content: "Seul le staff peut prendre en charge un ticket.", flags: EPHEMERAL });
  }
  if (t.claimedBy) {
    return interaction.reply({ content: `Déjà pris en charge par <@${t.claimedBy}>.`, flags: EPHEMERAL });
  }
  await setTicketClaim(interaction.guild.id, interaction.channel.id, interaction.user.id);
  return interaction.reply({ content: `🙋 <@${interaction.user.id}> prend ce ticket en charge.` });
}

// Génère et envoie un transcript sans fermer le ticket (bouton « Transcript »).
async function sendTranscriptNow(interaction) {
  const t = await ticketContext(interaction);
  if (!t) return;
  const cfg = await getTicketConfig(interaction.guild.id);
  if (interaction.user.id !== t.ownerId && !isStaff(interaction, cfg)) {
    return interaction.reply({ content: "Réservé à l'auteur du ticket ou au staff.", flags: EPHEMERAL });
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const file = await buildTranscript(interaction.channel, t);
  const logCh = cfg.logChannelId
    ? await interaction.guild.channels.fetch(cfg.logChannelId).catch(() => null)
    : null;
  if (logCh?.isTextBased?.()) {
    await logCh
      .send({ content: `📄 Transcript du ticket #${t.number} (demandé par <@${interaction.user.id}>)`, files: [file] })
      .catch(() => {});
    return interaction.editReply(`Transcript envoyé dans <#${cfg.logChannelId}>. ✅`);
  }
  return interaction.editReply({ content: "📄 Transcript du ticket :", files: [file] });
}

async function askCloseTicket(interaction) {
  const t = await ticketContext(interaction);
  if (!t) return;
  const cfg = await getTicketConfig(interaction.guild.id);
  // Le propriétaire ou le staff peut fermer.
  if (interaction.user.id !== t.ownerId && !isStaff(interaction, cfg)) {
    return interaction.reply({ content: "Seul l'auteur du ticket ou le staff peut le fermer.", flags: EPHEMERAL });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tck_close_confirm").setLabel("Confirmer la fermeture").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("tck_close_cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({ content: "⚠️ Fermer ce ticket ? Le salon sera supprimé.", components: [row], flags: EPHEMERAL });
}

// Génère un transcript HTML du salon de ticket via discord-html-transcripts.
// Retourne un AttachmentBuilder (fichier .html) prêt à être envoyé.
async function buildTranscript(channel, ticket) {
  return discordTranscripts.createTranscript(channel, {
    limit: -1, // récupère tous les messages du salon
    filename: `ticket-${String(ticket.number).padStart(4, "0")}.html`,
    saveImages: true, // intègre les images dans le fichier
    poweredBy: false,
    footerText: `Ticket #${ticket.number} • {number} message(s)`,
  });
}

async function closeTicket(interaction) {
  const t = await ticketContext(interaction);
  if (!t) return;
  const cfg = await getTicketConfig(interaction.guild.id);
  if (interaction.user.id !== t.ownerId && !isStaff(interaction, cfg)) {
    return interaction.reply({ content: "Seul l'auteur du ticket ou le staff peut le fermer.", flags: EPHEMERAL });
  }

  await interaction.update({ content: "🔒 Fermeture du ticket en cours...", components: [] }).catch(() => {});

  const channel = interaction.channel;

  // Transcript -> salon de logs (best-effort).
  if (cfg.logChannelId) {
    try {
      const file = await buildTranscript(channel, t);
      const logEmbed = new EmbedBuilder()
        .setTitle(`🎫 Ticket #${t.number} fermé`)
        .setColor(0xe74c3c)
        .addFields(
          { name: "Ouvert par", value: `<@${t.ownerId}>`, inline: true },
          { name: "Fermé par", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Motif", value: t.topic || "Général", inline: true },
          { name: "Pris en charge par", value: t.claimedBy ? `<@${t.claimedBy}>` : "*(personne)*", inline: true },
        )
        .setTimestamp();
      const logCh = await interaction.guild.channels.fetch(cfg.logChannelId).catch(() => null);
      if (logCh?.isTextBased?.()) await logCh.send({ embeds: [logEmbed], files: [file] }).catch(() => {});
    } catch {
      /* transcript best-effort */
    }
  }

  await removeOpenTicket(interaction.guild.id, channel.id);
  await logAudit(interaction.guild, `🔒 <@${interaction.user.id}> a fermé le **ticket #${t.number}** (auteur <@${t.ownerId}>).`);

  // Petit délai pour laisser le message de fermeture s'afficher, puis suppression du salon.
  setTimeout(() => {
    channel.delete("Ticket fermé").catch(() => {});
  }, 3000);
}
