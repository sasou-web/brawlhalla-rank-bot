import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { getTempConfig, setTempConfig, addHub, removeHub, getTempOwner, setTempOwner } from "../../tempvoice.js";
import { EPHEMERAL } from "../shared.js";

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

export async function handleSetupTempVoice(interaction, ctx) {
  const panel = await buildTempVoicePanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshTempVoicePanel(interaction) {
  return interaction.update(await buildTempVoicePanel(interaction.guild.id));
}

export async function handleTempVoicePanelButton(interaction, ctx) {
  if (interaction.customId === "tv_toggle") {
    const cfg = await getTempConfig(interaction.guild.id);
    if (!cfg.enabled && !Object.keys(cfg.hubs || {}).length) {
      return interaction.reply({ content: "Ajoute d'abord au moins un **hub** avant d'activer.", flags: EPHEMERAL });
    }
    await setTempConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshTempVoicePanel(interaction);
  }
}

export async function handleTempVoicePanelSelect(interaction, ctx) {
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

export async function handleTempVoicePanelModal(interaction, ctx) {
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

export async function handleVoiceControlButton(interaction, ctx) {
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

export async function handleVoiceControlSelect(interaction, ctx) {
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

export async function handleVoiceControlModal(interaction, ctx) {
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
