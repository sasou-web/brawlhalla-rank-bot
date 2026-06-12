import { config, TIERS, RANKED_TIERS, BH_API_BASE } from "./config.js";
import { getProfileEntry, setProfileEntry, getWarmIds } from "./profileStore.js";
import { getSearchEntry, setSearchEntry } from "./searchStore.js";
import { upsertPlayers, searchLocalPlayers, markSynced, getIndexStats, getLocalPlayer } from "./leaderboardStore.js";
import { recordOutcome, recordRetry, recordCooldown, snapshot as metricsSnapshot } from "./apiMetrics.js";
import { addPending, removePending, loadPending, prunePending } from "./pendingStore.js";

/**
 * Client de l'API officielle Brawlhalla v1.
 * Depuis la v1.0, AUCUNE cle API n'est requise (endpoints publics).
 * On garde toutefois la logique de tier (calcul par rating + gestion Valhallan)
 * inspiree de corehalla/bhapi.
 */

// Limiteur de concurrence : au lieu de serialiser STRICTEMENT toutes les requetes
// (1 toutes les 400 ms = 2,5 req/s pour tout le bot, ce qui faisait que les commandes
// interactives /lier /stats /rank attendaient derriere les boucles de refresh/warm en
// arriere-plan), on autorise jusqu'a MAX_CONCURRENCY requetes en parallele.
// NOTE : l'origine Brawlhalla rate-limite/502 desormais quand on l'inonde (teste : des
// rafales font tomber le taux de succes a ~10%). On garde donc une concurrence FAIBLE
// pour ne pas aggraver, et on s'appuie sur le retry par fenetres + l'index local.
const MAX_CONCURRENCY = Number(process.env.API_MAX_CONCURRENCY || 3);
let _active = 0;
const _waiters = [];

// Cache persistant des profils (sur disque) : reduit les appels et resiste aux pannes API.
const PROFILE_TTL_MS = 15 * 60 * 1000;
const inflight = new Map(); // brawlhallaId -> Promise (dedup des fetchs concurrents)

// Files de recuperation en arriere-plan : ce qui a echoue a cause de l'API est reessaye
// en boucle jusqu'a reussir, puis stocke en base. Garantit que la PROCHAINE commande marche.
// PERSISTEES en SQLite (pendingStore) : les files survivent a un redemarrage. On les
// hydrate au demarrage et on purge ce qui traine depuis > 7 jours (hygiene).
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
prunePending(PENDING_MAX_AGE_MS);
const pendingProfiles = new Set(loadPending("profile")); // brawlhallaId (string)
const pendingSearches = new Set(loadPending("search")); // pseudo recherche (string brut)

// Mutations miroir mémoire + SQLite (pour que les files survivent au restart).
function addPendingProfile(id) {
  const k = String(id);
  if (!pendingProfiles.has(k)) {
    pendingProfiles.add(k);
    addPending("profile", k);
  }
}
function delPendingProfile(id) {
  const k = String(id);
  if (pendingProfiles.delete(k)) removePending("profile", k);
}
function addPendingSearch(name) {
  if (!pendingSearches.has(name)) {
    pendingSearches.add(name);
    addPending("search", name);
  }
}
function delPendingSearch(name) {
  if (pendingSearches.delete(name)) removePending("search", name);
}

function _acquireSlot() {
  if (_active < MAX_CONCURRENCY) {
    _active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _waiters.push(resolve));
}

function _releaseSlot() {
  const next = _waiters.shift();
  if (next) next(); // on garde le slot pour le prochain en attente
  else _active--;
}

// En-tetes "navigateur" : l'API Brawlhalla est derriere Cloudflare, qui renvoie souvent
// des 5xx/403 aux requetes sans User-Agent depuis des IP de datacenter (Hetzner, etc.).
// Un User-Agent realiste suffit generalement a debloquer ces requetes.
const BROWSER_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// Gate global de cooldown : sur un 429/503, on repousse TOUTES les requetes jusqu'a ce
// timestamp (cooperation du rate-limit a l'echelle du bot, pas juste par requete).
let cooldownUntil = 0;
const COOLDOWN_CAP_MS = 15000; // un cooldown global ne bloque jamais plus de 15s

async function throttledFetch(url) {
  await _acquireSlot();
  try {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait); // respecte le cooldown global avant de taper l'API
    return await fetch(url, { headers: BROWSER_HEADERS });
  } finally {
    _releaseSlot();
  }
}

// Budget de temps total pour decrocher un 200 malgre les 429/502 intermittents.
// On retape avec un BACKOFF EXPONENTIEL + jitter tant que la fenetre n'est pas ecoulee.
const RETRY_BUDGET_MS = Number(process.env.API_RETRY_BUDGET_MS || 30000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry-After (en secondes) si l'entete est exploitable, sinon null.
function parseRetryAfter(header) {
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Backoff exponentiel plafonne + jitter (en secondes). La recherche (?search=) est plus
// fragile cote API : base et plafond plus eleves pour l'espacer davantage.
function backoffSeconds(attempt, params) {
  const isSearch = Boolean(params.search);
  const base = isSearch ? 2 : 1;
  const cap = isSearch ? 12 : 8;
  const exp = Math.min(cap, base * Math.pow(2, attempt)); // 1,2,4,8…  (search: 2,4,8,12)
  const jitter = Math.random() * 0.5 * exp; // jitter proportionnel pour eviter les rafales synchronisees
  return Math.min(cap, exp + jitter);
}

async function apiGet(path, params = {}, deadline = null, attempt = 0) {
  if (deadline === null) deadline = Date.now() + RETRY_BUDGET_MS;

  const url = new URL(`${BH_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let res;
  try {
    res = await throttledFetch(url);
  } catch (err) {
    recordOutcome("networkErrors", { message: err.message });
    // Erreur reseau : on reessaie avec backoff exponentiel tant qu'il reste du budget.
    if (Date.now() < deadline) {
      recordRetry();
      await sleep((backoffSeconds(attempt, params) + 0.05) * 1000);
      return apiGet(path, params, deadline, attempt + 1);
    }
    throw err;
  }

  // 429 (rate limit) ou 5xx (origine Brawlhalla qui tombe par fenetres).
  if (res.status === 429 || res.status >= 500) {
    recordOutcome(res.status === 429 ? "rateLimited" : "serverErrors", { status: res.status });
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));

    // 429 / 503 = on est explicitement limites : on pose un cooldown GLOBAL (toutes les
    // requetes du bot patientent), borne a COOLDOWN_CAP_MS pour ne pas tout figer.
    if (res.status === 429 || res.status === 503) {
      recordCooldown();
      const cd = Math.min(COOLDOWN_CAP_MS, (retryAfter ?? backoffSeconds(attempt, params)) * 1000);
      cooldownUntil = Math.max(cooldownUntil, Date.now() + cd);
    }

    if (Date.now() < deadline) {
      recordRetry();
      const waitS = retryAfter ?? backoffSeconds(attempt, params);
      await sleep((waitS + 0.05) * 1000);
      return apiGet(path, params, deadline, attempt + 1);
    }
    // Budget epuise : on lache une erreur explicite.
    const e = new Error(`API Brawlhalla temporairement indisponible (HTTP ${res.status}). Réessaie dans une minute.`);
    e.status = res.status;
    throw e;
  }
  if (!res.ok) {
    recordOutcome(res.status === 404 ? "notFound" : "otherClient", { status: res.status });
    const body = await res.text().catch(() => "");
    const short = body.slice(0, 120);
    const e = new Error(`HTTP ${res.status} sur ${path}${short ? ` : ${short}` : ""}`);
    e.status = res.status;
    throw e;
  }
  recordOutcome("ok", { status: res.status });
  return res.json();
}

/**
 * Comme apiGet, mais renvoie null sur un 404 (donnee absente, ex. pas d'equipe 2v2)
 * au lieu de lever une erreur. Les autres erreurs (502, etc.) sont propagees.
 */
async function apiGetOrNull(path, params = {}) {
  try {
    return await apiGet(path, params);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Verifie l'etat de l'API : un appel leaderboard ET un appel player (endpoints distincts
 * qui tombent parfois separement). Renvoie { leaderboard, player } avec { ok, status, ms }.
 */
export async function pingApi() {
  const check = async (url) => {
    const start = Date.now();
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      // Un endpoint qui repond (meme 404/400) est joignable : seuls les 5xx = panne.
      return { ok: res.status < 500, status: res.status, ms: Date.now() - start };
    } catch (err) {
      return { ok: false, status: 0, ms: Date.now() - start, error: err.message };
    }
  };

  const [leaderboard, player] = await Promise.all([
    check(`${BH_API_BASE}/leaderboard/ranked?game_mode=1v1&region=US-E&page=1&max_results=1`),
    // Un vrai ID stable (joueur tres connu) pour obtenir un 200 quand l'API est OK.
    check(`${BH_API_BASE}/player/stats?brawlhalla_id=104002853&mode=ranked_1v1`),
  ]);
  return { leaderboard, player };
}

/**
 * Tier de base ("Gold 4" -> "Gold"). Renvoie null si non reconnu.
 */
export function baseTier(rawTier) {
  if (!rawTier) return null;
  const base = String(rawTier).split(" ")[0];
  return TIERS.includes(base) ? base : null;
}

/**
 * Calcule le tier (avec division) a partir du rating, comme getTierFromRating de corehalla.
 */
export function tierFromRating(rating) {
  const found = RANKED_TIERS.find(([, threshold]) => rating >= threshold);
  return (found ?? RANKED_TIERS[RANKED_TIERS.length - 1])[0];
}

/**
 * Resout le tier de base d'une entree ranked (1v1 ou equipe 2v2).
 * - rating absent / <= 0 : non classe -> null
 * - tier vide/null mais rating >= 2000 : quirk API = Valhallan
 * - sinon : tier renvoye par l'API, avec repli sur le calcul par rating
 */
export function resolveBaseTier(rating, rawTier) {
  if (!rating || rating <= 0) return null;
  if (!rawTier) return rating >= 2000 ? "Valhallan" : baseTier(tierFromRating(rating));
  return baseTier(rawTier) ?? baseTier(tierFromRating(rating));
}

/**
 * Normalise une entree de leaderboard en { id, username, tier, rating, region }.
 * Gere les deux formes possibles de l'API : champ "players[0]" (recherche/equipes)
 * ou champs a plat (brawlhalla_id / name) selon les versions/endpoints.
 */
export function mapRankingEntry(r) {
  const p = r?.players?.[0] ?? r ?? {};
  return {
    id: p.id ?? p.brawlhalla_id ?? r?.brawlhalla_id,
    username: p.username ?? p.name ?? r?.name ?? "?",
    tier: r?.tier ?? p.tier ?? null,
    rating: r?.rating ?? p.rating ?? 0,
    region: r?.region ?? p.region ?? "?",
  };
}

/**
 * GET /v1/leaderboard/ranked?search= : recherche de joueurs classes par pseudo.
 *
 * Strategie de fiabilite (commande critique /lier) :
 *  1. Index LOCAL (notre base synchronisee) : si on a une correspondance exacte du
 *     pseudo, on repond INSTANTANEMENT sans aucun appel a l'API officielle (lente/502).
 *  2. Sinon, appel API live (avec retry/backoff dans apiGet), et on enrichit l'index local.
 *  3. En cas d'echec API : repli sur l'index local partiel, puis sur le cache de recherche.
 *
 * L'API v1 rejette certains caracteres speciaux (ex. '#') avec une erreur 400 : on
 * nettoie donc le terme envoye, tout en gardant le pseudo original pour le tri exact.
 * Renvoie un tableau de { id, username, tier, rating, region }.
 */
export async function searchPlayers(name, limit = 5) {
  // Garde lettres (accentuees comprises), chiffres, espaces, _ . - ; remplace le reste par espace.
  const query = name
    .replace(/[^\p{L}\p{N} _.\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!query) return [];
  const key = query.toLowerCase();
  const lowered = name.toLowerCase();

  const sortResults = (list) =>
    [...list].sort((a, b) => {
      const aExact = a.username.toLowerCase() === lowered ? 1 : 0;
      const bExact = b.username.toLowerCase() === lowered ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.rating - a.rating;
    });

  // 1) Index local : des qu'on a une correspondance locale (leaderboard synchronise OU
  // joueur deja consulte/lie), on la sert IMMEDIATEMENT. L'endpoint /search etant tres
  // instable, c'est a la fois plus rapide et bien plus fiable que de l'interroger en direct.
  const local = await searchLocalPlayers(name, 50);
  if (local.length) {
    return sortResults(local).slice(0, limit);
  }

  // 2) Aucune correspondance locale : on tente l'API (avec retry par budget).
  let data;
  try {
    data = await apiGet("/leaderboard/ranked", {
      game_mode: "1v1",
      region: "ALL",
      search: query,
      max_results: 50,
    });
  } catch (err) {
    // 3a) Repli sur l'index local partiel (meme approximatif, mieux que rien).
    if (local.length) return sortResults(local).slice(0, limit);
    // 3b) Repli sur le dernier resultat connu pour ce pseudo.
    const cached = await getSearchEntry(key);
    if (cached) return cached.results.slice(0, limit);
    // 3c) Rien en base : on programme une recuperation en arriere-plan (marchera au prochain essai).
    addPendingSearch(name);
    const e = new Error(
      `🔎 Je cherche **${name}**… l'API Brawlhalla fait des siennes en ce moment.\n` +
        `💡 Astuce : pour une **première** recherche fiable, utilise plutôt l'option **\`id\`** ` +
        `(le Brawlhalla ID, visible sur corehalla.com ou l'appli Brawlhalla).\n` +
        `Sinon je récupère le profil en arrière-plan — réessaie dans ~30 s 👍`,
    );
    e.status = err.status;
    e.pending = true;
    throw e;
  }

  const rankings = Array.isArray(data?.rankings) ? data.rankings : [];
  const results = sortResults(rankings.map(mapRankingEntry).filter((p) => p.id));

  if (results.length) {
    await setSearchEntry(key, results);
    upsertPlayers(results).catch(() => {}); // enrichit l'index local pour la prochaine fois
  }
  return results.slice(0, limit);
}

/**
 * Planifie les pages à synchroniser pour un cycle (fonction PURE, testable).
 *  - pages "chaudes" 1..shallow : toujours incluses (haut du classement, très volatil)
 *  - pages "profondes" : un bloc de `deepChunk` pages, en rotation via `deepCursor`,
 *    pour couvrir tout le classement sur plusieurs cycles sans marteler l'API.
 * `knownMaxPage` (>0) borne la zone profonde à la dernière page réellement peuplée.
 * Renvoie { pages: number[], nextCursor }.
 */
export function planLeaderboardSync({ maxPages, shallowPages, deepChunk, knownMaxPage = 0, deepCursor = 0 }) {
  const cap = knownMaxPage > 0 ? Math.min(maxPages, knownMaxPage) : maxPages;
  const shallow = Math.min(cap, Math.max(0, shallowPages || 0));
  const pages = [];
  for (let p = 1; p <= shallow; p++) pages.push(p);

  const deepCount = Math.max(0, cap - shallow);
  let nextCursor = deepCursor;
  if (deepCount > 0 && deepChunk > 0) {
    const take = Math.min(deepChunk, deepCount);
    const start = (((deepCursor % deepCount) + deepCount) % deepCount);
    for (let i = 0; i < take; i++) pages.push(shallow + 1 + ((start + i) % deepCount));
    nextCursor = (start + take) % deepCount;
  }
  return { pages, nextCursor };
}

// Etat de la rotation incrementale (persiste pour la duree du process).
let deepCursor = 0;
let knownMaxPage = 0; // derniere page connue contenant des joueurs (0 = inconnu)

/**
 * Synchronise l'index local des joueurs classes 1v1 (toutes regions) en arriere-plan.
 * C'est ce qui donne l'effet "instantane" facon Raybot : les recherches /lier /stats
 * tapent ensuite l'index local au lieu de l'API officielle.
 * INCREMENTAL : top du classement rafraichi a chaque cycle, reste balaye par rotation.
 */
export async function syncLeaderboard() {
  const maxPages = Math.max(0, config.leaderboardSyncPages || 0);
  if (maxPages === 0) return { pages: 0, players: 0 };

  const { pages, nextCursor } = planLeaderboardSync({
    maxPages,
    shallowPages: config.leaderboardSyncShallowPages || 20,
    deepChunk: config.leaderboardSyncDeepChunk || 80,
    knownMaxPage,
    deepCursor,
  });
  deepCursor = nextCursor;

  let total = 0;
  let consecutiveFails = 0;
  for (const page of pages) {
    let rankings;
    try {
      rankings = await getRankings("1v1", "ALL", page, 50);
      consecutiveFails = 0;
    } catch {
      // Page en echec (apres son budget de retry) : on la SAUTE. Si plusieurs echouent
      // d'affilee, l'API est probablement HS : on abandonne ce cycle.
      if (++consecutiveFails >= 5) break;
      await sleep(450);
      continue;
    }
    if (!rankings.length) {
      // Page vide = au-dela du classement reel : on memorise la borne pour eviter
      // de balayer du vide aux prochains cycles.
      if (knownMaxPage === 0 || page - 1 < knownMaxPage) knownMaxPage = Math.max(0, page - 1);
      await sleep(450);
      continue;
    }
    if (page > knownMaxPage) knownMaxPage = page; // on a vu des donnees plus loin que prevu
    const players = rankings.map(mapRankingEntry).filter((p) => p.id);
    await upsertPlayers(players);
    total += players.length;
    await sleep(450); // pause douce entre pages : evite de se faire rate-limiter
  }
  if (total > 0) await markSynced();
  return { players: total, pages: pages.length };
}

export { getIndexStats };

/**
 * Métriques de fiabilité de l'API (pour le dashboard et /ping) :
 * taux de succès, compteurs d'erreurs (429/5xx/réseau), cooldown global en cours,
 * profondeur des files de récupération, et fraîcheur de l'index local du leaderboard.
 */
export async function getApiMetrics() {
  const now = Date.now();
  const index = await getIndexStats().catch(() => ({ count: 0, syncedAt: 0 }));
  return metricsSnapshot({
    cooldownActiveMs: Math.max(0, cooldownUntil - now),
    pendingProfiles: pendingProfiles.size,
    pendingSearches: pendingSearches.size,
    index: {
      count: index.count,
      syncedAt: index.syncedAt || 0,
      ageMs: index.syncedAt ? now - index.syncedAt : null,
    },
  });
}

/**
 * Recupere un profil consolide d'un joueur en 3 appels paralleles :
 * - /player/stats?mode=ranked_1v1 : rating/tier/peak/region/rang + legendes classees (peak)
 * - /player/teams : equipes 2v2
 * - /player/stats?mode=all : niveau, games/wins totaux, stats par legende
 */
export async function getPlayerProfile(brawlhallaId, { force = false, allowStale = true } = {}) {
  const entry = await getProfileEntry(brawlhallaId);
  // Un profil "vide" (name "?", tout a zero) n'est PAS un vrai joueur : c'est le residu
  // d'un fetch ou tous les appels ont renvoye 404/vide. On ne le considere jamais comme
  // un cache valide -> on retente un fetch reel a la place (auto-guerison du cache pourri).
  const usableEntry = entry && !isEmptyProfile(entry.data) ? entry : null;
  const fresh = usableEntry && Date.now() - usableEntry.ts < PROFILE_TTL_MS;

  // Cache-first (stale-while-revalidate) : on sert le cache tout de suite,
  // et on rafraichit en arriere-plan s'il est perime.
  if (!force && usableEntry) {
    if (!fresh) revalidate(brawlhallaId).catch(() => addPendingProfile(brawlhallaId));
    return usableEntry.data;
  }

  // Pas de cache exploitable (ou refresh force) : on doit aller chercher en direct.
  try {
    return await revalidate(brawlhallaId);
  } catch (err) {
    // Echec API : on programme une recuperation en arriere-plan pour que la prochaine fois marche.
    addPendingProfile(brawlhallaId);
    if (allowStale && usableEntry) return usableEntry.data; // repli sur donnee perimee EXPLOITABLE
    // Dernier recours : profil minimal reconstruit depuis l'index local du leaderboard.
    // Permet a /lier d'attribuer au moins le role 1v1 meme quand l'API est totalement morte.
    if (allowStale) {
      const local = await getLocalPlayer(brawlhallaId);
      if (local) return minimalProfileFromLocal(brawlhallaId, local);
    }
    throw err;
  }
}

// Vrai si le profil ne contient AUCUNE donnee exploitable : pas de nom, aucun rating,
// niveau 0 et aucune game. C'est le residu d'un fetch ou tous les endpoints ont renvoye
// 404/vide. A ne jamais cacher ni afficher comme un vrai joueur.
function isEmptyProfile(data) {
  if (!data) return true;
  const noName = !data.name || data.name === "?";
  const noRanked = !(data.ratings?.["1v1"] > 0) && !(data.ratings?.["2v2"] > 0);
  const noActivity = !(data.level > 0) && !(data.totalGames > 0);
  return noName && noRanked && noActivity;
}

// Construit un profil minimal (forme identique a fetchPlayerProfile) a partir d'une
// entree de l'index local. Seul le 1v1 est connu ; le reste est a zero/null.
function minimalProfileFromLocal(brawlhallaId, local) {
  const rating1v1 = local.rating ?? 0;
  const tier1v1 = resolveBaseTier(rating1v1, local.tier);
  return {
    brawlhallaId,
    name: local.username ?? "?",
    level: 0,
    totalGames: 0,
    totalWins: 0,
    region: local.region ?? "?",
    globalRank: 0,
    peak1v1: rating1v1,
    games1v1: 0,
    wins1v1: 0,
    tiers: { "1v1": tier1v1, "2v2": null },
    ratings: { "1v1": rating1v1, "2v2": 0 },
    best2v2: null,
    teams: [],
    legendsRanked: [],
    legendsAll: [],
    partial: true, // donnee incomplete (API indisponible) : a rafraichir plus tard
  };
}

// Lance (ou rejoint) un fetch reel du profil, met a jour le cache disque, dedup les appels.
function revalidate(brawlhallaId) {
  const key = String(brawlhallaId);
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const data = await fetchPlayerProfile(brawlhallaId);
    await setProfileEntry(brawlhallaId, data);
    // Profil incomplet (un appel secondaire a echoue) : on le re-complete en arriere-plan.
    if (data.partial) addPendingProfile(brawlhallaId);
    // Enrichit l'index local nom->ID : tout joueur consulte (par ID, membre lie, warm...)
    // devient cherchable par pseudo ensuite, sans jamais retoucher l'endpoint /search casse.
    if (data.name && data.name !== "?") {
      upsertPlayers([
        {
          id: brawlhallaId,
          username: data.name,
          tier: data.tiers?.["1v1"] ?? null,
          rating: data.ratings?.["1v1"] ?? 0,
          region: data.region ?? "?",
        },
      ]).catch(() => {});
    }
    return data;
  })();

  inflight.set(key, p);
  // Nettoyage de l'inflight ET neutralisation de toute rejection non consommee :
  // on attache un handler dédié à `p` lui-même (pas seulement à la chaîne `.finally`),
  // pour qu'un appelant en arrière-plan qui n'attend pas le résultat ne provoque jamais
  // d'unhandledRejection. Les appelants qui veulent l'erreur reçoivent toujours `p` et la gèrent.
  p.catch(() => {});
  p.finally(() => inflight.delete(key)).catch(() => {});
  return p;
}

/**
 * Rafraichit en arriere-plan tous les profils gardes "chauds" (accedes recemment).
 * Les appels passent par la file globale throttlee, donc c'est doux pour l'API.
 */
export async function warmProfiles() {
  const ids = await getWarmIds();
  let ok = 0;
  for (const id of ids) {
    try {
      await revalidate(id);
      ok++;
    } catch {
      /* on continue malgre les erreurs API */
    }
  }
  return { total: ids.length, ok };
}

/**
 * Reessaie en arriere-plan tout ce qui a echoue a cause de l'API (profils + recherches),
 * et le stocke en base des que l'API repond. Ainsi, la commande relancee par l'utilisateur
 * trouve la donnee en cache et fonctionne, meme si l'API est encore capricieuse.
 * Appele a intervalle court par index.js.
 */
export async function retryPending() {
  let recovered = 0;

  // Profils : on force un fetch reel ; succes complet => retire de la file.
  // Si le profil revient encore partiel (un appel secondaire echoue toujours), revalidate()
  // l'a deja remis dans la file : on ne compte pas comme recupere et on reessaiera.
  for (const id of [...pendingProfiles]) {
    try {
      const data = await revalidate(id);
      if (!data?.partial) {
        delPendingProfile(id);
        recovered++;
      }
    } catch {
      /* toujours indispo : on garde pour le prochain cycle */
    }
  }

  // Recherches par pseudo : succes => searchStore + index local remplis par searchPlayers().
  for (const name of [...pendingSearches]) {
    try {
      const results = await searchPlayers(name);
      if (results.length) {
        delPendingSearch(name);
        // On pre-charge aussi le profil du meilleur resultat pour que /stats /rank marche direct.
        revalidate(results[0].id).catch(() => {});
        recovered++;
      }
    } catch {
      /* toujours indispo : on garde pour le prochain cycle */
    }
  }

  return { recovered, pendingProfiles: pendingProfiles.size, pendingSearches: pendingSearches.size };
}

async function fetchPlayerProfile(brawlhallaId) {
  // 3 appels en parallele, mais tolerants : seul l'appel principal (ranked 1v1) est requis.
  // Si /player/teams (2v2) ou /player/stats?all echouent, on construit quand meme la fiche
  // avec ce qu'on a (profil "partiel") au lieu de tout faire echouer. allSettled => pas de
  // rejet global. Les 502 par fenetres de l'origine ne cassent plus toute la commande.
  const [rankedR, teamsR, allR] = await Promise.allSettled([
    apiGetOrNull("/player/stats", { brawlhalla_id: brawlhallaId, mode: "ranked_1v1" }),
    apiGetOrNull("/player/teams", { brawlhalla_id: brawlhallaId }),
    apiGetOrNull("/player/stats", { brawlhalla_id: brawlhallaId, mode: "all" }),
  ]);

  // L'appel ranked 1v1 porte le tier/rating/region : s'il echoue, on n'a pas de donnee
  // fiable -> on propage l'erreur pour declencher le repli (cache / index local) en amont.
  if (rankedR.status === "rejected") throw rankedR.reason ?? new Error("Profil 1v1 indisponible");

  const teamsData = teamsR.status === "fulfilled" ? teamsR.value : null;
  const all = allR.status === "fulfilled" ? allR.value : null;
  const partial = teamsR.status === "rejected" || allR.status === "rejected";

  // Aucune donnee nulle part : l'appel ranked ET l'appel "all" renvoient null (404/vide).
  // Ce n'est pas un vrai profil -> on NE fabrique PAS une fiche vide "?" (qui serait mise
  // en cache puis affichee comme un joueur reel, cf. bug "Profil — ?"). On leve une erreur
  // pour declencher le repli (cache exploitable / index local) et la file de recuperation.
  // NB : un joueur en PLACEMENTS a bien `all` != null -> ce cas ne se declenche pas pour lui.
  if (rankedR.value == null && all == null) {
    const e = new Error(
      `Aucune donnée renvoyée par l'API pour l'ID ${brawlhallaId} ` +
        `(joueur introuvable, ou API momentanément vide — réessaie dans ~30 s).`,
    );
    e.status = 404;
    e.empty = true;
    throw e;
  }

  return buildPlayerProfile(brawlhallaId, { ranked: rankedR.value, teamsData, all, partial });
}

/**
 * Construit la fiche joueur consolidee a partir des reponses BRUTES de l'API (fonction PURE,
 * testable sans reseau) :
 *  - ranked   : /player/stats?mode=ranked_1v1 (rating/tier/region/peak/rang + legendes classees)
 *  - teamsData: /player/teams (equipes 2v2)
 *  - all      : /player/stats?mode=all (niveau, games/wins totaux, stats par legende)
 *  - partial  : true si un appel secondaire (teams/all) a echoue
 * Le tier 2v2 retenu est celui de l'equipe au plus haut rating. Valhallan est deduit par
 * resolveBaseTier quand l'API renvoie un tier vide sur un rating eleve.
 */
export function buildPlayerProfile(brawlhallaId, { ranked = null, teamsData = null, all = null, partial = false } = {}) {
  const rating1v1 = ranked?.rating ?? 0;
  const tier1v1 = resolveBaseTier(rating1v1, ranked?.tier);

  const teams = teamsData?.teams?.ranked_2v2 ?? [];
  let best2v2 = null;
  if (teams.length > 0) best2v2 = teams.reduce((a, b) => (b.rating > a.rating ? b : a));
  const tier2v2 = best2v2 ? resolveBaseTier(best2v2.rating, best2v2.tier) : null;

  return {
    brawlhallaId,
    name: ranked?.name ?? all?.name ?? "?",
    level: all?.level ?? 0,
    totalGames: all?.games ?? 0,
    totalWins: all?.wins ?? 0,
    region: ranked?.region ?? "?",
    globalRank: ranked?.global_rank ?? 0,
    peak1v1: ranked?.peak_rating ?? 0,
    games1v1: ranked?.games ?? 0, // games/wins classees 1v1 (niveau joueur)
    wins1v1: ranked?.wins ?? 0,
    tiers: { "1v1": tier1v1, "2v2": tier2v2 },
    ratings: { "1v1": rating1v1, "2v2": best2v2?.rating ?? 0 },
    best2v2, // equipe 2v2 au plus haut rating (objet brut) ou null
    teams, // toutes les equipes 2v2 (brut)
    legendsRanked: Array.isArray(ranked?.legends) ? ranked.legends : [], // pour la Glory (peak_rating)
    legendsAll: Array.isArray(all?.legends) ? all.legends : [], // pour /legendes (games/wins)
    partial, // true si teams/all ont echoue : a rafraichir en arriere-plan
  };
}

/**
 * GET /v1/leaderboard/ranked : top du classement (mode "1v1"|"2v2", region, page).
 */
export async function getRankings(gameMode = "1v1", region = "ALL", page = 1, max = 10) {
  const data = await apiGet("/leaderboard/ranked", {
    game_mode: gameMode,
    region,
    page,
    max_results: Math.min(max, 50),
  });
  return Array.isArray(data?.rankings) ? data.rankings : [];
}

let legendsCache = null;
let legendsCacheTs = 0;
// TTL du cache des legendes : sans expiration, un nouveau personnage Brawlhalla
// n'apparaitrait qu'apres un redemarrage du bot. 24h est un bon compromis.
const LEGENDS_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Renvoie une Map legend_id -> { name, weaponOne, weaponTwo }, mise en cache (TTL 24h).
 */
export async function getLegends() {
  if (legendsCache && Date.now() - legendsCacheTs < LEGENDS_TTL_MS) return legendsCache;
  const map = new Map();
  let page = 1;
  let totalPages = 1;
  do {
    const data = await apiGet("/static/legends", { page, max_results: 100 });
    for (const l of data?.legends ?? []) {
      map.set(l.legend_id, {
        name: l.bio_name ?? l.legend_name ?? `#${l.legend_id}`,
        weaponOne: l.weapon_one,
        weaponTwo: l.weapon_two,
      });
    }
    totalPages = data?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);
  // Ne remplace le cache que si on a bien recupere des legendes (evite de vider sur un echec partiel).
  if (map.size > 0) {
    legendsCache = map;
    legendsCacheTs = Date.now();
    return map;
  }
  // Repli : si l'appel n'a rien donne mais qu'on a un ancien cache, on le garde.
  return legendsCache ?? map;
}

// ---------- Glory (formule reprise de corehalla/bhapi calculator.ts) ----------

export function gloryFromWins(wins) {
  return wins <= 150
    ? 20 * wins
    : Math.floor(10 * (45 * Math.pow(Math.log10(wins * 2), 2)) + 245);
}

export function gloryFromBestRating(bestRating) {
  const v = (() => {
    if (bestRating < 1200) return 250;
    if (bestRating < 1286) return 10 * (25 + 0.872093023 * (86 - (1286 - bestRating)));
    if (bestRating < 1390) return 10 * (100 + 0.721153846 * (104 - (1390 - bestRating)));
    if (bestRating < 1680) return 10 * (187 + 0.389655172 * (290 - (1680 - bestRating)));
    if (bestRating < 2000) return 10 * (300 + 0.428125 * (320 - (2000 - bestRating)));
    if (bestRating < 2300) return 10 * (437 + 0.143333333 * (300 - (2300 - bestRating)));
    return 10 * (480 + 0.05 * (400 - (2700 - bestRating)));
  })();
  return Math.floor(v);
}

/**
 * Estimation de la Glory de fin de saison a partir d'un profil (getPlayerProfile).
 * games/wins = 1v1 (somme des legendes classees) + chaque equipe 2v2.
 * bestRating = max des peak ratings (1v1, equipes, legendes).
 * Renvoie null si < 10 games classees.
 */
export function estimateGlory(profile) {
  const ranked1v1Games = profile.legendsRanked.reduce((a, l) => a + (l.games ?? 0), 0);
  const ranked1v1Wins = profile.legendsRanked.reduce((a, l) => a + (l.wins ?? 0), 0);

  const games = [ranked1v1Games, ...profile.teams.map((t) => t.games ?? 0)];
  const wins = [ranked1v1Wins, ...profile.teams.map((t) => t.wins ?? 0)];
  const ratings = [
    profile.peak1v1,
    ...profile.teams.map((t) => t.peak_rating ?? 0),
    ...profile.legendsRanked.map((l) => l.peak_rating ?? 0),
  ];

  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalGames = games.reduce((a, b) => a + b, 0);
  if (totalGames < 10) return null;

  const bestRating = Math.max(...ratings, 0);
  const gW = gloryFromWins(totalWins);
  const gR = gloryFromBestRating(bestRating);
  return {
    totalGames,
    totalWins,
    bestRating,
    gloryFromWins: gW,
    gloryFromBestRating: gR,
    totalGlory: gW + gR,
  };
}
