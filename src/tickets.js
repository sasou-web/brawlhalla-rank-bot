import { loadDoc, saveDoc } from "./db.js";

const KEY = "tickets";

/**
 * Systeme de tickets de support integre au bot.
 *
 * Structure : { guilds: { [guildId]: {
 *   enabled,                                     // le panneau public cree-t-il des tickets ?
 *   categoryId,                                  // categorie ou sont crees les salons de ticket
 *   staffRoleId,                                 // role qui voit/gere tous les tickets
 *   logChannelId,                                // salon ou sont postes les transcripts a la fermeture
 *   panelTitle, panelDescription,                // texte du panneau public
 *   topics: [ { id, label, emoji, description } ],// motifs proposes (vide = bouton unique)
 *   counter,                                     // numero incremental du prochain ticket
 *   open: { [channelId]: { ownerId, number, topic, claimedBy, createdTs } }
 * } } }
 *
 * Persistance via le document store SQLite (loadDoc/saveDoc), comme les autres modules.
 */
const DEFAULT_CONFIG = {
  enabled: false,
  categoryId: "",
  staffRoleId: "",
  logChannelId: "",
  panelTitle: "🎫 Support & Tickets",
  panelDescription:
    "Besoin d'aide, d'un signalement ou d'une question pour le staff ?\n" +
    "Clique sur le bouton ci-dessous pour ouvrir un ticket privé.",
  topics: [],
  counter: 1,
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
  const g = { ...DEFAULT_CONFIG, open: {}, ...(c.guilds[guildId] || {}) };
  if (!Array.isArray(g.topics)) g.topics = [];
  if (!g.open || typeof g.open !== "object") g.open = {};
  c.guilds[guildId] = g;
  return g;
}

/** Config (sans la liste des tickets ouverts). */
export async function getTicketConfig(guildId) {
  const g = await getGuild(guildId);
  const { open, ...config } = g;
  return config;
}

export async function setTicketConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  await save();
  return getTicketConfig(guildId);
}

// ---------- Motifs (topics) ----------

export async function addTopic(guildId, { label, emoji, description }) {
  const g = await getGuild(guildId);
  const id = `t${Date.now().toString(36)}`;
  g.topics.push({
    id,
    label: String(label || "Ticket").slice(0, 80),
    emoji: emoji || "🎫",
    description: String(description || "").slice(0, 100),
  });
  // Discord limite un select a 25 options.
  g.topics = g.topics.slice(0, 25);
  await save();
  return id;
}

export async function removeTopic(guildId, topicId) {
  const g = await getGuild(guildId);
  const before = g.topics.length;
  g.topics = g.topics.filter((t) => t.id !== topicId);
  if (g.topics.length !== before) await save();
}

export async function getTopic(guildId, topicId) {
  const g = await getGuild(guildId);
  return g.topics.find((t) => t.id === topicId) || null;
}

// ---------- Tickets ouverts ----------

/** Reserve un numero de ticket et incremente le compteur. */
export async function nextTicketNumber(guildId) {
  const g = await getGuild(guildId);
  const n = g.counter || 1;
  g.counter = n + 1;
  await save();
  return n;
}

export async function addOpenTicket(guildId, channelId, data) {
  const g = await getGuild(guildId);
  g.open[channelId] = { claimedBy: "", createdTs: Date.now(), ...data };
  await save();
}

export async function removeOpenTicket(guildId, channelId) {
  const g = await getGuild(guildId);
  if (g.open[channelId]) {
    delete g.open[channelId];
    await save();
  }
}

export async function getOpenTicket(guildId, channelId) {
  const g = await getGuild(guildId);
  return g.open[channelId] || null;
}

export async function setTicketClaim(guildId, channelId, userId) {
  const g = await getGuild(guildId);
  if (g.open[channelId]) {
    g.open[channelId].claimedBy = userId;
    await save();
  }
}

/** Nombre de tickets actuellement ouverts par un membre donne. */
export async function countOpenByOwner(guildId, ownerId) {
  const g = await getGuild(guildId);
  return Object.values(g.open).filter((t) => t.ownerId === ownerId).length;
}
