import { loadDoc, saveDoc } from "./db.js";

/**
 * Système de tournoi (élimination simple, 1v1 ou 2v2).
 * Un tournoi "courant" par serveur.
 *
 * tournament = {
 *   name, format: "1v1"|"2v2", region, maxParticipants, bestOf, finalsBestOf,
 *   rulesText, prizeText, mapPool, checkInEnabled,
 *   status: "draft"|"registration"|"checkin"|"running"|"completed",
 *   signupChannelId, signupMessageId, announceChannelId, participantRoleId,
 *   startTime,
 *   participants: [{ id, members:[userId], name, checkedIn, eliminated }],  // ordre = seed
 *   matches: { [matchId]: { round, index, aId, bId, scoreA, scoreB, winnerId, status } },
 *   rounds: number, createdAt
 * }
 */

export const DEFAULT_TOURNAMENT = {
  name: "Tournoi Brawlhalla",
  format: "1v1",
  region: "EU",
  maxParticipants: 16,
  bestOf: 3,
  finalsBestOf: 5,
  rulesText: "Stock · 3 vies · 8 min · maps légales uniquement.",
  prizeText: "",
  mapPool: "",
  checkInEnabled: true,
  status: "draft",
  signupChannelId: "",
  signupMessageId: "",
  announceChannelId: "",
  participantRoleId: "",
  pingRoleId: "", // rôle à notifier dans les annonces (ex: @tournoi)
  startTime: "",
  // --- Automatisation des matchs ---
  matchCategoryId: "", // catégorie où créer les salons de match
  modRoleId: "", // rôle staff (accès aux salons + ping litiges)
  modAlertChannelId: "", // salon des alertes/litiges
  createVoice: false, // créer aussi un vocal éphémère par match
  alertMinutes: 7, // délai avant alerte mod si un joueur ne répond pas
  forfeitMinutes: 10, // délai avant forfait auto
  // --- Cast / hall of fame ---
  castFromTopN: 0, // a partir de ce "top N" (8 = top 8), les matchs sont VERROUILLES jusqu'a deblocage staff (pour caster). 0 = off
  hallOfFameChannelId: "", // salon ou poster le recap (podium + MVP) a l'archivage
  // ---
  participants: [],
  matches: {},
  rounds: 0,
};

const KEY = "tournament";
let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function doWrite() {
  saveDoc(KEY, cache);
}
function save() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

export async function getTournament(guildId) {
  const c = await load();
  return c.guilds[guildId]?.tournament || null;
}

async function setTournament(guildId, t) {
  const c = await load();
  if (!c.guilds[guildId]) c.guilds[guildId] = {};
  c.guilds[guildId].tournament = t;
  await save();
  return t;
}

export async function createTournament(guildId, patch) {
  const t = { ...DEFAULT_TOURNAMENT, ...patch, participants: [], matches: {}, rounds: 0, status: "draft", createdAt: Date.now() };
  return setTournament(guildId, t);
}

export async function updateTournament(guildId, patch) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi en cours.");
  // On ne laisse pas écraser les données structurelles via un simple patch de config.
  const { participants, matches, rounds, ...safe } = patch;
  Object.assign(t, safe);
  // Si le seuil de cast change, on réapplique les verrous aux matchs en cours.
  if ("castFromTopN" in safe) applyCastLocks(t);
  return setTournament(guildId, t);
}

export async function deleteTournament(guildId) {
  const c = await load();
  if (c.guilds[guildId]) {
    delete c.guilds[guildId].tournament;
    await save();
  }
}

// ---------- Inscriptions ----------

function entrantId() {
  return "e" + Math.random().toString(36).slice(2, 9);
}

// userId déjà inscrit (comme membre d'une entrée) ?
function findEntrantByUser(t, userId) {
  return t.participants.find((p) => p.members.includes(userId));
}

export async function registerEntrant(guildId, { members, name }) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi en cours.");
  if (t.status !== "registration") throw new Error("Les inscriptions ne sont pas ouvertes.");
  if (t.participants.length >= t.maxParticipants) throw new Error("Le tournoi est complet.");
  for (const uid of members) {
    if (findEntrantByUser(t, uid)) throw new Error("Tu (ou ton coéquipier) es déjà inscrit.");
  }
  const entry = { id: entrantId(), members, name, checkedIn: !t.checkInEnabled, eliminated: false };
  t.participants.push(entry);
  await setTournament(guildId, t);
  return entry;
}

export async function unregisterEntrant(guildId, userId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi en cours.");
  if (t.status !== "registration" && t.status !== "checkin") throw new Error("Trop tard pour se désinscrire.");
  const before = t.participants.length;
  t.participants = t.participants.filter((p) => !p.members.includes(userId));
  if (t.participants.length === before) throw new Error("Tu n'es pas inscrit.");
  await setTournament(guildId, t);
}

export async function checkInEntrant(guildId, userId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi en cours.");
  if (t.status !== "checkin") throw new Error("Le check-in n'est pas ouvert.");
  const e = findEntrantByUser(t, userId);
  if (!e) throw new Error("Tu n'es pas inscrit.");
  e.checkedIn = true;
  await setTournament(guildId, t);
  return e;
}

export async function removeEntrant(guildId, entrantId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  t.participants = t.participants.filter((p) => p.id !== entrantId);
  await setTournament(guildId, t);
}

export async function shuffleSeeds(guildId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  for (let i = t.participants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t.participants[i], t.participants[j]] = [t.participants[j], t.participants[i]];
  }
  await setTournament(guildId, t);
}

// ---------- Bracket (élimination simple) ----------

function seedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

export async function generateBracket(guildId, { onlyCheckedIn = true } = {}) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  let players = [...t.participants];
  if (t.checkInEnabled && onlyCheckedIn) players = players.filter((p) => p.checkedIn);
  if (players.length < 2) throw new Error("Il faut au moins 2 participants (check-in inclus).");

  // Taille du bracket = puissance de 2 ≥ nombre de joueurs.
  let size = 1;
  while (size < players.length) size *= 2;
  const rounds = Math.log2(size);

  // Place les joueurs selon l'ordre de seed standard ; les places manquantes = bye (null).
  const order = seedOrder(size); // ex [1,16,8,9,...]
  const slots = order.map((seed) => players[seed - 1] || null);

  const matches = {};
  const blank = () => ({ reports: {}, gameLog: [], channelId: "", voiceChannelId: "", messageId: "", startedAt: 0, firstReportAt: 0, alerted: false });
  // Round 0
  for (let i = 0; i < size / 2; i++) {
    const a = slots[i * 2];
    const b = slots[i * 2 + 1];
    matches[`r0m${i}`] = {
      round: 0,
      index: i,
      aId: a ? a.id : null,
      bId: b ? b.id : null,
      scoreA: 0,
      scoreB: 0,
      winnerId: null,
      status: "pending",
      ...blank(),
    };
  }
  // Rounds suivants (vides)
  for (let r = 1; r < rounds; r++) {
    const count = size / Math.pow(2, r + 1);
    for (let i = 0; i < count; i++) {
      matches[`r${r}m${i}`] = { round: r, index: i, aId: null, bId: null, scoreA: 0, scoreB: 0, winnerId: null, status: "pending", ...blank() };
    }
  }

  t.matches = matches;
  t.rounds = rounds;
  t.status = "running";
  // Réinitialise l'état d'élimination.
  t.participants.forEach((p) => (p.eliminated = false));
  // Cast gate : verrouille les matchs a partir du "top N" configure.
  applyCastLocks(t);
  await setTournament(guildId, t);

  // Auto-avance les byes du round 0.
  for (let i = 0; i < size / 2; i++) {
    const m = t.matches[`r0m${i}`];
    if (m.aId && !m.bId) await applyWinner(t, `r0m${i}`, m.aId);
    else if (!m.aId && m.bId) await applyWinner(t, `r0m${i}`, m.bId);
  }
  await setTournament(guildId, t);
  return t;
}

// ---------- Cast gate (verrouillage des matchs a partir du top N) ----------

// Round (index) a partir duquel les matchs sont verrouilles, selon castFromTopN.
// "top N" = round ou il reste N joueurs. -1 si desactive/invalide.
function castGateRound(t) {
  const n = Number(t.castFromTopN || 0);
  if (!t.rounds || n < 2) return -1;
  const size = Math.pow(2, t.rounds);
  if (n >= size) return -1; // top >= taille du bracket : tout serait verrouille, sans interet
  const log = Math.log2(n);
  if (!Number.isInteger(log)) return -1; // doit etre une puissance de 2 (2,4,8,16...)
  return t.rounds - log; // ex: 128 (rounds=7), top 8 -> 7-3 = round 4
}

// (Re)applique les verrous : verrouille les matchs non termines des rounds >= gate.
function applyCastLocks(t) {
  const gate = castGateRound(t);
  for (const m of Object.values(t.matches)) {
    if (gate >= 0 && m.round >= gate && m.status !== "done") m.locked = true;
    else if (m.locked && (gate < 0 || m.round < gate)) m.locked = false;
  }
}

// Definit le seuil de cast et reapplique les verrous au tournoi en cours.
export async function setCastThreshold(guildId, topN) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  t.castFromTopN = Math.max(0, Math.floor(topN || 0));
  applyCastLocks(t);
  await setTournament(guildId, t);
  return t;
}

// Deverrouille un match (staff) pour qu'il puisse demarrer (creation du salon au prochain tick).
export async function unlockMatch(guildId, matchId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  m.locked = false;
  await setTournament(guildId, t);
  return t;
}

// Matchs verrouilles PRETS a etre castes (2 joueurs connus, pas encore joues/termines).
export function heldMatches(t) {
  return Object.entries(t.matches)
    .filter(([, m]) => m.locked && m.aId && m.bId && m.status !== "done" && !m.channelId)
    .map(([id, m]) => ({ id, ...m }));
}

function advanceTarget(matchId, rounds) {
  const m = matchId.match(/^r(\d+)m(\d+)$/);
  const round = Number(m[1]);
  const index = Number(m[2]);
  if (round + 1 >= rounds) return null; // finale
  return { id: `r${round + 1}m${Math.floor(index / 2)}`, slot: index % 2 === 0 ? "a" : "b" };
}

async function applyWinner(t, matchId, winnerId) {
  const match = t.matches[matchId];
  match.winnerId = winnerId;
  match.status = "done";
  const loserId = match.aId === winnerId ? match.bId : match.aId;
  if (loserId) {
    const loser = t.participants.find((p) => p.id === loserId);
    if (loser) loser.eliminated = true;
  }
  const tgt = advanceTarget(matchId, t.rounds);
  if (tgt) {
    const next = t.matches[tgt.id];
    if (tgt.slot === "a") next.aId = winnerId;
    else next.bId = winnerId;
  } else {
    t.status = "completed";
  }
}

export async function reportResult(guildId, matchId, scoreA, scoreB) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const match = t.matches[matchId];
  if (!match) throw new Error("Match introuvable.");
  if (!match.aId || !match.bId) throw new Error("Ce match n'a pas encore ses deux joueurs.");
  if (scoreA === scoreB) throw new Error("Il faut un gagnant (scores différents).");
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  await applyWinner(t, matchId, scoreA > scoreB ? match.aId : match.bId);
  await setTournament(guildId, t);
  return t;
}

// Vainqueur final (si terminé).
export function tournamentWinner(t) {
  if (!t || t.status !== "completed" || !t.rounds) return null;
  const final = t.matches[`r${t.rounds - 1}m0`];
  if (!final?.winnerId) return null;
  return t.participants.find((p) => p.id === final.winnerId) || null;
}

/**
 * Calcule le podium + MVP d'un tournoi (termine ou non).
 * - 1er : vainqueur de la finale
 * - 2e  : finaliste perdant
 * - 3e  : les perdants des demi-finales (peut etre 2)
 * - MVP : le participant avec le plus de manches gagnees (gameLog), hors vainqueur si possible.
 * Renvoie { first, second, thirds: [], mvp, mostWins } (objets participants) ou null.
 */
export function tournamentPodium(t) {
  if (!t || !t.rounds) return null;
  const nameId = (id) => t.participants.find((p) => p.id === id) || null;

  const final = t.matches[`r${t.rounds - 1}m0`];
  const first = final?.winnerId ? nameId(final.winnerId) : null;
  const second = final?.winnerId ? nameId(final.aId === final.winnerId ? final.bId : final.aId) : null;

  const thirds = [];
  if (t.rounds >= 2) {
    for (let i = 0; i < 2; i++) {
      const sf = t.matches[`r${t.rounds - 2}m${i}`];
      if (sf?.winnerId) {
        const loserId = sf.aId === sf.winnerId ? sf.bId : sf.aId;
        const loser = nameId(loserId);
        if (loser) thirds.push(loser);
      }
    }
  }

  // MVP : plus grand nombre de manches gagnees, toutes parties confondues.
  const wins = new Map(); // entrantId -> manches gagnees
  for (const m of Object.values(t.matches)) {
    if (!m.gameLog?.length) continue;
    for (const side of m.gameLog) {
      const id = side === "a" ? m.aId : m.bId;
      if (id) wins.set(id, (wins.get(id) || 0) + 1);
    }
  }
  let mvpId = null;
  let mostWins = 0;
  for (const [id, w] of wins) if (w > mostWins) ((mostWins = w), (mvpId = id));
  const mvp = mvpId ? nameId(mvpId) : null;

  return { first, second, thirds, mvp, mostWins };
}

// ---------- Reporting croisé, litiges, automatisation ----------

export function matchBestOf(t, m) {
  return m.round === t.rounds - 1 ? t.finalsBestOf : t.bestOf;
}

// Scores possibles du point de vue d'un joueur, pour un BOx.
export function scoreOptions(bestOf) {
  const wins = Math.ceil(bestOf / 2);
  const opts = [];
  for (let l = wins - 1; l >= 0; l--) opts.push({ self: wins, opp: l, label: `Je gagne ${wins}-${l}` });
  for (let l = 0; l < wins; l++) opts.push({ self: l, opp: wins, label: `Je perds ${l}-${wins}` });
  return opts;
}

export function userEntrant(t, userId) {
  return t.participants.find((p) => p.members.includes(userId)) || null;
}

export async function setParticipantOrder(guildId, orderedIds) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const map = new Map(t.participants.map((p) => [p.id, p]));
  const ordered = orderedIds.map((id) => map.get(id)).filter(Boolean);
  for (const p of t.participants) if (!ordered.includes(p)) ordered.push(p);
  t.participants = ordered;
  await setTournament(guildId, t);
}

// Un joueur rapporte son score (selfScore-oppScore de SON point de vue).
export async function submitReport(guildId, matchId, reporterEntrantId, selfScore, oppScore) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  if (m.status === "done") throw new Error("Ce match est déjà terminé.");
  if (![m.aId, m.bId].includes(reporterEntrantId)) throw new Error("Tu n'es pas dans ce match.");

  const a = reporterEntrantId === m.aId ? selfScore : oppScore;
  const b = reporterEntrantId === m.aId ? oppScore : selfScore;
  m.reports = m.reports || {};
  m.reports[reporterEntrantId] = { a, b };
  if (!m.firstReportAt) m.firstReportAt = Date.now();

  const ra = m.reports[m.aId];
  const rb = m.reports[m.bId];
  let state = "waiting";
  if (ra && rb) {
    if (ra.a === rb.a && ra.b === rb.b) {
      m.scoreA = ra.a;
      m.scoreB = ra.b;
      await applyWinner(t, matchId, ra.a > ra.b ? m.aId : m.bId);
      state = "validated";
    } else {
      m.status = "dispute";
      state = "dispute";
    }
  }
  await setTournament(guildId, t);
  return { state, tournament: t, match: t.matches[matchId] };
}

// Décision manuelle (mod) : donne la victoire à un camp.
export async function resolveMatch(guildId, matchId, winnerEntrantId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  if (![m.aId, m.bId].includes(winnerEntrantId)) throw new Error("Vainqueur invalide.");
  const wins = Math.ceil(matchBestOf(t, m) / 2);
  if (winnerEntrantId === m.aId) {
    m.scoreA = wins;
    m.scoreB = 0;
  } else {
    m.scoreB = wins;
    m.scoreA = 0;
  }
  await applyWinner(t, matchId, winnerEntrantId);
  await setTournament(guildId, t);
  return t;
}

// Matchs prêts (2 joueurs) sans salon encore créé. Les matchs VERROUILLES (cast gate) sont
// exclus tant que le staff ne les a pas débloqués (pour pouvoir caster/débrief).
export function matchesNeedingChannels(t) {
  return Object.entries(t.matches)
    .filter(([, m]) => m.aId && m.bId && m.status !== "done" && !m.channelId && !m.locked)
    .map(([id, m]) => ({ id, ...m }));
}

export function liveMatchesWithChannel(t) {
  return Object.entries(t.matches)
    .filter(([, m]) => m.channelId && m.status !== "done")
    .map(([id, m]) => ({ id, ...m }));
}

export function doneMatchesWithChannel(t) {
  return Object.entries(t.matches)
    .filter(([, m]) => m.channelId && m.status === "done")
    .map(([id, m]) => ({ id, ...m }));
}

export function listDisputes(t) {
  return Object.entries(t.matches)
    .filter(([, m]) => m.status === "dispute")
    .map(([id, m]) => ({ id, ...m }));
}

export async function setMatchChannel(guildId, matchId, channelId, voiceChannelId = "") {
  const t = await getTournament(guildId);
  const m = t.matches[matchId];
  if (!m) return;
  m.channelId = channelId;
  m.voiceChannelId = voiceChannelId;
  m.startedAt = Date.now();
  m.status = "live";
  await setTournament(guildId, t);
}

export async function clearMatchChannel(guildId, matchId) {
  const t = await getTournament(guildId);
  const m = t.matches[matchId];
  if (!m) return;
  m.channelId = "";
  m.voiceChannelId = "";
  await setTournament(guildId, t);
}

export async function markAlerted(guildId, matchId) {
  const t = await getTournament(guildId);
  const m = t.matches[matchId];
  if (!m) return;
  m.alerted = true;
  await setTournament(guildId, t);
}

// ---------- Score manche par manche ----------

// Enregistre le gagnant d'une manche ("a" ou "b"). Termine le match si le seuil est atteint.
export async function reportGame(guildId, matchId, side) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  if (m.status === "done") throw new Error("Match déjà terminé.");
  if (side !== "a" && side !== "b") throw new Error("Manche invalide.");
  m.gameLog = m.gameLog || [];
  if (side === "a") m.scoreA++;
  else m.scoreB++;
  m.gameLog.push(side);
  if (m.status === "dispute") m.status = "live";

  const wins = Math.ceil(matchBestOf(t, m) / 2);
  let finished = false;
  if (m.scoreA >= wins || m.scoreB >= wins) {
    await applyWinner(t, matchId, m.scoreA > m.scoreB ? m.aId : m.bId);
    finished = true;
  }
  await setTournament(guildId, t);
  return { finished, tournament: t, match: t.matches[matchId] };
}

// Annule la dernière manche.
export async function undoGame(guildId, matchId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  if (m.status === "done") throw new Error("Trop tard, le match est terminé (résolution staff nécessaire).");
  m.gameLog = m.gameLog || [];
  const last = m.gameLog.pop();
  if (!last) throw new Error("Aucune manche à annuler.");
  if (last === "a") m.scoreA = Math.max(0, m.scoreA - 1);
  else m.scoreB = Math.max(0, m.scoreB - 1);
  await setTournament(guildId, t);
  return t;
}

export async function disputeMatch(guildId, matchId) {
  const t = await getTournament(guildId);
  if (!t) throw new Error("Aucun tournoi.");
  const m = t.matches[matchId];
  if (!m) throw new Error("Match introuvable.");
  if (m.status === "done") throw new Error("Match déjà terminé.");
  m.status = "dispute";
  await setTournament(guildId, t);
  return t;
}

// ---------- Historique (librairie des tournois passés) ----------

export async function archiveTournament(guildId) {
  const c = await load();
  const g = c.guilds[guildId];
  if (!g?.tournament) throw new Error("Aucun tournoi à archiver.");
  if (!g.history) g.history = [];
  const t = g.tournament;
  const win = tournamentWinner(t);
  g.history.unshift({
    id: "h" + Date.now(),
    name: t.name,
    format: t.format,
    region: t.region,
    bestOf: t.bestOf,
    participants: t.participants.length,
    winner: win ? win.name : null,
    status: t.status,
    createdAt: t.createdAt || null,
    archivedAt: Date.now(),
    snapshot: t,
  });
  g.history = g.history.slice(0, 50);
  delete g.tournament;
  await save();
}

export async function getHistory(guildId) {
  const c = await load();
  return (c.guilds[guildId]?.history || []).map(({ snapshot, ...s }) => s);
}

export async function getHistoryEntry(guildId, id) {
  const c = await load();
  return (c.guilds[guildId]?.history || []).find((h) => h.id === id) || null;
}

export async function deleteHistoryEntry(guildId, id) {
  const c = await load();
  const g = c.guilds[guildId];
  if (g?.history) {
    g.history = g.history.filter((h) => h.id !== id);
    await save();
  }
}

export async function setMatchMessage(guildId, matchId, messageId) {
  const t = await getTournament(guildId);
  if (!t) return;
  const m = t.matches[matchId];
  if (!m) return;
  m.messageId = messageId;
  await setTournament(guildId, t);
}
