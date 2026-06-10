import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { getTikTokConfig, setTikTokConfig, postTest as tiktokPostTest, fetchFeedItems } from "../../tiktok.js";

const EPHEMERAL = MessageFlags.Ephemeral;

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

export async function handleSetupTikTok(interaction, ctx) {
  const panel = await buildTikTokPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshTikTokPanel(interaction) {
  return interaction.update(await buildTikTokPanel(interaction.guild.id));
}

export async function handleTikTokPanelButton(interaction, ctx) {
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

export async function handleTikTokPanelSelect(interaction, ctx) {
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

export async function handleTikTokPanelModal(interaction, ctx) {
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
