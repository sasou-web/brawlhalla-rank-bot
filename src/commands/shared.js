import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { getSettings } from "../settings.js";
import { tierEmojiText } from "../config.js";
import { syncMember } from "../sync.js";

// Helpers transverses partages par les modules de commandes/panneaux.

// Flag "reponse ephemere" (visible uniquement par l'auteur de l'interaction).
export const EPHEMERAL = MessageFlags.Ephemeral;

// Flag combiné éphémère + Components V2 (pour les réponses différées en V2).
export const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

/**
 * Défense en profondeur : vérifie que l'auteur de l'interaction possède la permission
 * requise côté serveur, sans se reposer uniquement sur `setDefaultMemberPermissions`
 * (gate Discord, contournable si la permission par défaut est modifiée côté serveur).
 * Répond (éphémère) et renvoie false si refusé ; renvoie true si autorisé.
 */
export async function requirePermission(interaction, flag, label = "⛔ Réservé aux administrateurs.") {
  if (interaction.memberPermissions?.has(flag)) return true;
  const payload = { content: label, flags: EPHEMERAL };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  } catch {
    /* l'interaction a pu expirer : on ne bloque pas */
  }
  return false;
}

// Raccourci pour la permission « Gérer le serveur » (admins du bot).
export function requireManageGuild(interaction) {
  return requirePermission(interaction, PermissionFlagsBits.ManageGuild);
}

// Synchronise les roles de rank d'un membre (wrapper autour de syncMember).
export async function doSync(member, brawlhallaId, ctx, profile) {
  return syncMember(member, brawlhallaId, ctx.rolesByName, profile ? { profile } : {});
}

// Emoji custom du serveur par tier de base (decoratif, ne change rien aux roles).
// "Gold 4" -> base "Gold". Repli unicode pour Tin / tier inconnu.
export function tierEmoji(tier) {
  const base = tier ? String(tier).split(" ")[0] : null;
  return tierEmojiText(base) || "▪️";
}

// Journalise une action dans le salon d'audit configure (best-effort, ne leve jamais).
export async function logAudit(guild, text) {
  try {
    const { auditChannelId } = await getSettings();
    if (!auditChannelId) return;
    const ch = await guild.channels.fetch(auditChannelId).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send(text);
  } catch {
    /* audit best-effort */
  }
}

// Envoie un MP a un utilisateur (best-effort : ignore si ses MP sont fermes).
export async function dmUser(client, userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch {
    /* DMs fermes : on ignore */
  }
}
