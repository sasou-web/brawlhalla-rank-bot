import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from "discord.js";
import { getSettings } from "../settings.js";
import { CONTEXT_MENU_NAMES } from "./definitions.js";
import { handleProfileContext } from "./profile.js";
import { handleNiveauContext } from "./levels.js";
import { EPHEMERAL, logAudit, requirePermission } from "./shared.js";
import { enforceCooldown, peekCooldown } from "./cooldowns.js";

// Menus contextuels (clic droit sur un membre ou un message). Les définitions sont dans
// ./definitions.js ; ce module route les commandes et gère le flux « Signaler au staff » :
// modal `rep_modal:` → embed dans le salon d'alertes → boutons staff `rep_ok:` / `rep_del:`.

export { CONTEXT_MENU_NAMES };

const REPORT_COOLDOWN_MS = 60_000;
const REPORT_REASON_MAX = 300;
const REPORT_EXCERPT_MAX = 200;
const NO_MENTIONS = { parse: [] };
const STAFF_ONLY = "⛔ Réservé au staff (permission « Gérer les messages »).";

export async function handleContextMenu(interaction) {
  switch (interaction.commandName) {
    case CONTEXT_MENU_NAMES.profile: return handleProfileContext(interaction);
    case CONTEXT_MENU_NAMES.level: return handleNiveauContext(interaction);
    case CONTEXT_MENU_NAMES.report: return handleReportOpen(interaction);
  }
}

// Salon où arrivent les signalements : salon d'alertes, sinon salon d'audit.
async function reportChannelId() {
  const s = await getSettings();
  return s.alertChannelId || s.auditChannelId || "";
}

function truncate(text, max) {
  const chars = [...String(text ?? "")];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

// Extrait du message signalé, affiché en bloc de code : aucun lien masqué cliquable,
// aucune mise en forme ni mention interprétée.
function messageExcerpt(message) {
  const content = message.content?.trim();
  let text;
  if (content) text = truncate(content, REPORT_EXCERPT_MAX);
  else {
    const parts = [];
    const files = message.attachments?.size ?? 0;
    if (files) parts.push(`${files} pièce(s) jointe(s)`);
    if (message.embeds?.length) parts.push(`${message.embeds.length} embed(s)`);
    if (message.stickers?.size) parts.push("sticker");
    if (message.poll) parts.push("sondage");
    if (message.messageSnapshots?.size) parts.push("message transféré");
    text = parts.length ? `(sans texte : ${parts.join(", ")})` : "(message vide)";
  }
  return "```\n" + text.replace(/```/g, "`​``") + "\n```";
}

/**
 * Embed de signalement posté dans le salon du staff.
 * `message` = message signalé (null s'il a été supprimé entre-temps) ; `ref` donne alors
 * { guildId, channelId, messageId, authorId } pour garder un minimum de contexte.
 */
export function buildReportEmbed(message, reason, reporter, ref = {}) {
  const guildId = message?.guildId ?? ref.guildId;
  const channelId = message?.channelId ?? ref.channelId;
  const messageId = message?.id ?? ref.messageId;
  const authorId = message?.author?.id ?? ref.authorId;
  const link = message ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null;

  return new EmbedBuilder()
    .setTitle("🚩 Signalement d'un message")
    .setColor(0xe67e22)
    .setDescription(link ? `[Aller au message](${link})` : "*Message introuvable : il a déjà été supprimé.*")
    .addFields(
      { name: "Auteur", value: authorId ? `<@${authorId}>` : "Inconnu", inline: true },
      { name: "Salon", value: channelId ? `<#${channelId}>` : "Inconnu", inline: true },
      { name: "Signalé par", value: `<@${reporter.id}>`, inline: true },
      { name: "Raison", value: truncate(reason?.trim() || "Non précisée", REPORT_REASON_MAX) },
      { name: "Extrait", value: message ? messageExcerpt(message) : "*indisponible*" },
    )
    .setFooter({ text: `Message ${messageId ?? "?"}` })
    .setTimestamp(new Date());
}

export function buildReportButtons(channelId, messageId, { handled = false, deleted = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rep_ok:${messageId}`)
      .setLabel("Pris en charge")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(handled),
    new ButtonBuilder()
      .setCustomId(`rep_del:${channelId}:${messageId}`)
      .setLabel("Supprimer le message")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(deleted),
  );
}

// Clic droit → « Signaler au staff » : ouvre le modal de raison (première réponse).
async function handleReportOpen(interaction) {
  const message = interaction.targetMessage;
  if (message.author?.id === interaction.client.user?.id) {
    return interaction.reply({ content: "Les messages du bot ne peuvent pas être signalés.", flags: EPHEMERAL });
  }
  if (message.author?.id === interaction.user.id) {
    return interaction.reply({ content: "Tu ne peux pas signaler ton propre message.", flags: EPHEMERAL });
  }
  const remaining = peekCooldown("report", interaction.user.id, REPORT_COOLDOWN_MS);
  if (remaining > 0) {
    return interaction.reply({ content: `⏳ Doucement ! Réessaie dans **${Math.ceil(remaining / 1000)}s**.`, flags: EPHEMERAL });
  }
  if (!(await reportChannelId())) {
    return interaction.reply({ content: "Les signalements ne sont pas configurés sur ce serveur. Contacte un membre du staff.", flags: EPHEMERAL });
  }

  const modal = new ModalBuilder()
    .setCustomId(`rep_modal:${message.channelId}:${message.id}:${message.author?.id ?? "0"}`)
    .setTitle("Signaler au staff")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("raison")
          .setLabel("Raison du signalement")
          .setPlaceholder("Ex : insulte, spam, arnaque, contenu choquant…")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(REPORT_REASON_MAX),
      ),
    );
  return interaction.showModal(modal);
}

// Envoi du modal : poste le signalement dans le salon du staff.
export async function handleReportModal(interaction) {
  const [, channelId, messageId, authorId] = interaction.customId.split(":");
  if (!(await enforceCooldown(interaction, "report", REPORT_COOLDOWN_MS))) return;
  await interaction.deferReply({ flags: EPHEMERAL });

  const targetId = await reportChannelId();
  const staffChannel = targetId ? await interaction.guild.channels.fetch(targetId).catch(() => null) : null;
  if (!staffChannel?.isTextBased?.()) {
    return interaction.editReply("Le salon des signalements est introuvable. Préviens un membre du staff.");
  }

  // Le message a pu être supprimé pendant la saisie de la raison.
  const sourceChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  const message = sourceChannel?.messages ? await sourceChannel.messages.fetch(messageId).catch(() => null) : null;
  const reason = interaction.fields.getTextInputValue("raison");
  const embed = buildReportEmbed(message, reason, interaction.user, {
    guildId: interaction.guildId,
    channelId,
    messageId,
    authorId: authorId !== "0" ? authorId : null,
  });

  try {
    await staffChannel.send({
      embeds: [embed],
      components: [buildReportButtons(channelId, messageId, { deleted: !message })],
      allowedMentions: NO_MENTIONS,
    });
  } catch (err) {
    return interaction.editReply(`Le signalement n'a pas pu être envoyé : ${err.message}`);
  }
  return interaction.editReply("✅ Signalement envoyé au staff. Merci !");
}

// Ajoute (ou remplace) la ligne « Suivi » de l'embed de signalement.
function withFollowUp(original, text) {
  const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder();
  const fields = (embed.data.fields ?? []).filter((f) => f.name !== "Suivi");
  fields.push({ name: "Suivi", value: text });
  return embed.setFields(fields);
}

// Boutons `rep_` du message de signalement (staff uniquement, revérifié ici).
export async function handleReportButton(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages, STAFF_ONLY))) return;
  const [kind, a, b] = interaction.customId.split(":");
  const original = interaction.message.embeds[0];

  if (kind === "rep_ok") {
    // Le bouton « Supprimer » garde son état : on relit son customId sur le message.
    const delBtn = interaction.message.components?.[0]?.components?.find((c) => c.customId?.startsWith("rep_del:"));
    const [, channelId] = delBtn?.customId?.split(":") ?? [];
    return interaction.update({
      embeds: [withFollowUp(original, `✅ Pris en charge par <@${interaction.user.id}>`)],
      components: [buildReportButtons(channelId ?? "0", a, { handled: true, deleted: !delBtn || delBtn.disabled })],
      allowedMentions: NO_MENTIONS,
    });
  }

  if (kind !== "rep_del") return;
  const channelId = a;
  const messageId = b;
  await interaction.deferUpdate();
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  // La permission doit aussi valoir dans le salon du message, pas seulement dans celui du staff.
  if (channel?.permissionsFor && !channel.permissionsFor(interaction.user)?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.followUp({ content: "⛔ Tu n'as pas « Gérer les messages » dans ce salon.", flags: EPHEMERAL });
  }
  const message = channel?.messages ? await channel.messages.fetch(messageId).catch(() => null) : null;
  let followUp;
  if (!message) {
    followUp = `🗑️ Message déjà supprimé (constaté par <@${interaction.user.id}>)`;
  } else {
    try {
      await message.delete();
    } catch (err) {
      return interaction.followUp({ content: `Impossible de supprimer le message : ${err.message}`, flags: EPHEMERAL });
    }
    followUp = `🗑️ Message supprimé par <@${interaction.user.id}>`;
    await logAudit(interaction.guild, `🗑️ <@${interaction.user.id}> a supprimé un message signalé de <@${message.author?.id}> dans <#${channelId}>.`);
  }
  return interaction.editReply({
    embeds: [withFollowUp(original, followUp)],
    components: [buildReportButtons(channelId, messageId, { handled: true, deleted: true })],
    allowedMentions: NO_MENTIONS,
  });
}
