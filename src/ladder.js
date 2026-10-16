import { db, loadDoc, saveDoc } from "./db.js";

/**
 * Ladder interne : classement Elo du serveur par défis 1v1, indépendant du rating Brawlhalla.
 *
 * - Table `ladder` : une ligne par joueur classé (Elo, victoires, défaites, série, matchs).
 *   Remise à zéro à chaque saison (les lignes sont supprimées, l'Elo repart de `startElo`).
 * - Table `ladder_matches` : un défi = deux joueurs, un format (BO1/3/5), le score manche par
 *   manche (`game_log`, "a"/"b"), le statut, la carte Discord (salon + message) et l'éventuel
 *   litige (JSON). Les noms affichés sont figés à la création (boutons, dashboard).
 * - Doc kv `ladder` : { guilds: { [guildId]: { config, season, seasonStartedAt, lastResetKey,
 *   seasons: [{ season, endedAt, players, matches, top }] } } }.
 *
 * Statuts : pending → accepted → reported → confirmed | disputed → resolved, ainsi que
 * declined (refusé), expired (sans réponse ou sans résultat) et cancelled (retiré par l'auteur
 * ou annulé par le staff). L'Elo ne bouge QU'À la validation (confirmed ou resolved).
 *
 * Règle de validation (décision d'ogsas, 16/10/2026) : le perdant confirme le score, sinon il
 * est validé automatiquement après `autoConfirmHours` (0 = jamais : le staff tranche). Un
 * litige bloque tout jusqu'à la décision du staff.
 *
 * Ce module ne parle jamais à Discord : cartes et annonces sont dans ladderUI.js, les
 * interactions et la boucle de fond dans commands/ladder.js.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS ladder (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    elo        INTEGER NOT NULL DEFAULT 1000,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    streak     INTEGER NOT NULL DEFAULT 0,
    played     INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ladder_guild_elo ON ladder(guild_id, elo DESC);

  CREATE TABLE IF NOT EXISTS ladder_matches (
    id          TEXT PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    a_id        TEXT NOT NULL,
    b_id        TEXT NOT NULL,
    a_name      TEXT NOT NULL DEFAULT '',
    b_name      TEXT NOT NULL DEFAULT '',
    best_of     INTEGER NOT NULL DEFAULT 3,
    score_a     INTEGER NOT NULL DEFAULT 0,
    score_b     INTEGER NOT NULL DEFAULT 0,
    game_log    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL DEFAULT 0,
    reported_at INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER NOT NULL DEFAULT 0,
    resolved_by TEXT NOT NULL DEFAULT '',
    winner_id   TEXT,
    elo_delta   INTEGER NOT NULL DEFAULT 0,
    dispute     TEXT,
    message_id  TEXT NOT NULL DEFAULT '',
    channel_id  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_ladder_matches_status ON ladder_matches(guild_id, status);
  CREATE INDEX IF NOT EXISTS idx_ladder_matches_a ON ladder_matches(guild_id, a_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ladder_matches_b ON ladder_matches(guild_id, b_id, created_at);
`);

// ====================================================================
// Configuration (doc kv « ladder »)
// ====================================================================

const KEY = "ladder";

export const DEFAULT_LADDER_CONFIG = {
  enabled: false,
  channelId: "", // salon des défis (cartes, scoreboards, annonces)
  requireLink: true, // les deux joueurs doivent avoir lié leur compte Brawlhalla
  kFactor: 32,
  startElo: 1000,
  maxPerDayPerPair: 3, // défis par paire de joueurs sur 24 h glissantes
  autoConfirmHours: 12, // validation automatique si le perdant ne répond pas (0 = jamais)
  resetDay: 0, // jour du mois (1-28) de la nouvelle saison automatique, 0 = jamais
  modRoleId: "", // rôle staff qui tranche les litiges (en plus de « Gérer le serveur »)
  modAlertChannelId: "", // salon des alertes de litige
};

export const LADDER_LIMITS = {
  kFactor: [8, 64],
  startElo: [100, 3000],
  maxPerDayPerPair: [1, 20],
  autoConfirmHours: [0, 72],
  resetDay: [0, 28],
};

export const BEST_OF_CHOICES = [1, 3, 5];
export const CHALLENGE_TTL_MS = 24 * 3600_000; // défi sans réponse
export const MATCH_TTL_MS = 24 * 3600_000; // défi accepté sans résultat final
export const CHALLENGE_COOLDOWN_MS = 10 * 60_000; // entre deux défis lancés par un même joueur
export const ACTIVE_STATUSES = ["pending", "accepted", "reported", "disputed"];
export const VALIDATED_STATUSES = ["confirmed", "resolved"];
const SEASONS_KEPT = 24;

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds || typeof cache.guilds !== "object") cache.guilds = {};
  return cache;
}

function save() {
  const doWrite = () => saveDoc(KEY, cache);
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

function clampInt(v, [min, max], def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function normalizeConfig(raw) {
  const c = { ...DEFAULT_LADDER_CONFIG, ...(raw || {}) };
  c.enabled = c.enabled === true;
  c.requireLink = c.requireLink !== false;
  for (const [k, range] of Object.entries(LADDER_LIMITS)) c[k] = clampInt(c[k], range, DEFAULT_LADDER_CONFIG[k]);
  for (const k of ["channelId", "modRoleId", "modAlertChannelId"]) c[k] = typeof c[k] === "string" ? c[k] : "";
  return c;
}

function getState(guildId) {
  const c = load();
  const g = c.guilds[guildId] || {};
  g.config = normalizeConfig(g.config);
  if (!Number.isInteger(g.season) || g.season < 1) g.season = 1;
  if (!Number.isFinite(g.seasonStartedAt)) g.seasonStartedAt = 0;
  if (typeof g.lastResetKey !== "string") g.lastResetKey = "";
  if (!Array.isArray(g.seasons)) g.seasons = [];
  c.guilds[guildId] = g;
  return g;
}

function badRequest(message) {
  const e = new Error(message);
  e.httpStatus = 400;
  return e;
}

export async function getLadderConfig(guildId) {
  return { ...getState(guildId).config };
}

/** Applique un patch de config (dashboard). Valeurs bornées, identifiants Discord vérifiés. */
export async function setLadderConfig(guildId, patch = {}, now = Date.now()) {
  const g = getState(guildId);
  const next = { ...g.config };
  for (const k of ["channelId", "modRoleId", "modAlertChannelId"]) {
    if (!(k in patch)) continue;
    const v = String(patch[k] ?? "").trim();
    if (v && !/^\d{5,25}$/.test(v)) throw badRequest(`Valeur invalide pour ${k}.`);
    next[k] = v;
  }
  for (const k of ["enabled", "requireLink"]) if (k in patch) next[k] = patch[k] === true;
  for (const k of Object.keys(LADDER_LIMITS)) if (k in patch) next[k] = patch[k];
  const clean = normalizeConfig(next);
  // Nouvelle date de remise à zéro : on repart du mois en cours, pour qu'activer (ou déplacer)
  // la saison automatique ne déclenche pas une remise à zéro immédiate.
  if (clean.resetDay && clean.resetDay !== g.config.resetDay) g.lastResetKey = initialResetKey(clean.resetDay, now);
  g.config = clean;
  await save();
  return getLadderConfig(guildId);
}

/** Saison en cours : numéro, début, saisons archivées (plus récente d'abord). */
export function getSeasonInfo(guildId) {
  const g = getState(guildId);
  return { season: g.season, startedAt: g.seasonStartedAt, lastResetKey: g.lastResetKey, seasons: structuredClone(g.seasons) };
}

// ====================================================================
// Fonctions pures : Elo, machine d'états, classement, garde-fous
// ====================================================================

/** Manches à gagner pour remporter un BOx. */
export function winsNeeded(bestOf) {
  return Math.ceil(Number(bestOf) / 2);
}

/**
 * Mise à jour Elo (PURE). `ra`/`rb` : Elo avant le match, `aWins` : A a gagné, `k` : facteur K.
 * Renvoie { ra2, rb2, delta } où `delta` est le gain de A (négatif s'il perd) et la perte de B :
 * le total des points est conservé. Le vainqueur gagne au moins 1 point et au plus K.
 */
export function eloUpdate(ra, rb, aWins, k = DEFAULT_LADDER_CONFIG.kFactor) {
  const kk = Number.isFinite(k) && k > 0 ? k : DEFAULT_LADDER_CONFIG.kFactor;
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const raw = Math.round(kk * ((aWins ? 1 : 0) - expectedA));
  const delta = aWins ? Math.min(kk, Math.max(1, raw)) : Math.max(-kk, Math.min(-1, raw));
  return { ra2: ra + delta, rb2: rb - delta, delta };
}

/**
 * Machine d'états d'un défi (PURE). `match` : { status, a_id, b_id, winner_id }. `byUserId` :
 * auteur de l'action, null quand c'est le bot (expiration, validation automatique).
 * `isStaff` : action d'un modérateur. Renvoie { ok: true, status } ou { ok: false, error }.
 *
 * - accept / decline : le joueur défié, sur un défi en attente ;
 * - cancel : l'auteur du défi, tant qu'il n'est pas accepté ;
 * - game / undo : un des deux joueurs, pendant le match (le statut ne change pas) ;
 * - report : score final atteint (un des deux joueurs vient de marquer la dernière manche) ;
 * - confirm : le PERDANT uniquement (le vainqueur ne valide jamais pour l'autre) ;
 * - dispute : un des deux joueurs, pendant le match ou avant la confirmation ;
 * - expire / autoconfirm : le bot uniquement ;
 * - resolve / void : le staff, sur un défi non clos.
 */
export function nextStatus(match, action, byUserId = null, { isStaff = false } = {}) {
  const s = match?.status;
  const isA = Boolean(byUserId) && byUserId === match?.a_id;
  const isB = Boolean(byUserId) && byUserId === match?.b_id;
  const isPlayer = isA || isB;
  const loserId = match?.winner_id ? (match.winner_id === match.a_id ? match.b_id : match.a_id) : null;
  const deny = (error) => ({ ok: false, error });
  const to = (status) => ({ ok: true, status });

  switch (action) {
    case "accept":
    case "decline":
      if (s !== "pending") return deny("Ce défi n'attend plus de réponse.");
      if (!isB) return deny("Seul le joueur défié peut répondre à ce défi.");
      return to(action === "accept" ? "accepted" : "declined");
    case "cancel":
      if (s !== "pending") return deny("Ce défi a déjà reçu une réponse : il ne peut plus être retiré.");
      if (!isA) return deny("Seul l'auteur du défi peut le retirer.");
      return to("cancelled");
    case "game":
    case "undo":
    case "report":
      if (s !== "accepted") return deny(s === "pending" ? "Le défi n'a pas encore été accepté." : "Le score de ce défi ne peut plus être modifié.");
      if (!isPlayer) return deny("Réservé aux deux joueurs du défi.");
      return to(action === "report" ? "reported" : "accepted");
    case "confirm":
      if (s !== "reported") return deny("Il n'y a pas de résultat à confirmer sur ce défi.");
      if (!byUserId || byUserId !== loserId) return deny("Seul le perdant confirme le résultat.");
      return to("confirmed");
    case "dispute":
      if (s !== "accepted" && s !== "reported") return deny(s === "disputed" ? "Un litige est déjà en cours sur ce défi." : "Ce défi ne peut pas être contesté.");
      if (!isPlayer) return deny("Réservé aux deux joueurs du défi.");
      return to("disputed");
    case "expire":
      if (byUserId) return deny("Action réservée au bot.");
      if (s !== "pending" && s !== "accepted") return deny("Ce défi ne peut plus expirer.");
      return to("expired");
    case "autoconfirm":
      if (byUserId) return deny("Action réservée au bot.");
      if (s !== "reported") return deny("Il n'y a pas de résultat à valider.");
      return to("confirmed");
    case "resolve":
      if (!isStaff) return deny("Réservé au staff.");
      if (!["accepted", "reported", "disputed"].includes(s)) return deny("Ce défi est déjà clos.");
      return to("resolved");
    case "void":
      if (!isStaff) return deny("Réservé au staff.");
      if (!ACTIVE_STATUSES.includes(s)) return deny("Ce défi est déjà clos.");
      return to("cancelled");
    default:
      return deny("Action inconnue.");
  }
}

/**
 * Classement (PURE) : joueurs ayant au moins un match, triés par Elo, puis victoires, puis
 * moins de défaites, puis le premier arrivé à ce total. Ajoute `position` (1 = leader).
 */
export function ladderRanking(rows) {
  return (rows || [])
    .filter((r) => (r.played || 0) > 0)
    .sort(
      (x, y) =>
        y.elo - x.elo ||
        y.wins - x.wins ||
        x.losses - y.losses ||
        (x.updated_at || 0) - (y.updated_at || 0) ||
        String(x.user_id).localeCompare(String(y.user_id)),
    )
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/**
 * Garde-fous d'un nouveau défi (PURE). Renvoie le message d'erreur à afficher, ou null.
 * `active` : défi en cours entre les deux joueurs ; `pairCount` : défis de la paire sur 24 h ;
 * `lastByChallenger` : date du dernier défi lancé par l'auteur.
 */
export function challengeError({ aId, bId, targetBot = false, bestOf, linkedA = true, linkedB = true, active = null, pairCount = 0, lastByChallenger = 0, cfg = DEFAULT_LADDER_CONFIG, now = Date.now() }) {
  if (!aId || !bId) return "Joueur introuvable.";
  if (aId === bId) return "Tu ne peux pas te défier toi-même.";
  if (targetBot) return "Les bots ne jouent pas au ladder.";
  if (!BEST_OF_CHOICES.includes(bestOf)) return "Format invalide : BO1, BO3 ou BO5.";
  if (cfg.requireLink && !linkedA) return "Lie d'abord ton compte Brawlhalla avec `/lier` pour jouer au ladder.";
  if (cfg.requireLink && !linkedB) return "Ce joueur n'a pas lié son compte Brawlhalla : il doit d'abord utiliser `/lier`.";
  if (active) return "Un défi est déjà en cours entre vous deux : terminez-le d'abord.";
  if (pairCount >= cfg.maxPerDayPerPair) {
    return `Vous vous êtes déjà défiés ${pairCount} fois en 24 h (maximum ${cfg.maxPerDayPerPair}). Réessaie plus tard.`;
  }
  const wait = lastByChallenger + CHALLENGE_COOLDOWN_MS - now;
  if (lastByChallenger && wait > 0) return `Tu as lancé un défi il y a peu : réessaie dans ${Math.ceil(wait / 60_000)} min.`;
  return null;
}

// ---------- Saisons automatiques (fuseau Europe/Paris) ----------

const PARIS_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

function parisDate(ts) {
  const parts = Object.fromEntries(PARIS_DATE.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Mois de référence quand la date de remise à zéro est (re)définie (PURE) : le mois en cours si
 * le jour est déjà passé, sinon le mois précédent (la remise à zéro aura lieu ce mois-ci).
 */
export function initialResetKey(resetDay, now = Date.now()) {
  const { year, month, day } = parisDate(now);
  if (day >= resetDay) return monthKey(year, month);
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

/** Remise à zéro mensuelle due ? (PURE) Renvoie { due, key } (`key` = mois à marquer fait). */
export function seasonResetDue(resetDay, lastKey, now = Date.now()) {
  const { year, month, day } = parisDate(now);
  const key = monthKey(year, month);
  if (!resetDay || !lastKey) return { due: false, key };
  return { due: key !== lastKey && day >= resetDay, key };
}

// ====================================================================
// Store (better-sqlite3 : chaque fonction est synchrone, donc atomique dans le process)
// ====================================================================

const getMatchStmt = db.prepare("SELECT * FROM ladder_matches WHERE guild_id = ? AND id = ?");
const insertMatchStmt = db.prepare(
  `INSERT INTO ladder_matches (id, guild_id, a_id, b_id, a_name, b_name, best_of, status, created_at)
   VALUES (@id, @guild_id, @a_id, @b_id, @a_name, @b_name, @best_of, 'pending', @created_at)`,
);
const deleteMatchStmt = db.prepare("DELETE FROM ladder_matches WHERE guild_id = ? AND id = ?");
const activePairStmt = db.prepare(
  `SELECT * FROM ladder_matches WHERE guild_id = ? AND status IN ('pending', 'accepted', 'reported', 'disputed')
   AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)) LIMIT 1`,
);
const pairCountStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM ladder_matches WHERE guild_id = ? AND created_at > ?
   AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))`,
);
const lastByChallengerStmt = db.prepare("SELECT MAX(created_at) AS ts FROM ladder_matches WHERE guild_id = ? AND a_id = ?");
const setMessageStmt = db.prepare("UPDATE ladder_matches SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?");
const updateMatchStmt = db.prepare(
  `UPDATE ladder_matches SET status = @status, score_a = @score_a, score_b = @score_b, game_log = @game_log,
   accepted_at = @accepted_at, reported_at = @reported_at, resolved_at = @resolved_at, resolved_by = @resolved_by,
   winner_id = @winner_id, elo_delta = @elo_delta, dispute = @dispute WHERE guild_id = @guild_id AND id = @id`,
);
const byStatusStmt = db.prepare("SELECT * FROM ladder_matches WHERE guild_id = ? AND status = ? ORDER BY created_at");
const dueStmt = db.prepare(
  `SELECT * FROM ladder_matches WHERE guild_id = ? AND (
     (status = 'pending' AND created_at <= ?) OR (status = 'accepted' AND accepted_at <= ?) OR
     (status = 'reported' AND ? > 0 AND reported_at <= ?)
   ) ORDER BY created_at LIMIT ?`,
);
const recentByUserStmt = db.prepare(
  `SELECT * FROM ladder_matches WHERE guild_id = ? AND status IN ('confirmed', 'resolved') AND (a_id = ? OR b_id = ?)
   ORDER BY resolved_at DESC LIMIT ?`,
);
const recentValidatedStmt = db.prepare(
  "SELECT * FROM ladder_matches WHERE guild_id = ? AND status IN ('confirmed', 'resolved') ORDER BY resolved_at DESC LIMIT ?",
);
const validatedSinceStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM ladder_matches WHERE guild_id = ? AND status IN ('confirmed', 'resolved') AND resolved_at >= ?",
);
const namesStmt = db.prepare("SELECT a_id, a_name, b_id, b_name FROM ladder_matches WHERE guild_id = ? ORDER BY created_at DESC LIMIT 500");

const playerRowsStmt = db.prepare("SELECT * FROM ladder WHERE guild_id = ?");
const playerRowStmt = db.prepare("SELECT * FROM ladder WHERE guild_id = ? AND user_id = ?");
const ensurePlayerStmt = db.prepare("INSERT OR IGNORE INTO ladder (guild_id, user_id, elo, updated_at) VALUES (?, ?, ?, ?)");
const updatePlayerStmt = db.prepare(
  "UPDATE ladder SET elo = ?, wins = ?, losses = ?, streak = ?, played = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?",
);
const clearPlayersStmt = db.prepare("DELETE FROM ladder WHERE guild_id = ?");

/** Ligne de match lue en base, avec le litige décodé (`dispute` : objet ou null). */
function decode(row) {
  if (!row) return null;
  let dispute = null;
  if (row.dispute) {
    try {
      dispute = JSON.parse(row.dispute);
    } catch {
      dispute = null;
    }
  }
  return { ...row, dispute };
}

function write(match) {
  updateMatchStmt.run({ ...match, dispute: match.dispute ? JSON.stringify(match.dispute) : null });
}

export function getLadderMatch(guildId, id) {
  return decode(getMatchStmt.get(String(guildId), String(id)));
}

export function listLadderMatches(guildId, status) {
  return byStatusStmt.all(String(guildId), status).map(decode);
}

function matchId() {
  return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Crée un défi (statut pending) après les garde-fous en base : un seul défi actif par paire,
 * `maxPerDayPerPair` défis par paire sur 24 h, `CHALLENGE_COOLDOWN_MS` entre deux défis du même
 * auteur. `linkedA`/`linkedB` : comptes Brawlhalla liés (vérifiés par l'appelant).
 * Renvoie { ok: true, match } ou { ok: false, error }.
 */
export function createChallenge(guildId, { aId, bId, aName = "", bName = "", bestOf = 3, targetBot = false, linkedA = true, linkedB = true, cfg = DEFAULT_LADDER_CONFIG, now = Date.now() }) {
  const gid = String(guildId);
  return db.transaction(() => {
    const error = challengeError({
      aId,
      bId,
      targetBot,
      bestOf,
      linkedA,
      linkedB,
      cfg,
      now,
      active: aId && bId ? activePairStmt.get(gid, aId, bId, bId, aId) : null,
      pairCount: aId && bId ? pairCountStmt.get(gid, now - 24 * 3600_000, aId, bId, bId, aId).n : 0,
      lastByChallenger: aId ? lastByChallengerStmt.get(gid, aId)?.ts || 0 : 0,
    });
    if (error) return { ok: false, error };
    const id = matchId();
    insertMatchStmt.run({
      id,
      guild_id: gid,
      a_id: aId,
      b_id: bId,
      a_name: String(aName).slice(0, 80),
      b_name: String(bName).slice(0, 80),
      best_of: bestOf,
      created_at: now,
    });
    return { ok: true, match: getLadderMatch(gid, id) };
  })();
}

/** Supprime un défi jamais publié (la carte n'a pas pu être postée). */
export function discardChallenge(guildId, id) {
  deleteMatchStmt.run(String(guildId), String(id));
}

export function setLadderMessage(guildId, id, channelId, messageId) {
  setMessageStmt.run(String(channelId || ""), String(messageId || ""), String(guildId), String(id));
}

// Applique une transition : relit le match, vérifie l'action, puis `mutate(match)` (dans la
// même transaction). Renvoie { ok, match, ...extra } ou { ok: false, error }.
function transition(guildId, id, action, byUserId, opts, mutate) {
  return db.transaction(() => {
    const match = getLadderMatch(guildId, id);
    if (!match) return { ok: false, error: "Défi introuvable." };
    const next = nextStatus(match, action, byUserId, opts);
    if (!next.ok) return next;
    const extra = mutate(match, next.status);
    if (extra?.ok === false) return extra;
    write(match);
    return { ok: true, match: getLadderMatch(guildId, id), ...(extra || {}) };
  })();
}

export function acceptChallenge(guildId, id, userId, now = Date.now()) {
  return transition(guildId, id, "accept", userId, {}, (m, status) => {
    m.status = status;
    m.accepted_at = now;
  });
}

export function declineChallenge(guildId, id, userId, now = Date.now()) {
  return transition(guildId, id, "decline", userId, {}, (m, status) => {
    m.status = status;
    m.resolved_at = now;
    m.resolved_by = String(userId);
  });
}

export function cancelChallenge(guildId, id, userId, now = Date.now()) {
  return transition(guildId, id, "cancel", userId, {}, (m, status) => {
    m.status = status;
    m.resolved_at = now;
    m.resolved_by = String(userId);
  });
}

/**
 * Un joueur attribue une manche à `side` ("a" ou "b"). `expectedGames` : manches déjà jouées
 * quand le bouton a été affiché (encodé dans son customId) ; si le score a bougé depuis (deux
 * joueurs qui cliquent en même temps, vieux message), la manche est refusée au lieu d'être
 * comptée deux fois. Au score final, le défi passe en « reported » (le perdant doit confirmer).
 */
export function recordGame(guildId, id, side, userId, expectedGames, now = Date.now()) {
  if (side !== "a" && side !== "b") return { ok: false, error: "Manche invalide." };
  return transition(guildId, id, "game", userId, {}, (m) => {
    if (!Number.isInteger(expectedGames) || m.game_log.length !== expectedGames) {
      return { ok: false, error: "Le score a changé entre-temps : vérifie le scoreboard avant de recliquer." };
    }
    m.game_log += side;
    if (side === "a") m.score_a += 1;
    else m.score_b += 1;
    const need = winsNeeded(m.best_of);
    if (m.score_a >= need || m.score_b >= need) {
      m.status = "reported";
      m.reported_at = now;
      m.winner_id = m.score_a > m.score_b ? m.a_id : m.b_id;
      return { finished: true };
    }
    return { finished: false };
  });
}

/** Annule la dernière manche (pendant le match uniquement). */
export function undoGame(guildId, id, userId) {
  return transition(guildId, id, "undo", userId, {}, (m) => {
    const last = m.game_log.slice(-1);
    if (!last) return { ok: false, error: "Aucune manche à annuler." };
    m.game_log = m.game_log.slice(0, -1);
    if (last === "a") m.score_a = Math.max(0, m.score_a - 1);
    else m.score_b = Math.max(0, m.score_b - 1);
  });
}

// Elo + bilan des deux joueurs, dans la transaction de la validation. Le vainqueur est
// `m.winner_id` ; crée les lignes manquantes à `startElo`.
function applyElo(m, cfg, now) {
  const gid = m.guild_id;
  const winnerId = m.winner_id;
  const loserId = winnerId === m.a_id ? m.b_id : m.a_id;
  ensurePlayerStmt.run(gid, winnerId, cfg.startElo, now);
  ensurePlayerStmt.run(gid, loserId, cfg.startElo, now);
  const w = playerRowStmt.get(gid, winnerId);
  const l = playerRowStmt.get(gid, loserId);
  const { ra2, rb2, delta } = eloUpdate(w.elo, l.elo, true, cfg.kFactor);
  updatePlayerStmt.run(ra2, w.wins + 1, w.losses, w.streak > 0 ? w.streak + 1 : 1, w.played + 1, now, gid, winnerId);
  updatePlayerStmt.run(rb2, l.wins, l.losses + 1, l.streak < 0 ? l.streak - 1 : -1, l.played + 1, now, gid, loserId);
  m.elo_delta = delta;
  return { delta, winnerId, loserId, winnerElo: ra2, loserElo: rb2 };
}

/**
 * Valide le résultat déclaré : `userId` = le perdant (bouton « Confirmer »), ou null pour la
 * validation automatique du bot. Met à jour l'Elo des deux joueurs dans la même transaction.
 */
export function confirmResult(guildId, id, userId, cfg = DEFAULT_LADDER_CONFIG, now = Date.now()) {
  return transition(guildId, id, userId ? "confirm" : "autoconfirm", userId, {}, (m, status) => {
    m.status = status;
    m.resolved_at = now;
    m.resolved_by = userId ? String(userId) : "";
    return { result: applyElo(m, cfg, now) };
  });
}

/** Passe le défi en litige (raison, auteur, nombre de captures) : plus rien ne bouge sans le staff. */
export function disputeLadderMatch(guildId, id, userId, { reason = "", byName = "", files = 0 } = {}, now = Date.now()) {
  return transition(guildId, id, "dispute", userId, {}, (m, status) => {
    m.dispute = {
      reason: String(reason || "").trim().slice(0, 500),
      by: String(userId),
      byName: String(byName || "").slice(0, 100),
      files: Math.max(0, Math.trunc(Number(files)) || 0),
      at: now,
      fromStatus: m.status,
    };
    m.status = status;
  });
}

/** Mémorise le message d'alerte staff d'un litige (pour le marquer tranché ensuite). */
export function setDisputeAlert(guildId, id, channelId, messageId) {
  const m = getLadderMatch(guildId, id);
  if (!m?.dispute) return;
  m.dispute = { ...m.dispute, alertChannelId: String(channelId), alertMessageId: String(messageId) };
  write(m);
}

/**
 * Décision du staff : victoire à `winnerSide` ("a" ou "b"). Si le score ne donne pas déjà la
 * victoire à ce joueur, il est corrigé (vainqueur au nombre de manches requis).
 */
export function resolveLadderMatch(guildId, id, winnerSide, { by = "", cfg = DEFAULT_LADDER_CONFIG, now = Date.now() } = {}) {
  if (winnerSide !== "a" && winnerSide !== "b") return { ok: false, error: "Vainqueur invalide." };
  return transition(guildId, id, "resolve", by || "staff", { isStaff: true }, (m, status) => {
    const need = winsNeeded(m.best_of);
    if (winnerSide === "a" && m.score_a < need) {
      m.score_a = need;
      m.score_b = Math.min(m.score_b, need - 1);
    } else if (winnerSide === "b" && m.score_b < need) {
      m.score_b = need;
      m.score_a = Math.min(m.score_a, need - 1);
    }
    m.winner_id = winnerSide === "a" ? m.a_id : m.b_id;
    m.status = status;
    m.resolved_at = now;
    m.resolved_by = String(by || "");
    if (!m.reported_at) m.reported_at = now;
    return { result: applyElo(m, cfg, now) };
  });
}

/** Annulation par le staff (aucun point). */
export function voidLadderMatch(guildId, id, { by = "", now = Date.now() } = {}) {
  return transition(guildId, id, "void", by || "staff", { isStaff: true }, (m, status) => {
    m.status = status;
    m.resolved_at = now;
    m.resolved_by = String(by || "");
  });
}

/** Expiration par le bot : défi sans réponse, ou accepté mais sans résultat final. */
export function expireLadderMatch(guildId, id, now = Date.now()) {
  return transition(guildId, id, "expire", null, {}, (m, status) => {
    m.status = status;
    m.resolved_at = now;
  });
}

/**
 * Défis à traiter par la boucle de fond : expirations (24 h sans réponse ou sans résultat) et
 * validations automatiques (`autoConfirmHours` après le score final, si activée).
 */
export function dueLadderMatches(guildId, cfg, now = Date.now(), limit = 25) {
  const autoMs = cfg.autoConfirmHours * 3600_000;
  return dueStmt.all(String(guildId), now - CHALLENGE_TTL_MS, now - MATCH_TTL_MS, autoMs, now - autoMs, limit).map(decode);
}

/** Moment de la validation automatique d'un défi en « reported » (0 si désactivée). */
export function autoConfirmAt(match, cfg) {
  if (!cfg.autoConfirmHours || match?.status !== "reported") return 0;
  return match.reported_at + cfg.autoConfirmHours * 3600_000;
}

// ---------- Lecture du classement ----------

export function getLadderRanking(guildId) {
  return ladderRanking(playerRowsStmt.all(String(guildId)));
}

/** Ligne d'un joueur (null s'il n'a jamais joué cette saison). */
export function getLadderPlayer(guildId, userId) {
  return playerRowStmt.get(String(guildId), String(userId)) || null;
}

/** Position d'un joueur : { row, position, total } (position null s'il n'est pas classé). */
export function ladderStanding(guildId, userId) {
  const ranking = getLadderRanking(guildId);
  const row = ranking.find((r) => r.user_id === String(userId)) || null;
  return { row, position: row?.position ?? null, total: ranking.length };
}

/** Elo actuel (ou Elo de départ pour un joueur pas encore classé). */
export function currentElo(guildId, userId, cfg = DEFAULT_LADDER_CONFIG) {
  return getLadderPlayer(guildId, userId)?.elo ?? cfg.startElo;
}

export function recentLadderMatches(guildId, userId, limit = 5) {
  return recentByUserStmt.all(String(guildId), String(userId), String(userId), limit).map(decode);
}

export function recentValidatedMatches(guildId, limit = 10) {
  return recentValidatedStmt.all(String(guildId), limit).map(decode);
}

/** Noms figés dans les défis récents : { [userId]: nom }, pour le dashboard. */
export function ladderNames(guildId) {
  const names = {};
  for (const r of namesStmt.all(String(guildId))) {
    if (r.a_name && !names[r.a_id]) names[r.a_id] = r.a_name;
    if (r.b_name && !names[r.b_id]) names[r.b_id] = r.b_name;
  }
  return names;
}

export function validatedThisSeason(guildId) {
  return validatedSinceStmt.get(String(guildId), getState(guildId).seasonStartedAt).n;
}

// ---------- Saisons ----------

/**
 * Clôt la saison : archive le top 10 dans le doc (24 saisons gardées), vide le classement
 * (tout le monde repart de `startElo`) et passe à la saison suivante. Les défis en cours
 * continuent et comptent pour la nouvelle saison. Renvoie l'archive créée.
 */
export async function resetLadderSeason(guildId, { now = Date.now(), by = "" } = {}) {
  const g = getState(guildId);
  const ranking = getLadderRanking(guildId);
  const archive = {
    season: g.season,
    startedAt: g.seasonStartedAt,
    endedAt: now,
    by: String(by || ""),
    players: ranking.length,
    matches: validatedThisSeason(guildId),
    top: ranking.slice(0, 10).map((r) => ({ position: r.position, userId: r.user_id, elo: r.elo, wins: r.wins, losses: r.losses })),
  };
  clearPlayersStmt.run(String(guildId));
  g.seasons = [archive, ...g.seasons].slice(0, SEASONS_KEPT);
  g.season += 1;
  g.seasonStartedAt = now;
  await save();
  return structuredClone(archive);
}

/**
 * Remise à zéro mensuelle (appelée par la boucle de fond). Initialise le mois de référence au
 * premier passage, puis clôt la saison une fois par mois à partir de `resetDay`.
 * Renvoie l'archive si une saison vient d'être close, sinon null.
 */
export async function maybeResetLadderSeason(guildId, now = Date.now()) {
  const g = getState(guildId);
  const { resetDay } = g.config;
  if (!resetDay) return null;
  if (!g.lastResetKey) {
    g.lastResetKey = initialResetKey(resetDay, now);
    await save();
    return null;
  }
  const { due, key } = seasonResetDue(resetDay, g.lastResetKey, now);
  if (!due) return null;
  g.lastResetKey = key;
  return resetLadderSeason(guildId, { now, by: "auto" });
}
