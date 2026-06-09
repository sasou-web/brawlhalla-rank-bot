import { getPlayerProfile, getLegends } from "./brawlhalla.js";
import { applyMemberRoles, applyMainLegendRole } from "./roles.js";
import { setLink, getLink } from "./store.js";
import { getSettings } from "./settings.js";
import { tierIndex, SMURF_JUMP_THRESHOLD, MAIN_LEGEND_MIN_GAMES } from "./config.js";
import { recordRating } from "./ratingStore.js";

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

  // Profil PARTIEL (un appel secondaire a echoue cote API) : on ne doit pas retirer un role
  // ni ecraser une donnee juste parce qu'elle manque temporairement. On fusionne avec la
  // derniere donnee connue du membre (le 2v2/level precedents sont conserves).
  let tiers = profile.tiers;
  let level = profile.level;
  let globalRank = profile.globalRank;
  let region = profile.region && profile.region !== "?" ? profile.region : null;
  if (profile.partial && previous) {
    tiers = {
      "1v1": profile.tiers?.["1v1"] ?? previous.tiers?.["1v1"] ?? null,
      "2v2": profile.tiers?.["2v2"] ?? previous.tiers?.["2v2"] ?? null,
    };
    level = profile.level || previous.level || 0;
    globalRank = profile.globalRank || previous.globalRank || 0;
    region = region || previous.region || null;
  }

  const result = await applyMemberRoles(member, { tiers, level, globalRank, region }, rolesByName);

  await setLink(member.id, brawlhallaId, profile.name ?? member.user.username, {
    tiers,
    rating1v1: profile.ratings["1v1"],
    rating2v2: profile.ratings["2v2"],
    level,
    globalRank,
    region,
  });

  // Historique de rating (pour la courbe /progression). Best-effort : ne bloque pas la synchro.
  // On n'enregistre pas sur un profil partiel (donnees ratings non fiables).
  if (!profile.partial) {
    recordRating(brawlhallaId, {
      rating1v1: profile.ratings["1v1"],
      rating2v2: profile.ratings["2v2"],
      level,
      globalRank,
    }).catch(() => {});
  }

  // Annonce de montee de tier (uniquement si un tier precedent existait et a augmente).
  await announcePromotions(member, previous?.tiers, tiers);

  // Detection de smurf : bond de rating 1v1 anormal entre deux synchros -> alerte staff.
  if (!profile.partial) {
    await detectSmurf(member, previous?.rating1v1, profile.ratings["1v1"]);
  }

  // Role "main legende" : legende la plus jouee (stats globales). Best-effort.
  await applyMainLegend(member, profile);

  return { profile, tiers, ratings: profile.ratings, level, globalRank, region, ...result };
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
