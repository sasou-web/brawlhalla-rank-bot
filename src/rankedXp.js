import { SMURF_JUMP_THRESHOLD } from "./config.js";
import { addBonusXp, getLevelConfig } from "./levels.js";
import { getCounter, incrCounter } from "./achievements.js";
import { handleLevelUp } from "./xpEvents.js";

/**
 * XP liée aux parties ranked : chaque partie classée jouée (et gagnée) depuis la dernière
 * synchro rapporte de l'XP de niveau. Aucun appel API en plus : on compare les compteurs
 * games/wins du profil fraîchement récupéré par syncMember à ceux gardés dans le lien
 * (`link.rankedCounters` = { "1v1": { games, wins }, "2v2": …, "3v3": … }).
 * Les compteurs sont suivis même XP de jeu désactivée : l'activer plus tard ne verse pas
 * d'un coup les parties passées.
 */

export const RANKED_XP_MODES = ["1v1", "2v2", "3v3"];

const count = (v) => Math.max(0, Math.floor(Number(v) || 0));

// Jour calendaire (UTC), comme le plafond général des niveaux.
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function gameXpDayKey(day = todayKey()) {
  return `game_xp:${day}`;
}

/**
 * Compteurs games/wins par mode lus dans le profil (fonction PURE). null pour un mode sans
 * donnée fiable cette fois (404, endpoint en échec ou sauté) : son ancienne base est gardée.
 * 2v2 = somme de toutes les équipes de /player/teams.
 */
export function rankedCountersFromProfile(profile) {
  const teams = Array.isArray(profile?.teams) ? profile.teams : [];
  return {
    "1v1": profile?.ranked1v1Available === true ? { games: count(profile.games1v1), wins: count(profile.wins1v1) } : null,
    "2v2":
      profile?.teamsUnavailable === false
        ? { games: teams.reduce((n, t) => n + count(t?.games), 0), wins: teams.reduce((n, t) => n + count(t?.wins), 0) }
        : null,
    "3v3": profile?.ranked3v3Available === true ? { games: count(profile.games3v3), wins: count(profile.wins3v3) } : null,
  };
}

// Réglages XP de jeu nettoyés (le dashboard enregistre les valeurs telles quelles).
export function gameXpSettings(cfg = {}) {
  const modes = Array.isArray(cfg.gameXpModes) ? cfg.gameXpModes.filter((m) => RANKED_XP_MODES.includes(m)) : RANKED_XP_MODES;
  return {
    enabled: cfg.gameXpEnabled === true,
    perGame: count(cfg.xpPerRankedGame),
    perWin: count(cfg.xpPerRankedWin),
    dailyCap: count(cfg.gameXpDailyCap),
    modes,
  };
}

/**
 * Calcule l'XP due entre deux relevés de compteurs (fonction PURE).
 * - prev : compteurs du lien (absent = première synchro ou nouveau compte lié).
 * - next : rankedCountersFromProfile (null par mode = pas de donnée, base gardée).
 * - cfg  : gameXpSettings ; xpToday = XP de jeu déjà accordée aujourd'hui.
 * Un mode sans base, ou dont un compteur a baissé (nouvelle saison), est re-basé sans XP.
 * Renvoie { games, wins, xp, counters, rebaseline } ; `counters` est à stocker dans le lien.
 */
export function rankedXpDelta(prev, next, cfg, xpToday = 0) {
  const counters = {};
  let games = 0;
  let wins = 0;
  let rebaseline = false;
  for (const mode of RANKED_XP_MODES) {
    const before = prev?.[mode] ?? null;
    const now = next?.[mode] ?? null;
    if (!now) {
      if (before) counters[mode] = before;
      continue;
    }
    counters[mode] = { games: now.games, wins: now.wins };
    if (!before || now.games < before.games || now.wins < before.wins) {
      rebaseline = true;
      continue;
    }
    if (!cfg.modes.includes(mode)) continue;
    const g = now.games - before.games;
    games += g;
    wins += Math.min(g, now.wins - before.wins);
  }

  let xp = cfg.enabled ? games * cfg.perGame + wins * cfg.perWin : 0;
  if (cfg.dailyCap > 0) xp = Math.min(xp, Math.max(0, cfg.dailyCap - count(xpToday)));
  return { games, wins, xp, counters, rebaseline };
}

/**
 * Prépare l'XP de jeu d'une synchro, AVANT setLink (qui remplace tout le lien) :
 * renvoie { counters, xp } où `counters` est à passer à setLink. Ne lève jamais.
 * Profil partiel (repli cache/index local, appel secondaire en échec) : ni XP ni re-base.
 */
export async function planRankedXp(member, brawlhallaId, profile, previous) {
  const sameAccount = previous && String(previous.brawlhallaId) === String(brawlhallaId);
  const prevCounters = sameAccount ? previous.rankedCounters ?? null : null;
  try {
    if (profile?.partial) return { counters: prevCounters, xp: 0 };
    const cfg = gameXpSettings(await getLevelConfig(member.guild.id));
    const xpToday = getCounter(member.guild.id, member.id, gameXpDayKey());
    const r = rankedXpDelta(prevCounters, rankedCountersFromProfile(profile), cfg, xpToday);
    // Bond de rating 1v1 suspect (smurf/boost, cf. detectSmurf) : pas d'XP sur cette synchro.
    const oldRating = Math.floor(previous?.rating1v1 || 0);
    const smurf = sameAccount && profile.ranked1v1Available && oldRating > 0 && Math.floor(profile.ratings?.["1v1"] || 0) - oldRating >= SMURF_JUMP_THRESHOLD;
    return { counters: r.counters, xp: smurf ? 0 : r.xp };
  } catch {
    return { counters: prevCounters, xp: 0 };
  }
}

/**
 * Accorde l'XP préparée par planRankedXp (plafond général des niveaux compris, via
 * addBonusXp) et gère la montée de niveau. Best-effort : ne bloque jamais la synchro.
 */
export async function awardRankedXp(member, plan) {
  if (!(plan?.xp > 0)) return null;
  try {
    const r = await addBonusXp(member.guild.id, member.id, plan.xp);
    if (r?.gain > 0) incrCounter(member.guild.id, member.id, gameXpDayKey(), r.gain);
    if (r?.leveledUp) await handleLevelUp(member.guild, member, r.level, r.oldLevel, null).catch(() => {});
    return r;
  } catch {
    return null;
  }
}
