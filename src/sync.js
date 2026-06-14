import { getPlayerProfile, getLegends } from "./brawlhalla.js";
import { applyMemberRoles, applyMainLegendRole, ensureRoles, updateTopServerRole } from "./roles.js";
import { setLink, getLink, getAllLinks } from "./store.js";
import { getSettings } from "./settings.js";
import { tierIndex, SMURF_JUMP_THRESHOLD, MAIN_LEGEND_MIN_GAMES } from "./config.js";
import { recordRating } from "./ratingStore.js";
import { getCounter, grantAndAnnounce } from "./achievements.js";

/**
 * Recupere le profil d'un joueur, applique tous ses roles (tiers, niveau, top),
 * met a jour la liaison stockee, et annonce une eventuelle montee de tier.
 * Renvoie { profile, tiers, ratings, level, globalRank, added, removed }.
 */
export async function syncMember(member, brawlhallaId, rolesByName, opts = {}) {
  const previous = await getLink(member.id);
  // Reutilise un profil deja recupere (ex: /lier vient de l'obtenir) pour eviter un
  // second appel API redondant. Sinon, fetch force pour avoir les donnees les plus fraiches.
  const profile = opts.profile ?? (await getPlayerProfile(brawlhallaId, { force: true }));

  // Indisponibilité PONCTUELLE de l'API : on ne doit jamais retirer un rôle ni écraser une
  // donnée juste parce qu'elle manque temporairement (404/glitch/rejet réseau). On fusionne
  // alors avec la dernière donnée connue du membre, MODE PAR MODE (1v1 / 2v2 indépendants).
  let tiers = { ...profile.tiers };
  let level = profile.level;
  let globalRank = profile.globalRank;
  let region = profile.region && profile.region !== "?" ? profile.region : null;
  let rating1v1 = profile.ratings?.["1v1"] ?? 0;
  let rating2v2 = profile.ratings?.["2v2"] ?? 0;

  if (previous) {
    // 1v1 indisponible (l'endpoint ranked_1v1 a répondu 404/vide) : le tier null vient d'un
    // manque d'info, pas d'un déclassement. On conserve le dernier rank 1v1 connu.
    if (!profile.ranked1v1Available) {
      tiers["1v1"] = profile.tiers?.["1v1"] ?? previous.tiers?.["1v1"] ?? null;
      rating1v1 = rating1v1 || previous.rating1v1 || 0;
    }
    // 2v2 indisponible (l'endpoint teams n'a rien renvoyé) : idem, on garde le rank 2v2 connu.
    if (profile.teamsUnavailable) {
      tiers["2v2"] = profile.tiers?.["2v2"] ?? previous.tiers?.["2v2"] ?? null;
      rating2v2 = rating2v2 || previous.rating2v2 || 0;
    }
    // Profil globalement partiel (appel /all rejeté) : niveau/rang/région peuvent manquer.
    if (profile.partial) {
      level = profile.level || previous.level || 0;
      globalRank = profile.globalRank || previous.globalRank || 0;
      region = region || previous.region || null;
    }
  }

  const result = await applyMemberRoles(member, { tiers, level, globalRank, region }, rolesByName);

  await setLink(member.id, brawlhallaId, profile.name ?? member.user.username, {
    tiers,
    rating1v1,
    rating2v2,
    level,
    globalRank,
    region,
  });

  // Historique de rating (pour la courbe /progression). Best-effort : ne bloque pas la synchro.
  // On n'enregistre pas sur un profil partiel (donnees ratings non fiables).
  if (!profile.partial) {
    recordRating(brawlhallaId, {
      rating1v1,
      rating2v2,
      level,
      globalRank,
    }).catch(() => {});
  }

  // Annonce de montee de tier (uniquement si un tier precedent existait et a augmente).
  await announcePromotions(member, previous?.tiers, tiers);

  // Detection de smurf : bond de rating 1v1 anormal entre deux synchros -> alerte staff.
  if (!profile.partial && profile.ranked1v1Available) {
    await detectSmurf(member, previous?.rating1v1, profile.ratings["1v1"]);
  }

  // Role "main legende" : legende la plus jouee (stats globales). Best-effort.
  await applyMainLegend(member, profile);

  // Achievements liés au rank/niveau/top. Le rattrapage initial s'étant fait en silence,
  // les déblocages suivants sont annoncés dans le salon dédié (sans ping).
  try {
    grantAndAnnounce(member.guild, member.id, {
      linked: true,
      tier1v1: tiers?.["1v1"] ?? null,
      tier2v2: tiers?.["2v2"] ?? null,
      level,
      globalRank,
      clips: getCounter(member.guild.id, member.id, "clips"),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }

  return { profile, tiers, ratings: profile.ratings, level, globalRank, region, ...result };
}

// Garde anti-chevauchement partagée : un refresh complet est séquentiel (1 appel API forcé par
// membre) et peut être long. On évite que deux refresh globaux tournent en même temps.
let syncingAll = false;
export function isSyncingAll() {
  return syncingAll;
}

/**
 * Resynchronise TOUS les membres liés du serveur : (re)crée les rôles gérés si besoin,
 * applique à chacun ses rôles de rank (1v1 + 2v2, niveau, top, région) en corrigeant les
 * manquants/erronés, puis met à jour le rôle « n°1 du serveur ». Best-effort par membre.
 * `rolesByName` peut être fourni (contexte du bot) ; sinon il est calculé via ensureRoles.
 * Renvoie { ok, fail, total }. Lève si un refresh est déjà en cours.
 */
export async function syncAllMembers(guild, rolesByName = null) {
  if (syncingAll) throw new Error("Une actualisation est déjà en cours.");
  syncingAll = true;
  try {
    const roles = rolesByName ?? (await ensureRoles(guild));
    const links = await getAllLinks();
    const entries = Object.entries(links);
    let ok = 0;
    let fail = 0;
    for (const [discordId, { brawlhallaId }] of entries) {
      try {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;
        await syncMember(member, brawlhallaId, roles);
        ok++;
      } catch {
        fail++;
      }
    }

    // Met à jour le rôle « n°1 du serveur » après avoir rafraîchi tous les ratings.
    try {
      await updateTopServerRole(guild);
    } catch {
      /* best-effort */
    }

    return { ok, fail, total: entries.length };
  } finally {
    syncingAll = false;
  }
}

async function announcePromotions(member, oldTiers, newTiers) {
  if (!oldTiers) return; // premiere liaison : pas d'annonce
  try {
    const { announceChannelId } = await getSettings();
    if (!announceChannelId) return;

    const promos = [];
    for (const mode of ["1v1", "2v2"]) {
      const oldIdx = tierIndex(oldTiers[mode]);
      const newIdx = tierIndex(newTiers[mode]);
      if (newIdx > oldIdx && oldIdx >= 0) promos.push(`**${newTiers[mode]}** en ${mode}`);
    }
    if (promos.length === 0) return;

    const ch = await member.guild.channels.fetch(announceChannelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send(`🎉 <@${member.id}> est passé ${promos.join(" et ")} ! GG 🔥`);
    }
  } catch {
    /* annonce best-effort */
  }
}

/**
 * Alerte le staff (salon d'audit) si le rating 1v1 d'un membre fait un bond anormal
 * entre deux synchros (>= SMURF_JUMP_THRESHOLD). Indice possible de smurf/boost.
 * Best-effort : n'interrompt jamais la synchro.
 */
async function detectSmurf(member, oldRating, newRating) {
  try {
    const prev = Math.floor(oldRating || 0);
    const now = Math.floor(newRating || 0);
    if (prev <= 0) return; // pas de point de comparaison fiable (1re synchro / non classe)
    const jump = now - prev;
    if (jump < SMURF_JUMP_THRESHOLD) return;

    const { auditChannelId } = await getSettings();
    if (!auditChannelId) return;
    const ch = await member.guild.channels.fetch(auditChannelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send(
        `⚠️ **Saut de rating inhabituel** — <@${member.id}> : **${prev} → ${now}** en 1v1 (+${jump}).\n` +
          `Climb très rapide : possible **smurf** ou compte boosté. À vérifier 👀`,
      );
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Determine la legende la plus jouee du membre (stats globales) et lui attribue le role
 * "main legende" correspondant. Ignore si aucune legende n'atteint le minimum de games
 * (evite d'attribuer un main sur 2-3 parties). Best-effort.
 */
async function applyMainLegend(member, profile) {
  try {
    const legends = Array.isArray(profile.legendsAll) ? profile.legendsAll : [];
    if (!legends.length) return; // pas de donnee (profil partiel / non fetch) : on ne touche a rien

    let best = null;
    for (const l of legends) {
      const games = l.games ?? 0;
      if (games >= MAIN_LEGEND_MIN_GAMES && (!best || games > (best.games ?? 0))) best = l;
    }
    if (!best) return;

    const legendsMap = await getLegends();
    const info = legendsMap.get(best.legend_id);
    const name = info?.name;
    if (!name) return;

    await applyMainLegendRole(member, name);
  } catch {
    /* best-effort : ne bloque jamais la synchro */
  }
}
