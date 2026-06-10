import { highestTier, seasonRoleName, SEASON_ROLE_COLOR } from "./config.js";
import { getAllLinks } from "./store.js";
import { ensureRole } from "./roles.js";

/**
 * Récompenses de fin de saison : badge PERMANENT attribué selon le plus haut tier
 * atteint par le membre (1v1 ou 2v2) durant la saison. Ces rôles ne sont jamais retirés
 * par /reset-saison (ce sont des trophées d'historique : "🏅 S3 Diamond").
 */

/**
 * Tier de récompense d'un membre (fonction PURE) : le plus haut tier entre 1v1 et 2v2,
 * ou null si aucun rank. `tiers` = { "1v1": "Gold"|null, "2v2": "Diamond"|null }.
 */
export function seasonRewardTier(tiers) {
  return highestTier(tiers || {});
}

/**
 * Attribue à chaque membre lié son badge de saison selon son plus haut tier enregistré.
 * Crée les rôles à la demande. Best-effort. Renvoie { awarded, byTier, season }.
 */
export async function awardSeasonRewards(guild, season) {
  const links = await getAllLinks();
  let awarded = 0;
  const byTier = {};
  for (const [discordId, link] of Object.entries(links)) {
    const tier = seasonRewardTier(link.tiers);
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
