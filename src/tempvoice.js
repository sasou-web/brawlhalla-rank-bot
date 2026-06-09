import { loadDoc, saveDoc } from "./db.js";

const KEY = "tempvoice";

/**
 * Salons vocaux temporaires ("rejoindre pour creer"), avec PLUSIEURS hubs.
 * Structure : { guilds: { [guildId]: {
 *   enabled,
 *   categoryId,                                  // categorie par defaut des salons crees
 *   hubs: { [channelId]: { nameTemplate, userLimit } },
 *   temp: { [channelId]: ownerId }               // salons crees, suivis pour suppression
 * } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  categoryId: "",
  hubs: {},
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
  const g = { ...DEFAULT_CONFIG, temp: {}, ...(c.guilds[guildId] || {}) };
  if (!g.hubs || typeof g.hubs !== "object") g.hubs = {};
  if (!g.temp || typeof g.temp !== "object") g.temp = {};
  // Migration depuis l'ancien format mono-hub.
  if (g.hubChannelId) {
    g.hubs[g.hubChannelId] = {
      nameTemplate: g.nameTemplate || "🎮 {user}",
      userLimit: g.userLimit || 0,
    };
    delete g.hubChannelId;
    delete g.nameTemplate;
    delete g.userLimit;
  }
  c.guilds[guildId] = g;
  return g;
}

export async function getTempConfig(guildId) {
  const g = await getGuild(guildId);
  const { temp, ...config } = g;
  return config;
}

export async function setTempConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  await save();
  return getTempConfig(guildId);
}

// ---------- Hubs ----------

export async function addHub(guildId, channelId, { nameTemplate, userLimit }) {
  const g = await getGuild(guildId);
  g.hubs[channelId] = {
    nameTemplate: nameTemplate || "🎮 {user}",
    userLimit: Math.min(99, Math.max(0, Number(userLimit) || 0)),
  };
  await save();
}

export async function removeHub(guildId, channelId) {
  const g = await getGuild(guildId);
  if (g.hubs[channelId]) {
    delete g.hubs[channelId];
    await save();
  }
}

export async function getHub(guildId, channelId) {
  const g = await getGuild(guildId);
  return g.hubs[channelId] || null;
}

// ---------- Salons temporaires crees ----------

export async function addTempChannel(guildId, channelId, ownerId) {
  const g = await getGuild(guildId);
  g.temp[channelId] = ownerId;
  await save();
}

export async function removeTempChannel(guildId, channelId) {
  const g = await getGuild(guildId);
  if (g.temp[channelId]) {
    delete g.temp[channelId];
    await save();
  }
}

export async function isTempChannel(guildId, channelId) {
  const g = await getGuild(guildId);
  return Boolean(g.temp[channelId]);
}

export async function getTempOwner(guildId, channelId) {
  const g = await getGuild(guildId);
  return g.temp[channelId] || null;
}

export async function setTempOwner(guildId, channelId, ownerId) {
  const g = await getGuild(guildId);
  if (g.temp[channelId] !== undefined) {
    g.temp[channelId] = ownerId;
    await save();
  }
}

export async function getTempChannelIds(guildId) {
  const g = await getGuild(guildId);
  return Object.keys(g.temp);
}
