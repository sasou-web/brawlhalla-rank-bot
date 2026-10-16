import { highestTier, seasonRoleName, SEASON_ROLE_COLOR } from "./config.js";
import { getAllLinks } from "./store.js";
import { ensureRole } from "./roles.js";

/**
 * Récompenses de fin de saison : badge PERMANENT attribué selon le plus haut tier
 * atteint par le membre (1v1, 2v2 ou 3v3) durant la saison. Ces rôles ne sont jamais retirés
 * par /reset-saison (ce sont des trophées d'historique : "🏅 S3 Diamond").
 */

/**
 * Tier de récompense d'un membre (fonction PURE) : le plus haut tier entre 1v1, 2v2 et 3v3, pic
 * de la saison (`peakTiers`, enregistré à chaque synchro) ou tier courant (`tiers`, qui sert
 * seul de repli tant qu'aucun pic n'est connu). null si aucun rank.
 * `tiers` / `peakTiers` = { "1v1": "Gold"|null, "2v2": "Diamond"|null, "3v3": "Platinum"|null }.
 */
export function seasonRewardTier(tiers, peakTiers = null) {
  return highestTier([...Object.values(tiers || {}), ...Object.values(peakTiers || {})]);
}

/**
 * Attribue à chaque membre lié son badge de saison selon son meilleur tier de la saison.
 * Crée les rôles à la demande. Best-effort. Renvoie { awarded, byTier, season }.
 */
export async function awardSeasonRewards(guild, season) {
  const links = await getAllLinks();
  let awarded = 0;
  const byTier = {};
  for (const [discordId, link] of Object.entries(links)) {
    const tier = seasonRewardTier(link.tiers, link.peakTiers);
    if (!tier) continue;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;

    const name = seasonRoleName(season, tier);
    let role = guild.roles.cache.find((r) => r.name === name);
    if (!role) {
      try {
        role = await ensureRole(guild, name, SEASON_ROLE_COLOR);
      } catch {
        continue; // creation impossible (permissions) : on passe
      }
    }
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Récompense de saison ${season}`).catch(() => {});
    }
    awarded++;
    byTier[tier] = (byTier[tier] || 0) + 1;
  }
  return { awarded, byTier, season };
}
