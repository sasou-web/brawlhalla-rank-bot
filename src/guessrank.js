import { isVideoClip } from "./clips.js";
import { loadDoc, saveDoc } from "./db.js";

const KEY = "guessrank";

/**
 * "Devine ton rang" : meme principe que les clips, mais le bot ajoute des emojis
 * de rank (custom) pour que les membres votent le rang du joueur.
 * Structure : { guilds: { [guildId]: {
 *   enabled, channelIds, reactions (emojis de rank), ignoreBots, ignoreReplies,
 *   requireVideo, deleteNonVideo, extraDomains
 * } } }
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
  if (!Array.isArray(g.reactions)) g.reactions = [];
  if (!Array.isArray(g.extraDomains)) g.extraDomains = [];
  c.guilds[guildId] = g;
  return g;
}

export async function getGuessRankConfig(guildId) {
  return { ...(await getGuild(guildId)) };
}

export async function setGuessRankConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  await save();
  return { ...g };
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
