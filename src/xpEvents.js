import { ChannelType } from "discord.js";
import {
  addMessageXp,
  addVoiceXp,
  getLevelConfig,
  rewardRolePlan,
  buildLevelUpAnnounce,
  getUserStats,
  computeXpMultiplier,
} from "./levels.js";
import { grantAndAnnounce } from "./achievements.js";

/**
 * Système de niveaux (XP) — extrait d'index.js.
 * - `handleMessageXp(message)` : gain d'XP par message + montée de niveau.
 * - `tickVoiceXp(guild)` : balaye les salons vocaux et accorde l'XP vocal.
 * - `handleLevelUp(...)` : rôles de récompense + annonce (partagé message/vocal).
 */

const VOICE_TICK_MS = 60 * 1000; // 1 minute
export { VOICE_TICK_MS };

async function applyRewardRoles(member, level) {
  try {
    const { desired, all } = await rewardRolePlan(member.guild.id, level);
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((id) => id && !member.roles.cache.has(id));
    // Retire uniquement les roles de recompense que le membre ne devrait plus avoir
    // (ne touche jamais aux autres roles du membre).
    const toRemove = all.filter((id) => id && !desiredSet.has(id) && member.roles.cache.has(id));
    if (toAdd.length) await member.roles.add(toAdd, "Recompense de niveau").catch(() => {});
    if (toRemove.length) await member.roles.remove(toRemove, "Mise a jour recompense de niveau").catch(() => {});
  } catch {
    /* best-effort */
  }
}

// Gere une montee de niveau : roles de recompense + annonce.
// fallbackChannel = salon ou annoncer si aucun salon d'annonce n'est configure (peut etre null).
export async function handleLevelUp(guild, member, level, oldLevel, fallbackChannel) {
  if (!member) return; // pas de membre = on ne peut ni donner de role ni mentionner proprement
  await applyRewardRoles(member, level);

  // Achievements liés au niveau (best-effort) — annoncés dans le salon dédié "succès" (sans ping).
  grantAndAnnounce(guild, member.id, { level }).catch(() => {});

  const cfg = await getLevelConfig(guild.id);
  if (cfg.announceMode === "off") return;

  const stats = await getUserStats(guild.id, member.id).catch(() => null);
  const { embed, tierCrossed } = buildLevelUpAnnounce(guild, member, level, oldLevel, stats);

  if (cfg.announceMode === "dm") {
    // Mode DM : embed prive, sans mention (la personne est deja la destinataire).
    await member.send({ embeds: [embed] }).catch(() => {});
    return;
  }

  // Ping UNIQUEMENT au passage d'un palier. Sinon, la mention dans l'embed n'alerte pas.
  const payload = tierCrossed
    ? { content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } }
    : { embeds: [embed], allowedMentions: { parse: [] } };
  try {
    if (cfg.announceChannelId) {
      const ch = await guild.channels.fetch(cfg.announceChannelId).catch(() => null);
      if (ch?.isTextBased?.()) await ch.send(payload);
    } else if (fallbackChannel?.isTextBased?.()) {
      await fallbackChannel.send(payload);
    }
  } catch {
    /* annonce best-effort */
  }
}

// Gain d'XP sur un message (à appeler depuis l'évènement MessageCreate).
export async function handleMessageXp(message) {
  try {
    const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    const mult = await computeXpMultiplier(message.guild.id, { channelId: message.channel.id, roleIds });
    const result = await addMessageXp(message.guild.id, message.author.id, mult);
    if (!result || !result.leveledUp) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    await handleLevelUp(message.guild, member, result.level, result.oldLevel, message.channel);
  } catch (err) {
    console.warn("Erreur XP message :", err.message);
  }
}

// XP vocal : balaye les salons vocaux et accorde l'XP par minute (appelé périodiquement).
export async function tickVoiceXp(guild) {
  let cfg;
  try {
    cfg = await getLevelConfig(guild.id);
  } catch {
    return;
  }
  if (!cfg.enabled || !cfg.voiceEnabled) return;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    if (channel.id === guild.afkChannelId) continue; // pas d'XP dans le salon AFK

    const humans = channel.members.filter((m) => !m.user.bot);
    if (cfg.voiceRequireOthers && humans.size < 2) continue; // seul = pas d'XP

    for (const member of humans.values()) {
      const vs = member.voice;
      if (cfg.voiceIgnoreMuted && (vs?.selfMute || vs?.selfDeaf || vs?.mute || vs?.deaf)) continue;

      try {
        const roleIds = [...member.roles.cache.keys()];
        const mult = await computeXpMultiplier(guild.id, { channelId: channel.id, roleIds });
        const result = await addVoiceXp(guild.id, member.id, cfg.voiceXpPerMin, mult);
        if (result?.leveledUp) await handleLevelUp(guild, member, result.level, result.oldLevel, null);
      } catch {
        /* best-effort */
      }
    }
  }
}
