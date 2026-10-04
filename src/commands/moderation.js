import { PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import { getRoleTimeoutConfig, getTimeoutCooldownRemaining, recordTimeoutUse } from "../roleTimeout.js";
import { evaluateTimeoutRequest, parseTimeoutDuration } from "../roleTimeoutRules.js";
import { formatDuration } from "../giveaway.js";
import { getWordFilterConfig } from "../wordfilter.js";
import { EPHEMERAL, logAudit } from "./shared.js";

// ---------- /timeout (délégué par rôle) ----------
// Autorisés : les rôles choisis dans le dashboard (module actif, cooldown par membre) et,
// toujours, les modérateurs natifs (« Exclure temporairement des membres »), sans cooldown.
// Règles et messages de refus : roleTimeoutRules.js. Toutes les réponses sont éphémères.

const NO_MENTIONS = { parse: [] };
const inFlight = new Set(); // `${guildId}:${userId}` : un seul /timeout à la fois par exécutant

function reply(interaction, content) {
  return interaction.reply({ content, flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
}

// Lecture défensive d'un GuildMember (getters discord.js susceptibles de lever).
function describeMember(member, guild) {
  const has = (flag) => {
    try {
      return Boolean(member.permissions?.has(flag));
    } catch {
      return false;
    }
  };
  let moderatable = false;
  try {
    moderatable = Boolean(member.moderatable);
  } catch {
    moderatable = false; // ex. membre du bot absent du cache
  }
  return {
    id: member.id,
    isBot: Boolean(member.user?.bot),
    isOwner: guild.ownerId === member.id,
    isAdmin: has(PermissionFlagsBits.Administrator),
    isModerator: has(PermissionFlagsBits.ModerateMembers),
    roleIds: [...(member.roles?.cache?.keys?.() ?? [])],
    highestPosition: member.roles?.highest?.position ?? 0,
    moderatable,
    timedOutUntil: member.communicationDisabledUntilTimestamp ?? 0,
  };
}

function apiErrorMessage(err) {
  if (err?.code === RESTJSONErrorCodes.MissingPermissions) {
    return "Discord a refusé : il me manque la permission « Exclure temporairement des membres » ou le rôle de ce membre est au-dessus du mien.";
  }
  if (err?.code === RESTJSONErrorCodes.UnknownMember) return "Ce membre a quitté le serveur.";
  const detail = String(err?.message || "erreur inconnue").replace(/\.+$/, "").slice(0, 300);
  return `Le timeout a échoué : ${detail}.`;
}

// Journal : « Journal de modération » du filtre de mots s'il est défini, sinon salon d'audit.
// Best-effort : ne lève jamais.
async function logRoleTimeout(guild, entry) {
  const { executorId, executorTag, targetId, targetTag, ms, endTs, reason, roleId } = entry;
  const by = roleId ? `Rôle <@&${roleId}>` : "Modérateur";
  try {
    const { logChannelId } = await getWordFilterConfig(guild.id);
    const ch = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;
    if (ch?.isTextBased?.()) {
      const sent = await ch
        .send({
          embeds: [
            {
              color: 0xd6a13b,
              title: "⏳ Timeout via /timeout",
              description: `<@${executorId}> a exclu <@${targetId}> pour **${formatDuration(ms)}**.`,
              fields: [
                { name: "Fin", value: `<t:${Math.floor(endTs / 1000)}:f>`, inline: true },
                { name: "Autorisation", value: by, inline: true },
                { name: "Raison", value: (reason || "Aucune raison précisée").slice(0, 1000) },
              ],
              footer: { text: `Par ${executorTag} (${executorId}) · membre ${targetTag} (${targetId})`.slice(0, 2048) },
              timestamp: new Date().toISOString(),
            },
          ],
          allowedMentions: NO_MENTIONS,
        })
        .then(() => true)
        .catch(() => false);
      if (sent) return;
    }
    // La raison est un texte libre saisi par un membre délégué : aucune mention ne doit partir.
    await logAudit(guild, {
      content: `⏳ <@${executorId}> a exclu <@${targetId}> pour **${formatDuration(ms)}** via /timeout — ${reason || "aucune raison précisée"}`,
      allowedMentions: NO_MENTIONS,
    });
  } catch {
    /* journal best-effort */
  }
}

export async function handleTimeout(interaction, ctx) {
  const guild = interaction.guild;
  if (!guild) return reply(interaction, "Cette commande s'utilise sur un serveur.");

  const cfg = await getRoleTimeoutConfig(guild.id);
  const executor = interaction.member?.roles?.cache ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!executor) return reply(interaction, "Impossible de vérifier tes rôles. Réessaie dans un instant.");
  const targetUser = interaction.options.getUser("membre", true);
  let target;
  try {
    target = await guild.members.fetch(targetUser.id);
  } catch (err) {
    // Seul « Unknown Member » signifie que la cible est absente ; le reste (réseau, 5xx,
    // rate limit) est un échec temporaire de Discord.
    if (err?.code === RESTJSONErrorCodes.UnknownMember) return reply(interaction, "Ce membre n'est pas (ou plus) sur le serveur.");
    return reply(interaction, "Impossible de récupérer ce membre auprès de Discord. Réessaie dans un instant.");
  }
  if (!target) return reply(interaction, "Ce membre n'est pas (ou plus) sur le serveur.");

  const now = Date.now();
  const verdict = evaluateTimeoutRequest({
    config: cfg,
    executor: describeMember(executor, guild),
    target: describeMember(target, guild),
    botUserId: interaction.client?.user?.id,
    now,
  });
  if (!verdict.ok) return reply(interaction, verdict.message);

  const duration = parseTimeoutDuration(interaction.options.getString("duree", true));
  if (!duration.ok) return reply(interaction, duration.error);

  const useCooldown = !verdict.bypassCooldown;
  if (useCooldown) {
    const remaining = getTimeoutCooldownRemaining(guild.id, interaction.user.id, cfg.cooldownSec, now);
    if (remaining > 0) {
      return reply(interaction, `⏳ Tu pourras réutiliser /timeout dans **${formatDuration(Math.ceil(remaining / 1000) * 1000)}**.`);
    }
  }

  // Verrou : la vérification du cooldown et l'écriture se font de part et d'autre d'un appel
  // Discord ; sans lui, deux commandes simultanées passeraient toutes les deux.
  const lockKey = `${guild.id}:${interaction.user.id}`;
  if (inFlight.has(lockKey)) return reply(interaction, "⏳ Un timeout est déjà en cours de traitement, patiente un instant.");
  inFlight.add(lockKey);
  try {
    await interaction.deferReply({ flags: EPHEMERAL });
    const reason = (interaction.options.getString("raison") || "").trim();
    const auditReason = `${reason || "Aucune raison précisée"} · par ${interaction.user.tag} via /timeout`.slice(0, 512);
    try {
      await target.timeout(duration.ms, auditReason);
    } catch (err) {
      // Rien n'est enregistré : le cooldown reste disponible.
      return interaction.editReply({ content: `${apiErrorMessage(err)} Ton cooldown n'est pas consommé.`, allowedMentions: NO_MENTIONS });
    }

    const endTs = Date.now() + duration.ms;
    if (useCooldown) recordTimeoutUse(guild.id, interaction.user.id);
    await logRoleTimeout(guild, {
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
      targetId: target.id,
      targetTag: target.user?.tag ?? targetUser.tag,
      ms: duration.ms,
      endTs,
      reason,
      roleId: verdict.roleId,
    });
    console.log(
      `/timeout : ${interaction.user.tag} a exclu ${target.user?.tag ?? target.id} pour ${formatDuration(duration.ms)} (${verdict.via === "role" ? "rôle autorisé" : "modérateur"}).`,
    );

    const lines = [`✅ <@${target.id}> est exclu pour **${formatDuration(duration.ms)}** (fin <t:${Math.floor(endTs / 1000)}:R>).`];
    if (useCooldown && cfg.cooldownSec > 0) lines.push(`-# Prochain /timeout possible dans ${formatDuration(cfg.cooldownSec * 1000)}.`);
    return interaction.editReply({ content: lines.join("\n"), allowedMentions: NO_MENTIONS });
  } finally {
    inFlight.delete(lockKey);
  }
}
