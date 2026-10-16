import {
  TIERS,
  TIER_COLORS,
  ROLE_PREFIX,
  roleName,
  VALIDATOR_ROLE_NAME,
  TOP_ROLE_NAME,
  TOP_RANK_MAX,
  TOP_ROLE_COLOR,
  HOME_REGION,
  TOP_REGION_ROLE_NAME,
  TOP_REGION_ROLE_COLOR,
  TOP_SERVER_ROLE_NAME,
  TOP_SERVER_ROLE_COLOR,
  MAIN_LEGEND_ROLE_PREFIX,
  MAIN_LEGEND_ROLE_COLOR,
  SERVER_LEVEL_TIERS,
  REGIONS,
  regionRoleName,
  REGION_ROLE_COLOR,
} from "./config.js";
import { getAllLinks } from "./store.js";

// Tous les noms de roles geres par le bot (tiers 1v1/2v2/3v3 + top mondial/regional + regions).
export function managedRoleNames() {
  const names = new Set();
  for (const mode of Object.keys(ROLE_PREFIX)) {
    for (const tier of TIERS) names.add(roleName(mode, tier));
  }
  names.add(TOP_ROLE_NAME);
  names.add(TOP_REGION_ROLE_NAME);
  for (const region of REGIONS) names.add(regionRoleName(region));
  return names;
}

// Roles "saisonniers" (remis a zero en fin de saison) : tiers + tops mondial/regional (pas les niveaux).
export function seasonalRoleNames() {
  const names = new Set();
  for (const mode of Object.keys(ROLE_PREFIX)) {
    for (const tier of TIERS) names.add(roleName(mode, tier));
  }
  names.add(TOP_ROLE_NAME);
  names.add(TOP_REGION_ROLE_NAME);
  return names;
}

export async function ensureRole(guild, name, color, opts = {}) {
  let role = guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    role = await guild.roles.create({
      name,
      colors: { primaryColor: color ?? 0x99aab5 },
      hoist: opts.hoist ?? false,
      reason: "Role Brawlhalla cree automatiquement",
      mentionable: false,
    });
  }
  return role;
}

/**
 * S'assure que tous les roles geres existent. Renvoie une Map nom -> Role.
 */
export async function ensureRoles(guild) {
  await guild.roles.fetch();
  const byName = new Map();

  for (const mode of Object.keys(ROLE_PREFIX)) {
    for (const tier of TIERS) {
      const name = roleName(mode, tier);
      byName.set(name, await ensureRole(guild, name, TIER_COLORS[tier]));
    }
  }
  byName.set(TOP_ROLE_NAME, await ensureRole(guild, TOP_ROLE_NAME, TOP_ROLE_COLOR));
  byName.set(TOP_REGION_ROLE_NAME, await ensureRole(guild, TOP_REGION_ROLE_NAME, TOP_REGION_ROLE_COLOR));

  // Roles de region (attribues selon la region du compte Brawlhalla lie).
  for (const region of REGIONS) {
    const name = regionRoleName(region);
    byName.set(name, await ensureRole(guild, name, REGION_ROLE_COLOR));
  }

  return byName;
}

/**
 * Recrée les rôles gérés manquants (ensureRoles) et met à jour EN PLACE la map `target`
 * (ctx.rolesByName, partagée par /lier, /refresh, le dashboard…). Un rôle supprimé par un
 * admin y laisserait sinon un ID fantôme : tous les `roles.add` de ce tier échoueraient
 * jusqu'au redémarrage. Lève si Discord refuse : la map n'est alors pas modifiée.
 */
export async function refreshRankRoles(guild, target) {
  const fresh = await ensureRoles(guild);
  target.clear();
  for (const [name, role] of fresh) target.set(name, role);
  return target;
}

/**
 * S'assure que le role validateur existe. Renvoie son id.
 */
export async function ensureValidatorRole(guild) {
  await guild.roles.fetch();
  const role = await ensureRole(guild, VALIDATOR_ROLE_NAME, 0x2ecc71);
  return role.id;
}

/**
 * S'assure que le role "n°1 du serveur" existe. Renvoie le Role.
 */
export async function ensureTopServerRole(guild) {
  await guild.roles.fetch();
  return ensureRole(guild, TOP_SERVER_ROLE_NAME, TOP_SERVER_ROLE_COLOR);
}

/**
 * Attribue au membre le role "main legende" correspondant a sa legende la plus jouee.
 * - Cree le role A LA DEMANDE s'il n'existe pas (un role par legende, prefixe commun).
 * - Retire tout autre role "main legende" que le membre aurait (echange propre).
 * - Si legendName est vide (pas de main fiable), ne touche a rien.
 * Best-effort.
 */
export async function applyMainLegendRole(member, legendName) {
  if (!legendName) return;
  const targetName = `${MAIN_LEGEND_ROLE_PREFIX}${legendName}`.slice(0, 100);

  let role = member.guild.roles.cache.find((r) => r.name === targetName);
  if (!role) {
    try {
      role = await ensureRole(member.guild, targetName, MAIN_LEGEND_ROLE_COLOR);
    } catch {
      return; // creation impossible (permissions) : on abandonne proprement
    }
  }

  // Retire les autres roles "main legende" du membre (il n'en garde qu'un).
  const toRemove = member.roles.cache.filter((r) => r.name.startsWith(MAIN_LEGEND_ROLE_PREFIX) && r.id !== role.id);
  if (toRemove.size) await member.roles.remove([...toRemove.keys()], "Maj main légende").catch(() => {});
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, "Main légende").catch(() => {});
}

/**
 * Attribue le role "n°1 du serveur" au membre lie ayant le plus haut rating 1v1 PARMI CEUX
 * ENCORE SUR LE SERVEUR, et le retire de tous les autres. Best-effort, base sur les ratings
 * stockes (aucun appel API Brawlhalla). A appeler apres un refresh global.
 * Renvoie { topId, rating, roleId } ou null.
 */
export async function updateTopServerRole(guild) {
  const links = await getAllLinks();
  const entries = Object.entries(links)
    .filter(([, l]) => (l.rating1v1 || 0) > 0)
    .sort((a, b) => (b[1].rating1v1 || 0) - (a[1].rating1v1 || 0));

  // Un membre parti garde sa liaison (unicité anti-vol de compte) : s'il etait le meilleur,
  // la couronne etait retiree au vrai n°1 et donnee a personne. On prend le premier present.
  let top = null;
  let topMember = null;
  for (const entry of entries) {
    topMember = guild.members.cache.get(entry[0]) ?? (await guild.members.fetch(entry[0]).catch(() => null));
    if (topMember) {
      top = entry;
      break;
    }
  }
  if (!top) return null;
  const topId = top[0];

  const role = await ensureTopServerRole(guild);

  // Retire le role de quiconque l'a mais n'est plus le n°1.
  for (const m of role.members.values()) {
    if (m.id !== topId) await m.roles.remove(role, "N'est plus n°1 du serveur").catch(() => {});
  }
  // Donne-le au n°1 s'il ne l'a pas deja.
  if (!topMember.roles.cache.has(role.id)) {
    await topMember.roles.add(role, "N°1 elo 1v1 du serveur").catch(() => {});
  }

  return { topId, rating: top[1].rating1v1 || 0, roleId: role.id };
}

/**
 * S'assure que les roles de NIVEAU DE SERVEUR existent (couleurs Brawlhalla), et qu'ils sont
 * "affiches separement" (hoist). Renvoie une Map level(number) -> roleId. Ne touche pas aux
 * roles de rank.
 *
 * Positionnement : Tin (bas) ... Valhallan (haut) pour la precedence de couleur quand le cumul
 * de recompenses (stackRewards) est actif. MAIS on ne reordonne QUE si un role vient d'etre
 * cree, ou si l'ordre RELATIF entre les roles de niveau est casse. Ainsi le bot ne deplace plus
 * les roles a chaque demarrage et respecte l'emplacement choisi par l'admin dans la liste.
 */
export async function ensureServerLevelRoles(guild) {
  await guild.roles.fetch();
  const byLevel = new Map();
  let createdAny = false;
  for (const tier of SERVER_LEVEL_TIERS) {
    const existed = guild.roles.cache.some((r) => r.name === tier.name);
    const role = await ensureRole(guild, tier.name, tier.color, { hoist: true });
    if (!existed) createdAny = true;
    // Roles deja presents mais non "affiches separement" : on active le hoist (best-effort).
    if (existed && !role.hoist) await role.setHoist(true, "Roles de niveau affiches separement").catch(() => {});
    byLevel.set(tier.level, role.id);
  }

  try {
    const ordered = SERVER_LEVEL_TIERS.map((t) => guild.roles.cache.get(byLevel.get(t.level))).filter(Boolean);
    // Ordre relatif correct = positions strictement croissantes selon l'ordre des tiers.
    const positions = ordered.map((r) => r.position);
    const relativeOk = positions.every((p, i) => i === 0 || p > positions[i - 1]);

    // On ne touche aux positions que si c'est necessaire (creation ou ordre casse), pour ne
    // PAS combattre un deplacement manuel de l'admin a chaque redemarrage.
    if (ordered.length && (createdAny || !relativeOk)) {
      const me = guild.members.me;
      const maxPos = me ? me.roles.highest.position : null;
      const updates = ordered.map((role, i) => ({ role, position: i + 1 }));
      if (maxPos && updates.every((u) => u.position < maxPos)) {
        await guild.roles.setPositions(updates).catch(() => {});
      }
    }
  } catch {
    /* le positionnement est best-effort : si ca echoue, les roles existent quand meme */
  }

  return byLevel;
}

/**
 * Applique au membre l'ensemble de ses roles Brawlhalla calcules.
 * info = { tiers: {"1v1","2v2","3v3"}, level, globalRank, region, regionRank }
 * Retire les autres roles geres qu'il ne devrait plus avoir.
 */
export async function applyMemberRoles(member, info, rolesByName) {
  const managed = managedRoleNames();
  const target = new Set();

  for (const [mode, tier] of Object.entries(info.tiers || {})) {
    if (tier) target.add(roleName(mode, tier));
  }
  if (info.globalRank && info.globalRank >= 1 && info.globalRank <= TOP_RANK_MAX) {
    target.add(TOP_ROLE_NAME);
  }
  if (info.region) {
    target.add(regionRoleName(info.region));
  }
  // Top 100 regional : seulement pour la region maison (un top 100 US-E n'a pas le role EU).
  if (info.region === HOME_REGION && info.regionRank >= 1 && info.regionRank <= TOP_RANK_MAX) {
    target.add(TOP_REGION_ROLE_NAME);
  }

  const toAdd = [];
  const toRemove = [];
  for (const name of managed) {
    const role = rolesByName.get(name);
    if (!role) continue;
    const has = member.roles.cache.has(role.id);
    const shouldHave = target.has(name);
    if (shouldHave && !has) toAdd.push(role);
    if (!shouldHave && has) toRemove.push(role);
  }

  if (toAdd.length) await member.roles.add(toAdd, "Mise a jour Brawlhalla");
  if (toRemove.length) await member.roles.remove(toRemove, "Mise a jour Brawlhalla");

  return { added: toAdd.map((r) => r.name), removed: toRemove.map((r) => r.name) };
}
