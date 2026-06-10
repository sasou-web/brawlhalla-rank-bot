import { loadDoc, saveDoc } from "./db.js";
import { incrCounter, grantAchievements } from "./achievements.js";

const KEY = "clips";

/**
 * Reactions automatiques sur les salons de clips.
 * Structure : { guilds: { [guildId]: {
 *   enabled, channelIds: string[], reactions: string[], ignoreBots, ignoreReplies
 * } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelIds: [], // salons surveilles
  reactions: ["🔥", "👍", "👎"], // emojis ajoutes a chaque clip (ordre conserve)
  ignoreBots: true, // ne pas reagir aux messages de bots
  ignoreReplies: true, // ne pas reagir aux reponses/commentaires (seulement les posts)
  requireVideo: true, // ne reagir QUE si le message contient une video (fichier ou lien)
  deleteNonVideo: false, // supprimer les messages qui ne sont pas des clips video
  extraDomains: [], // hebergeurs video supplementaires acceptes (ex: "catbox.moe")
  pinThreshold: 0, // epingle le clip quand une reaction atteint ce nombre (0 = desactive)
};

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
  if (!Array.isArray(g.reactions)) g.reactions = [...DEFAULT_CONFIG.reactions];
  c.guilds[guildId] = g;
  return g;
}

export async function getClipsConfig(guildId) {
  return { ...(await getGuild(guildId)) };
}

export async function setClipsConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  await save();
  return { ...g };
}

// Analyse une saisie de domaines ("catbox.moe, dubz.gg") -> tableau nettoye.
export function parseDomains(input) {
  if (!input) return [];
  return [
    ...new Set(
      String(input)
        .split(/[\s,;]+/)
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

// Analyse une chaine "🔥 👍 <:custom:123>" -> tableau d'emojis (ordre preserve).
export function parseReactions(input) {
  if (!input) return [];
  const customRe = /<a?:\w+:\d+>/g;
  const tokens = [];

  const pushUnicode = (str) => {
    if (!str || !str.trim()) return;
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter("fr", { granularity: "grapheme" });
      for (const s of seg.segment(str)) {
        const g = s.segment.trim();
        if (g) tokens.push(g);
      }
    } else {
      for (const chunk of str.split(/\s+/).filter(Boolean)) tokens.push(chunk);
    }
  };

  let lastIndex = 0;
  let m;
  while ((m = customRe.exec(input)) !== null) {
    pushUnicode(input.slice(lastIndex, m.index));
    tokens.push(m[0]);
    lastIndex = customRe.lastIndex;
  }
  pushUnicode(input.slice(lastIndex));

  // Discord limite a 20 reactions par message.
  return tokens.slice(0, 20);
}

// Detecte si un message contient une video : fichier video joint, embed video,
// ou lien vers un hebergeur de clips/videos. Necessite l'intent Message Content
// pour voir les pieces jointes et le contenu (sinon ils sont vides).
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v|gifv)(\?|$)/i;

// Hebergeurs video/clips reconnus par defaut (sous-chaines cherchees dans le lien).
const DEFAULT_VIDEO_HOSTS = [
  "tiktok.com", "youtu.be", "youtube.com", "streamable.com", "medal.tv",
  "twitch.tv", "v.redd.it", "kick.com", "catbox.moe", "litterbox.catbox.moe",
  "dubz.co", "dubz.link", "dubz.live", "dubz.gg", "gfycat.com", "imgur.com",
  "streamja.com", "streamye.com", "streamwo.com", "streamgg.com", "outplayed.tv",
  "x.com", "twitter.com", "pomf", "files.vc", "gofile.io", "streamin.one",
  "cdn.discordapp.com/attachments", "media.discordapp.net",
];

export function isVideoClip(message, extraDomains = []) {
  // 1. Piece jointe video
  for (const att of message.attachments?.values?.() ?? []) {
    const ct = att.contentType || "";
    if (ct.startsWith("video/")) return true;
    if (VIDEO_EXT_RE.test(att.name || att.url || "")) return true;
  }
  // 2. Embed video (si Discord l'a deja deroule)
  if (message.embeds?.some((e) => e?.video || e?.type === "video" || e?.type === "gifv")) return true;
  // 3. Lien : extension video directe, ou hebergeur connu / supplementaire
  const content = (message.content || "").toLowerCase();
  if (!content) return false;
  if (VIDEO_EXT_RE.test(content)) return true;
  const hosts = [...DEFAULT_VIDEO_HOSTS, ...extraDomains.map((d) => String(d).toLowerCase().trim())];
  return hosts.some((h) => h && content.includes(h));
}

// Traite un message dans un salon de clips : reagit si c'est une video,
// sinon supprime le message si l'option deleteNonVideo est active. Best-effort.
export async function handleClipMessage(message) {
  const g = await getGuild(message.guild.id);
  if (!g.enabled) return false;
  if (!g.channelIds.includes(message.channel.id)) return false;
  if (g.ignoreBots && message.author?.bot) return false;

  const video = isVideoClip(message, g.extraDomains);
  const isReply = Boolean(g.ignoreReplies && message.reference?.messageId);

  // Le message "qualifie" pour des reactions si on ne filtre pas, ou si c'est une video.
  if (!g.requireVideo || video) {
    if (isReply) return false; // on ne reagit pas aux reponses/commentaires
    // Compteur de clips postés + achievements (best-effort, n'empêche pas les réactions).
    try {
      if (message.author?.id && !message.author.bot) {
        const n = incrCounter(message.guild.id, message.author.id, "clips");
        grantAchievements(message.guild.id, message.author.id, { clips: n });
      }
    } catch {
      /* best-effort */
    }
    for (const emoji of g.reactions) {
      try {
        await message.react(emoji);
      } catch {
        /* emoji invalide ou pas de perm */
      }
    }
    return true;
  }

  // requireVideo actif et message sans video : suppression si activee.
  if (g.deleteNonVideo) {
    const author = message.author;
    const channel = message.channel;
    await message.delete().catch(() => {});
    // Avertissement bref, auto-efface au bout de 8s (best-effort).
    try {
      const notice = await channel.send({
        content: `🎬 <@${author?.id}> ce salon est réservé aux **clips vidéo**, ton message a été supprimé.`,
        allowedMentions: { users: author?.id ? [author.id] : [] },
      });
      setTimeout(() => notice.delete().catch(() => {}), 8000);
    } catch {
      /* pas de perm pour ecrire : on ignore */
    }
    return true;
  }
  return false;
}

/**
 * Épingle automatiquement un clip quand une de ses réactions atteint le seuil configuré
 * (pinThreshold). Appelé à chaque réaction ajoutée dans un salon de clips. Best-effort.
 * Renvoie true si le message vient d'être épinglé.
 *
 * Note : le bot ajoute lui-même les réactions de base, donc chaque compteur inclut +1
 * (sa propre réaction). Règle ton seuil en conséquence.
 */
export async function handleClipReaction(message) {
  if (!message?.guild) return false;
  const g = await getGuild(message.guild.id);
  if (!g.enabled) return false;
  const threshold = Math.floor(g.pinThreshold || 0);
  if (threshold <= 0) return false;
  if (!g.channelIds.includes(message.channelId)) return false;
  if (message.pinned) return false;

  // Compteur de réactions le plus élevé sur le message (les "votes" du meilleur emoji).
  let max = 0;
  for (const r of message.reactions?.cache?.values?.() ?? []) max = Math.max(max, r.count || 0);
  if (max < threshold) return false;

  try {
    await message.pin("📌 Meilleur clip — seuil de réactions atteint");
    return true;
  } catch {
    return false; // pas de permission, ou 50 épingles déjà atteintes
  }
}
