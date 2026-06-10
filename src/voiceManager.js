import { ChannelType } from "discord.js";
import {
  getTempConfig,
  getHub,
  addTempChannel,
  removeTempChannel,
  isTempChannel,
  getTempChannelIds,
} from "./tempvoice.js";

/**
 * Salons vocaux temporaires « rejoindre pour créer » (extrait d'index.js).
 * - `handleTempVoice(oldState, newState)` : crée un salon à l'entrée d'un hub, le supprime
 *   quand il se vide.
 * - `cleanupTempChannels(guild)` : nettoyage des salons vides/orphelins au démarrage.
 */

// Panneau de controle poste dans le chat du salon vocal (composants en JSON brut).
function voiceControlPanel(ownerId) {
  const embed = {
    title: "🎛️ Panneau de contrôle du salon",
    description:
      `Salon de <@${ownerId}>. Le créateur peut :\n` +
      "🔒 **Verrouiller** (personne ne rejoint) · 🔓 **Ouvrir**\n" +
      "👥 **Limite** de membres · ✏️ **Renommer**\n" +
      "⛔ **Bloquer** un membre · ✅ **Autoriser** un membre\n" +
      "👑 **Réclamer** le salon (si le créateur est parti)",
    color: 0x1abc9c,
  };
  const row1 = {
    type: 1,
    components: [
      { type: 2, style: 2, emoji: { name: "🔒" }, label: "Verrouiller", custom_id: "vc_lock" },
      { type: 2, style: 2, emoji: { name: "🔓" }, label: "Ouvrir", custom_id: "vc_unlock" },
      { type: 2, style: 2, emoji: { name: "👥" }, label: "Limite", custom_id: "vc_limit" },
      { type: 2, style: 2, emoji: { name: "✏️" }, label: "Renommer", custom_id: "vc_rename" },
    ],
  };
  const row2 = {
    type: 1,
    components: [
      { type: 2, style: 4, emoji: { name: "⛔" }, label: "Bloquer", custom_id: "vc_block" },
      { type: 2, style: 3, emoji: { name: "✅" }, label: "Autoriser", custom_id: "vc_permit" },
      { type: 2, style: 1, emoji: { name: "👑" }, label: "Réclamer", custom_id: "vc_claim" },
    ],
  };
  return {
    content: `<@${ownerId}> personnalise ta room 🎛️`,
    embeds: [embed],
    components: [row1, row2],
    allowedMentions: { users: [ownerId] },
  };
}

async function createTempChannel(member, cfg, hubChannel, hub) {
  const guild = member.guild;
  const template = hub?.nameTemplate || "🎮 {user}";
  const name = template.replace(/\{user\}/gi, member.displayName).slice(0, 100);
  const parent = cfg.categoryId || hubChannel.parentId || null;
  try {
    // Creation simple (ne demande que "Gerer les salons"). Pas d'overwrite ici :
    // Discord refuse qu'un bot accorde une permission qu'il n'a pas -> echec total sinon.
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: Math.min(99, Math.max(0, hub?.userLimit || 0)),
      reason: "Salon vocal temporaire",
    });
    await addTempChannel(guild.id, channel.id, member.id);
    await member.voice.setChannel(channel).catch(() => {});

    // Donne au createur le controle de son salon (best-effort : n'echoue pas la creation).
    channel.permissionOverwrites
      .edit(member.id, {
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
      })
      .catch(() => {});

    // Poste le panneau de controle dans le chat integre du salon vocal (best-effort).
    channel.send(voiceControlPanel(member.id)).catch(() => {});
    return channel;
  } catch (err) {
    console.warn("Creation salon temporaire echouee :", err.message);
    return null;
  }
}

export async function handleTempVoice(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  // Un membre rejoint un hub -> on lui cree un salon selon le modele de CE hub.
  const cfg = await getTempConfig(guild.id);
  if (cfg.enabled && newState.channelId && newState.member) {
    const hub = await getHub(guild.id, newState.channelId);
    if (hub) {
      const hubChannel =
        guild.channels.cache.get(newState.channelId) ||
        (await guild.channels.fetch(newState.channelId).catch(() => null));
      if (hubChannel) await createTempChannel(newState.member, cfg, hubChannel, hub);
    }
  }

  // Un membre quitte un salon temporaire -> on le supprime s'il est vide.
  const left = oldState.channelId;
  if (left && left !== newState.channelId && (await isTempChannel(guild.id, left))) {
    const ch = guild.channels.cache.get(left) || (await guild.channels.fetch(left).catch(() => null));
    if (!ch) {
      await removeTempChannel(guild.id, left);
    } else if (ch.members.size === 0) {
      await ch.delete("Salon vocal temporaire vide").catch(() => {});
      await removeTempChannel(guild.id, left);
    }
  }
}

// Nettoyage au demarrage : supprime les salons temporaires vides/orphelins.
export async function cleanupTempChannels(guild) {
  try {
    const ids = await getTempChannelIds(guild.id);
    for (const id of ids) {
      const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
      if (!ch || ch.members?.size === 0) {
        if (ch) await ch.delete("Nettoyage salon temporaire").catch(() => {});
        await removeTempChannel(guild.id, id);
      }
    }
  } catch {
    /* best-effort */
  }
}
