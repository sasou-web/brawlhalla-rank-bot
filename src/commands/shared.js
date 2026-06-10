import { MessageFlags } from "discord.js";
import { getSettings } from "../settings.js";
import { tierEmojiText } from "../config.js";
import { syncMember } from "../sync.js";

// Helpers transverses partages par les modules de commandes/panneaux.

// Flag "reponse ephemere" (visible uniquement par l'auteur de l'interaction).
export const EPHEMERAL = MessageFlags.Ephemeral;

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
