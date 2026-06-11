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
} from "discord.js";
import {
  getGiveawayConfig,
  setGiveawayConfig,
  createGiveaway,
  endGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  toggleEntry,
  refreshGiveawayMessage,
  parseDuration,
  formatDuration,
} from "../../giveaway.js";
import { listActiveGiveaways, getGiveaway, countEntries } from "../../giveawayStore.js";
import { EPHEMERAL, logAudit } from "../shared.js";

// ====================================================================
// Panneau /setup-giveaway (configuration admin + création rapide).
// customId : préfixe "gw". Boutons publics : gw_enter:<id> / gw_ended:<id>.
// Contrôles de config : gwcfg_*.
// ====================================================================

async function buildConfigPanel(guildId) {
  const cfg = await getGiveawayConfig(guildId);
  const active = listActiveGiveaways(guildId);

  const chanTxt = cfg.defaultChannelId ? `<#${cfg.defaultChannelId}>` : "*(salon courant à la création)*";
  const pingTxt = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : "*(aucun)*";
  const reqTxt = cfg.requiredRoleId ? `<@&${cfg.requiredRoleId}>` : "*(aucun — tout le monde peut participer)*";
  const activeTxt = active.length
    ? active
        .slice(0, 10)
        .map((g) => `• **${g.prize}** — ${countEntries(g.id)} 🎟️ · fin <t:${Math.floor(g.ends_ts / 1000)}:R> (#${g.id})`)
        .join("\n")
    : "*(aucun giveaway en cours)*";

  const embed = new EmbedBuilder()
    .setTitle("🎉 Configuration des giveaways")
    .setColor(cfg.enabled ? 0xf1c40f : 0x747f8d)
    .setDescription(
      "Crée et gère des concours en Components V2.\n" +
        "Définis les réglages ci-dessous puis **crée un giveaway**.\n" +
        "💡 Gestion complète (création, reroll, fin anticipée, historique) : **dashboard web → Giveaway**.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Salon par défaut", value: chanTxt, inline: true },
      { name: "Rôle pingé", value: pingTxt, inline: true },
      { name: "Rôle requis", value: reqTxt, inline: true },
      { name: "MP aux gagnants", value: cfg.dmWinners ? "✅ Oui" : "❌ Non", inline: true },
      { name: `Giveaways en cours (${active.length})`, value: activeTxt, inline: false },
    )
    .setFooter({ text: "Crée un giveaway avec le bouton 🎉 ci-dessous." });

  const rowChan = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("gwcfg_channel")
      .setPlaceholder("📢 Salon par défaut des giveaways")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1),
  );
  const rowPing = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId("gwcfg_ping").setPlaceholder("🔔 Rôle à pinger (optionnel)").setMinValues(0).setMaxValues(1),
  );
  const rowReq = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId("gwcfg_required").setPlaceholder("🔒 Rôle requis pour participer (optionnel)").setMinValues(0).setMaxValues(1),
  );

  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("gwcfg_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("gwcfg_dm").setLabel("MP gagnants").setEmoji(cfg.dmWinners ? "✅" : "❌").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("gwcfg_appearance").setLabel("Apparence").setEmoji("🎨").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("gwcfg_create").setLabel("Créer un giveaway").setEmoji("🎉").setStyle(ButtonStyle.Primary),
  );

  const rows = [rowChan, rowPing, rowReq];
  if (active.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("gwcfg_end")
          .setPlaceholder("🏁 Terminer un giveaway maintenant")
          .addOptions(
            active.slice(0, 25).map((g) => ({
              label: g.prize.slice(0, 100),
              description: `${countEntries(g.id)} participant(s) · ${g.winners_count} gagnant(s)`.slice(0, 100),
              value: String(g.id),
              emoji: "🏁",
            })),
          ),
      ),
    );
  }
  rows.push(rowButtons);
  return { embeds: [embed], components: rows };
}

export async function handleSetupGiveaway(interaction) {
  return interaction.reply({ ...(await buildConfigPanel(interaction.guild.id)), flags: EPHEMERAL });
}

async function refreshConfigPanel(interaction) {
  return interaction.update(await buildConfigPanel(interaction.guild.id));
}

// ====================================================================
// Boutons
// ====================================================================

export async function handleGiveawayButton(interaction, ctx) {
  const id = interaction.customId;

  // ---- Bouton public : participer (toggle) ----
  if (id.startsWith("gw_enter:")) {
    const gwId = Number(id.split(":")[1]);
    const res = await toggleEntry(interaction, gwId);
    if (!res.ok) {
      return interaction.reply({ content: `❌ ${res.error}`, flags: EPHEMERAL });
    }
    await interaction.reply({
      content: res.joined ? "✅ Ta participation est enregistrée. Bonne chance ! 🍀" : "↩️ Tu ne participes plus à ce giveaway.",
      flags: EPHEMERAL,
    });
    // Rafraîchit le compteur sur le message public (best-effort).
    const cfg = await getGiveawayConfig(interaction.guild.id);
    await refreshGiveawayMessage(interaction.client, res.gw, cfg);
    return;
  }

  if (id.startsWith("gw_ended:")) {
    return interaction.reply({ content: "Ce giveaway est terminé.", flags: EPHEMERAL });
  }

  // ---- Boutons du panneau de config (admin) ----
  if (id === "gwcfg_toggle") {
    const cfg = await getGiveawayConfig(interaction.guild.id);
    await setGiveawayConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshConfigPanel(interaction);
  }

  if (id === "gwcfg_dm") {
    const cfg = await getGiveawayConfig(interaction.guild.id);
    await setGiveawayConfig(interaction.guild.id, { dmWinners: !cfg.dmWinners });
    return refreshConfigPanel(interaction);
  }

  if (id === "gwcfg_appearance") {
    const cfg = await getGiveawayConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId("gwcfg_appearance_modal").setTitle("Apparence du giveaway").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("Titre").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(cfg.embedTitle || "GIVEAWAY"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("color").setLabel("Couleur (hex, ex : #f1c40f)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(9).setValue(cfg.embedColor || "#f1c40f"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("button").setLabel("Texte du bouton").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setValue(cfg.buttonLabel || "Participer"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("emoji").setLabel("Emoji du bouton").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40).setValue(cfg.buttonEmoji || "🎉"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("banner").setLabel("Bannière (URL image, optionnel)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(400).setValue(cfg.bannerUrl || ""),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "gwcfg_create") {
    const cfg = await getGiveawayConfig(interaction.guild.id);
    if (!cfg.enabled) {
      return interaction.reply({ content: "Active d'abord le système (bouton 🔴/🟢).", flags: EPHEMERAL });
    }
    const modal = new ModalBuilder().setCustomId("gwcfg_create_modal").setTitle("Créer un giveaway").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("prize").setLabel("Récompense").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(250).setPlaceholder("Nitro classique 1 mois"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("duration").setLabel("Durée (ex : 30m, 2h, 1d, 1w)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setValue(cfg.defaultDuration || "24h"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("winners").setLabel("Nombre de gagnants").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(cfg.defaultWinners || 1)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("description").setLabel("Description (optionnel)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500),
      ),
    );
    return interaction.showModal(modal);
  }
}

// ====================================================================
// Selects
// ====================================================================

export async function handleGiveawaySelect(interaction, ctx) {
  const id = interaction.customId;

  if (id === "gwcfg_channel") {
    await setGiveawayConfig(interaction.guild.id, { defaultChannelId: interaction.values[0] || "" });
    return refreshConfigPanel(interaction);
  }
  if (id === "gwcfg_ping") {
    await setGiveawayConfig(interaction.guild.id, { pingRoleId: interaction.values[0] || "" });
    return refreshConfigPanel(interaction);
  }
  if (id === "gwcfg_required") {
    await setGiveawayConfig(interaction.guild.id, { requiredRoleId: interaction.values[0] || "" });
    return refreshConfigPanel(interaction);
  }

  if (id === "gwcfg_end") {
    const gwId = Number(interaction.values[0]);
    await interaction.deferReply({ flags: EPHEMERAL });
    const res = await endGiveaway(interaction.client, gwId);
    if (!res.ok) return interaction.editReply(`❌ ${res.error}`);
    const gw = getGiveaway(gwId);
    await logAudit(interaction.guild, `🏁 <@${interaction.user.id}> a terminé le giveaway **${gw?.prize || gwId}** (${res.winners.length} gagnant(s)).`);
    return interaction.editReply(
      res.winners.length ? `🏁 Giveaway terminé. Gagnant(s) : ${res.winners.map((w) => `<@${w}>`).join(", ")}` : "🏁 Giveaway terminé — aucun participant.",
    );
  }
}

// ====================================================================
// Modals
// ====================================================================

export async function handleGiveawayModal(interaction, ctx) {
  const id = interaction.customId;

  if (id === "gwcfg_appearance_modal") {
    const patch = {
      embedTitle: interaction.fields.getTextInputValue("title")?.trim().slice(0, 100) || "GIVEAWAY",
      embedColor: interaction.fields.getTextInputValue("color")?.trim().slice(0, 9) || "#f1c40f",
      buttonLabel: interaction.fields.getTextInputValue("button")?.trim().slice(0, 60) || "Participer",
      buttonEmoji: interaction.fields.getTextInputValue("emoji")?.trim().slice(0, 40) || "🎉",
      bannerUrl: interaction.fields.getTextInputValue("banner")?.trim().slice(0, 400) || "",
    };
    await setGiveawayConfig(interaction.guild.id, patch);
    if (interaction.isFromMessage()) return refreshConfigPanel(interaction);
    return interaction.reply({ content: "Apparence mise à jour. ✅", flags: EPHEMERAL });
  }

  if (id === "gwcfg_create_modal") {
    const prize = interaction.fields.getTextInputValue("prize")?.trim();
    const durationMs = parseDuration(interaction.fields.getTextInputValue("duration")?.trim());
    const winnersCount = Math.max(1, Math.min(50, parseInt(interaction.fields.getTextInputValue("winners")?.trim(), 10) || 1));
    const description = interaction.fields.getTextInputValue("description")?.trim() || "";

    if (!durationMs || durationMs < 10_000) {
      return interaction.reply({ content: "❌ Durée invalide. Exemples : `30m`, `2h`, `1d`, `1w`.", flags: EPHEMERAL });
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const cfg = await getGiveawayConfig(interaction.guild.id);
    const channelId = cfg.defaultChannelId || interaction.channelId;
    const res = await createGiveaway(interaction.client, {
      guildId: interaction.guild.id,
      channelId,
      prize,
      description,
      durationMs,
      winnersCount,
      requiredRoleId: cfg.requiredRoleId || null,
      hostId: interaction.user.id,
    });
    if (!res.ok) return interaction.editReply(`❌ ${res.error}`);
    await logAudit(
      interaction.guild,
      `🎉 <@${interaction.user.id}> a lancé un giveaway **${prize}** (${winnersCount} gagnant(s), durée ${formatDuration(durationMs)}) dans <#${channelId}>.`,
    );
    return interaction.editReply(`🎉 Giveaway **${prize}** publié dans <#${channelId}> ! Fin dans ${formatDuration(durationMs)}.`);
  }
}

// Réexport pour le dashboard / autres usages éventuels.
export { rerollGiveaway, cancelGiveaway };
