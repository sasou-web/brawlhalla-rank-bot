import { handleWordFilter } from "./wordfilter.js";
import { handleClipReaction } from "./clips.js";
import { getGuessRankConfig, reactionStoredKey } from "./guessrank.js";
import { handleLolRole } from "./lol.js";

/**
 * Événements Discord qui peuvent recevoir des objets PARTIELS (extraits d'index.js).
 * Le client active Partials.Message / Reaction / GuildMember : sans eux, discord.js n'émet
 * rien pour un message ou un membre absent du cache (tout ce qui précède le dernier
 * redémarrage, ou au-delà des 200 derniers messages d'un salon). En contrepartie, chaque
 * handler doit recharger les partiels avant usage et ignorer ce qu'il ne peut pas comparer.
 */

// Délai au-delà duquel une modification n'est plus revérifiée par le filtre de mots.
export const EDIT_RECHECK_MS = 5 * 60_000;

// Résout un partiel (fetch) ; false s'il n'a pas pu être rechargé (supprimé, accès perdu).
const refetch = (x) => x.fetch().then(() => true, () => false);

// Filtre de mots sur les messages modifiés (contournement « j'écris propre puis j'édite »).
export async function onMessageUpdate(oldMessage, newMessage, now = Date.now()) {
  try {
    if (!newMessage.guild || newMessage.author?.bot) return;
    // Mises à jour sans changement de texte (aperçu de lien ajouté par Discord…) : ignorées.
    if (!oldMessage.partial && oldMessage.content === newMessage.content) return;
    if (newMessage.partial && !(await refetch(newMessage))) return;
    // Ancien texte inconnu (message hors cache) : un épinglage ou un aperçu de lien ajouté sur
    // un vieux message émet aussi cet événement et ne doit pas déclencher de sanction. Seule
    // une vraie modification, récente, est revérifiée.
    const edited = newMessage.editedTimestamp;
    if (!edited || now - edited > EDIT_RECHECK_MS) return;
    await handleWordFilter(newMessage, { edited: true });
  } catch (err) {
    console.warn("Filtre de mots (modification) :", err.message);
  }
}

// Section LoL : accueil quand le rôle LoL est attribué. Couvre toutes les sources
// d'attribution : onboarding Discord, reaction-role, ou ajout manuel par le staff. On
// transmet les rôles d'avant la mise à jour : lol.js compare avec le rôle configuré pour
// n'accueillir qu'au vrai ajout.
export async function onGuildMemberUpdate(oldMember, newMember) {
  try {
    // Membre absent du cache : ses rôles d'avant sont inconnus. Sans cette garde, n'importe
    // quelle mise à jour (pseudo, boost…) d'un membre ayant déjà le rôle LoL l'accueillerait.
    if (oldMember?.partial) return;
    const before = oldMember?.roles?.cache;
    if (!before) return;
    const previousRoleIds = [...before.keys()];
    // Rien à faire si aucun rôle n'a été ajouté (pseudo, timeout, boost…).
    if (newMember.roles.cache.every((_r, id) => before.has(id))) return;
    await handleLolRole(newMember, { previousRoleIds });
  } catch (err) {
    console.warn("Erreur accueil LoL :", err.message);
  }
}

// Épinglage auto des clips + Devine ton rang : un seul vote (emoji de rank) par membre.
export async function onMessageReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    // Réaction sur un message hors cache : on recharge la réaction (et donc le message, avec
    // ses compteurs) avant tout usage. Message supprimé entre-temps : on abandonne.
    if (reaction.partial && !(await refetch(reaction))) return;
    const message = reaction.message;
    if (message.partial && !(await refetch(message))) return;
    const guild = message.guild;
    if (!guild) return;

    // Épinglage auto du meilleur clip (seuil de réactions), indépendant du Guess Rank.
    await handleClipReaction(message).catch(() => {});

    const cfg = await getGuessRankConfig(guild.id);
    if (!cfg.enabled || !cfg.singleVote) return;
    if (!cfg.channelIds.includes(message.channelId)) return;

    const rankKeys = new Set(cfg.reactions.map(reactionStoredKey));
    const addedKey = reaction.emoji.id || reaction.emoji.name;
    if (!rankKeys.has(addedKey)) return; // pas un emoji de rank : on ignore

    // Retire les autres votes de rank de ce membre sur ce message.
    for (const r of message.reactions.cache.values()) {
      const key = r.emoji.id || r.emoji.name;
      if (!rankKeys.has(key) || key === addedKey) continue;
      try {
        await r.users.fetch();
        if (r.users.cache.has(user.id)) await r.users.remove(user.id);
      } catch {
        /* best-effort */
      }
    }
  } catch (err) {
    console.warn("Erreur vote rank :", err.message);
  }
}
