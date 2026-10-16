import { isVideoClip } from "./clips.js";
import { db, loadDoc, saveDoc } from "./db.js";
import { getLink } from "./store.js";
import { TIERS, tierIndex, highestTier, tierEmojiText } from "./config.js";
import { incrCounter, getCounter, grantAndAnnounce } from "./achievements.js";

const KEY = "guessrank";

/**
 * "Devine ton rang" : meme principe que les clips, mais le bot ajoute des emojis
 * de rank (custom) pour que les membres votent le rang du joueur.
 * Structure : { guilds: { [guildId]: {
 *   enabled, channelIds, reactions (emojis de rank), ignoreBots, ignoreReplies,
 *   requireVideo, deleteNonVideo, extraDomains, singleVote,
 *   scoringEnabled, revealDelayHours, pointsExact, pointsNear, truthMode
 * } } }
 *
 * Score (optionnel) : à la publication d'un clip dont l'auteur a un compte lié, le vrai rang
 * est figé dans `guess_pending` ; après `revealDelayHours`, le bot relit les votes, attribue
 * les points (compteurs `guess_points`, `guess_games`, `guess_exact`) et répond au clip.
 * Jeu « sur l'honneur » : le rang de l'auteur reste visible sur son profil.
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelIds: [],
  reactions: [], // a remplir avec tes emojis de rank custom
  ignoreBots: true,
  ignoreReplies: true,
  requireVideo: true,
  deleteNonVideo: false,
  extraDomains: [],
  singleVote: true, // un seul emoji de rank par membre (retire les autres votes du membre)
  // Score : révélation automatique du vrai rang + points pour les bons devins.
  scoringEnabled: false,
  revealDelayHours: 24,
  pointsExact: 3, // rang exact
  pointsNear: 1, // à un tier près
  truthMode: "1v1", // "1v1" (tier 1v1 actuel) | "peak" (pic 1v1 de la saison) | "highest" (meilleur mode)
};

export const TRUTH_MODES = ["1v1", "peak", "highest"];
export const SCORING_LIMITS = {
  revealDelayHours: [1, 168],
  pointsExact: [1, 100],
  pointsNear: [0, 100],
};

// Entier borné ; valeur par défaut si illisible (dashboard, ancien document).
function clampInt(v, [min, max], def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

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

async function getGuild(guildId) {
  const c = await load();
  const g = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  if (!Array.isArray(g.channelIds)) g.channelIds = [];
  if (!Array.isArray(g.reactions)) g.reactions = [];
  if (!Array.isArray(g.extraDomains)) g.extraDomains = [];
  g.scoringEnabled = g.scoringEnabled === true;
  for (const [k, range] of Object.entries(SCORING_LIMITS)) g[k] = clampInt(g[k], range, DEFAULT_CONFIG[k]);
  if (!TRUTH_MODES.includes(g.truthMode)) g.truthMode = DEFAULT_CONFIG.truthMode;
  c.guilds[guildId] = g;
  return g;
}

export async function getGuessRankConfig(guildId) {
  return { ...(await getGuild(guildId)) };
}

export async function setGuessRankConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  // Re-normalise (bornes, mode) : le dashboard envoie les valeurs telles quelles.
  const clean = await getGuild(guildId);
  await save();
  return { ...clean };
}

// Cle unique d'un emoji stocke : l'ID pour un emoji custom, le caractere pour un unicode.
export function reactionStoredKey(s) {
  const m = String(s).match(/<a?:\w+:(\d+)>/);
  return m ? m[1] : String(s);
}

// Meme logique que les clips : reagit (emojis de rank) si video, sinon supprime si active.
export async function handleGuessRankMessage(message) {
  const g = await getGuild(message.guild.id);
  if (!g.enabled) return false;
  if (!g.channelIds.includes(message.channel.id)) return false;
  if (g.ignoreBots && message.author?.bot) return false;

  const video = isVideoClip(message, g.extraDomains);
  const isReply = Boolean(g.ignoreReplies && message.reference?.messageId);

  if (!g.requireVideo || video) {
    if (isReply) return false;
    for (const emoji of g.reactions) {
      try {
        await message.react(emoji);
      } catch {
        /* emoji invalide ou pas de perm */
      }
    }
    if (g.scoringEnabled) await scheduleReveal(message, g).catch((e) => console.warn("Devine ton rang (score) :", e.message));
    return true;
  }

  if (g.deleteNonVideo) {
    const author = message.author;
    const channel = message.channel;
    await message.delete().catch(() => {});
    try {
      const notice = await channel.send({
        content: `🎬 <@${author?.id}> ce salon est réservé aux **clips vidéo**, ton message a été supprimé.`,
        allowedMentions: { users: author?.id ? [author.id] : [] },
      });
      setTimeout(() => notice.delete().catch(() => {}), 8000);
    } catch {
      /* pas de perm */
    }
    return true;
  }
  return false;
}

// ====================================================================
// Score : révélation du vrai rang et points des devins
// ====================================================================

// Retire le sélecteur de variante (U+FE0F) : Discord et la config ne l'écrivent pas toujours
// pareil pour un même emoji unicode (« ⚫ » / « ⚫️ »).
const normKey = (k) => String(k ?? "").replace(/️/g, "");

/**
 * Tier voté par une réaction (PURE). `emojiKey` = ID d'emoji custom, caractère unicode, ou
 * forme `<:nom:id>`. L'ordre de `cfg.reactions` suit celui de TIERS (Tin → Valhallan).
 * Renvoie null pour un emoji qui n'est pas un vote de rank.
 */
export function tierOfReaction(emojiKey, cfg) {
  const key = normKey(reactionStoredKey(emojiKey));
  if (!key) return null;
  const idx = (cfg?.reactions || []).findIndex((r) => normKey(reactionStoredKey(r)) === key);
  return idx >= 0 && idx < TIERS.length ? TIERS[idx] : null;
}

/** Points d'un vote (PURE) : exact → pointsExact, à un tier près → pointsNear, sinon 0. */
export function scoreGuess(truth, guess, cfg = DEFAULT_CONFIG) {
  const t = tierIndex(truth);
  const g = tierIndex(guess);
  if (t < 0 || g < 0) return 0;
  const diff = Math.abs(t - g);
  if (diff === 0) return cfg.pointsExact ?? DEFAULT_CONFIG.pointsExact;
  if (diff === 1) return cfg.pointsNear ?? DEFAULT_CONFIG.pointsNear;
  return 0;
}

/**
 * Dépouille les votes (PURE). `votes` = [{ userId, tier, bot }] (une entrée par réaction de
 * membre). Exclus : l'auteur du clip, les bots, les tiers inconnus. Un membre qui a voté
 * pour plusieurs rangs différents (vote multiple autorisé ou retrait raté) est annulé :
 * couvrir plusieurs rangs ne doit jamais rapporter de points.
 * Renvoie { results: [{ userId, tier, points, exact }], winners, nearly, total }.
 */
export function tallyVotes(votes, truth, cfg = DEFAULT_CONFIG, { authorId } = {}) {
  const byUser = new Map();
  for (const v of votes || []) {
    if (!v?.userId || v.bot || v.userId === authorId) continue;
    if (tierIndex(v.tier) < 0) continue;
    if (!byUser.has(v.userId)) byUser.set(v.userId, new Set());
    byUser.get(v.userId).add(v.tier);
  }
  const results = [];
  for (const [userId, tiers] of byUser) {
    if (tiers.size !== 1) continue;
    const [tier] = tiers;
    const points = scoreGuess(truth, tier, cfg);
    results.push({ userId, tier, points, exact: tier === truth });
  }
  return {
    results,
    winners: results.filter((r) => r.exact),
    nearly: results.filter((r) => !r.exact && r.points > 0),
    total: results.length,
  };
}

/** Vrai rang d'un membre lié selon le mode choisi (PURE). null si inconnu. */
export function truthTierFromLink(link, mode = "1v1") {
  if (!link) return null;
  let tier = null;
  if (mode === "peak") tier = link.peakTiers?.["1v1"] ?? link.tiers?.["1v1"] ?? null;
  else if (mode === "highest") tier = highestTier(link.tiers);
  else tier = link.tiers?.["1v1"] ?? null;
  return tierIndex(tier) >= 0 ? tier : null;
}

/** Texte de révélation posté en réponse au clip (PURE). */
export function revealText(truth, tally) {
  const head = `🎯 Rang réel : ${tierEmojiText(truth) || "🏅"} **${truth}**`;
  if (!tally.total) return `${head} — personne n'a voté.`;
  const found = tally.winners.length;
  let text = `${head} — ${found} devin${found > 1 ? "s" : ""} sur ${tally.total} ${found > 1 ? "ont" : "a"} trouvé.`;
  const best = (found ? tally.winners : tally.nearly).slice(0, 5);
  if (best.length) text += ` ${found ? "Meilleurs" : "Au plus près"} : ${best.map((r) => `<@${r.userId}> (+${r.points})`).join(", ")}`;
  const more = (found ? tally.winners.length : tally.nearly.length) - best.length;
  if (more > 0) text += ` et ${more} autre${more > 1 ? "s" : ""}`;
  return text;
}

const insertPendingStmt = db.prepare(
  "INSERT OR IGNORE INTO guess_pending (message_id, guild_id, channel_id, author_id, truth_tier, reveal_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const duePendingStmt = db.prepare("SELECT * FROM guess_pending WHERE reveal_at <= ? ORDER BY reveal_at LIMIT ?");
const deletePendingStmt = db.prepare("DELETE FROM guess_pending WHERE message_id = ?");
const retryPendingStmt = db.prepare("UPDATE guess_pending SET attempts = attempts + 1, reveal_at = ? WHERE message_id = ?");

// Fige le vrai rang du joueur au moment du post. Sans compte lié (ou sans rang), pas de score.
async function scheduleReveal(message, g, now = Date.now()) {
  const authorId = message.author?.id;
  if (!authorId) return false;
  const truth = truthTierFromLink(await getLink(authorId), g.truthMode);
  if (!truth) return false;
  const revealAt = now + g.revealDelayHours * 3600_000;
  insertPendingStmt.run(message.id, message.guild.id, message.channel.id, authorId, truth, revealAt);
  return true;
}

/** Révélations en attente (tests, diagnostic). */
export function listPendingReveals(now = Infinity, limit = 1000) {
  return duePendingStmt.all(now === Infinity ? Number.MAX_SAFE_INTEGER : now, limit);
}

// Lit tous les votes de rank d'un message, au moment de la révélation (réaction retirée =
// non comptée). Pagine au-delà de 100 votants par emoji.
async function collectVotes(message, cfg) {
  const votes = [];
  for (const reaction of message.reactions.cache.values()) {
    const tier = tierOfReaction(reaction.emoji.id || reaction.emoji.name, cfg);
    if (!tier) continue;
    let after;
    for (;;) {
      const users = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
      for (const u of users.values()) votes.push({ userId: u.id, tier, bot: Boolean(u.bot) });
      if (users.size < 100) break;
      after = users.lastKey();
    }
  }
  return votes;
}

// Codes Discord définitifs : salon/message supprimé ou accès perdu → on abandonne la ligne.
const GONE_CODES = new Set([10003, 10008, 50001]);
export const REVEAL_BATCH = 10;
export const REVEAL_MAX_ATTEMPTS = 5;
const REVEAL_RETRY_MS = 15 * 60_000;

// Points + parties + révélation retirée, dans UNE transaction : un crash ne compte jamais deux fois.
const commitReveal = db.transaction((row, results) => {
  for (const r of results) {
    incrCounter(row.guild_id, r.userId, "guess_games", 1);
    if (r.points > 0) incrCounter(row.guild_id, r.userId, "guess_points", r.points);
    if (r.exact) incrCounter(row.guild_id, r.userId, "guess_exact", 1);
  }
  deletePendingStmt.run(row.message_id);
});

async function revealOne(client, row, now) {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) {
    deletePendingStmt.run(row.message_id);
    return "gone";
  }
  const cfg = await getGuild(row.guild_id);
  // Jeu ou score coupé entre-temps : on abandonne sans rien poster.
  if (!cfg.enabled || !cfg.scoringEnabled) {
    deletePendingStmt.run(row.message_id);
    return "disabled";
  }
  let message;
  let votes;
  try {
    const channel = await guild.channels.fetch(row.channel_id);
    if (!channel?.isTextBased?.()) {
      deletePendingStmt.run(row.message_id);
      return "gone";
    }
    // force : relit les réactions sur Discord, pas la copie en cache.
    message = await channel.messages.fetch({ message: row.message_id, force: true });
    votes = await collectVotes(message, cfg);
  } catch (err) {
    if (GONE_CODES.has(err?.code) || row.attempts + 1 >= REVEAL_MAX_ATTEMPTS) {
      deletePendingStmt.run(row.message_id);
      return "gone";
    }
    retryPendingStmt.run(now + REVEAL_RETRY_MS, row.message_id);
    return "retry";
  }

  const tally = tallyVotes(votes, row.truth_tier, cfg, { authorId: row.author_id });
  commitReveal(row, tally.results);

  await message
    .reply({ content: revealText(row.truth_tier, tally), allowedMentions: { parse: [], repliedUser: false } })
    .catch(() => {});
  for (const r of tally.results) {
    await grantAndAnnounce(guild, r.userId, {
      guessGames: getCounter(row.guild_id, r.userId, "guess_games"),
      guessPoints: getCounter(row.guild_id, r.userId, "guess_points"),
    }).catch(() => {});
  }
  return "revealed";
}

let revealing = false;

/**
 * Traite les révélations échues (par lots de REVEAL_BATCH). Appelé toutes les 5 min depuis
 * index.js ; garde anti-chevauchement. Renvoie le nombre de clips révélés.
 */
export async function tickGuessReveals(client, now = Date.now()) {
  if (revealing) return 0;
  revealing = true;
  let revealed = 0;
  try {
    for (const row of duePendingStmt.all(now, REVEAL_BATCH)) {
      try {
        if ((await revealOne(client, row, now)) === "revealed") revealed++;
      } catch (err) {
        console.warn("Révélation Devine ton rang :", err.message);
      }
    }
  } finally {
    revealing = false;
  }
  return revealed;
}

const rankAboveStmt = db.prepare("SELECT COUNT(*) AS n FROM counters WHERE guild_id = ? AND key = 'guess_points' AND val > ?");

/** Stats d'un membre : points, parties, rangs exacts, précision (%) et place au classement. */
export function guessStats(guildId, userId) {
  const points = getCounter(guildId, userId, "guess_points");
  const games = getCounter(guildId, userId, "guess_games");
  const exact = getCounter(guildId, userId, "guess_exact");
  const precision = games ? Math.round((exact / games) * 100) : 0;
  const place = points > 0 ? rankAboveStmt.get(String(guildId), points).n + 1 : null;
  return { points, games, exact, precision, place };
}
