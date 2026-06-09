import { loadDoc, saveDoc } from "./db.js";

const KEY = "welcome";

/**
 * Messages de bienvenue / au revoir + auto-role.
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelId: "",
  mode: "embed", // "embed" | "text" | "both"
  pingUser: true,
  text: "Bienvenue {user} sur **{server}** ! Tu es notre {membercount}ᵉ membre 🎉",
  embed: {
    color: "#7c5cff",
    title: "👋 Bienvenue {username} !",
    description:
      "Content de t'accueillir sur **{server}** !\nTu es le membre **#{membercount}**.\n\nPense à lire les règles et à lier ton compte Brawlhalla avec **/lier**.",
    image: "",
    thumbnailUser: true,
    footer: "{server}",
    footerIcon: true,
  },
  autoRoleEnabled: false,
  autoRoleIds: [],
  goodbyeEnabled: false,
  goodbyeChannelId: "",
  goodbyeText: "**{username}** a quitté le serveur. À bientôt 👋  (on est maintenant {membercount})",
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
  const stored = c.guilds[guildId] || {};
  const g = { ...DEFAULT_CONFIG, ...stored, embed: { ...DEFAULT_CONFIG.embed, ...(stored.embed || {}) } };
  if (!Array.isArray(g.autoRoleIds)) g.autoRoleIds = [];
  c.guilds[guildId] = g;
  return g;
}

export async function getWelcomeConfig(guildId) {
  const g = await getGuild(guildId);
  return JSON.parse(JSON.stringify(g));
}

export async function setWelcomeConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  if (patch.embed) g.embed = { ...DEFAULT_CONFIG.embed, ...patch.embed };
  await save();
  return getWelcomeConfig(guildId);
}

// ----- Variables -----
export function applyVars(str, member, guild) {
  if (!str) return str;
  const user = member.user || member;
  const name = member.displayName || user.globalName || user.username || "membre";
  return String(str)
    .replaceAll("{user}", `<@${user.id}>`)
    .replaceAll("{username}", name)
    .replaceAll("{user.name}", user.username || name)
    .replaceAll("{user.tag}", user.tag || user.username || name)
    .replaceAll("{server}", guild.name)
    .replaceAll("{membercount}", String(guild.memberCount))
    .replaceAll("{count}", String(guild.memberCount));
}

function hexToInt(hex) {
  const m = String(hex || "").match(/#?([0-9a-f]{6})/i);
  return m ? parseInt(m[1], 16) : 0x7c5cff;
}

// ----- Payloads -----
export function buildWelcomePayload(member, guild, cfg) {
  const user = member.user || member;
  const mention = `<@${user.id}>`;
  const payload = { allowedMentions: { users: cfg.pingUser ? [user.id] : [] } };

  const wantText = cfg.mode === "text" || cfg.mode === "both";
  const wantEmbed = cfg.mode === "embed" || cfg.mode === "both";

  if (wantText) {
    let content = applyVars(cfg.text, member, guild);
    if (cfg.pingUser && !content.includes(mention)) content = `${mention} ${content}`;
    payload.content = content.slice(0, 2000);
  } else if (cfg.pingUser) {
    payload.content = mention; // ping hors embed (les embeds ne pingent pas)
  }

  if (wantEmbed) {
    const e = cfg.embed || {};
    const embed = { color: hexToInt(e.color) };
    if (e.title) embed.title = applyVars(e.title, member, guild).slice(0, 256);
    if (e.description) embed.description = applyVars(e.description, member, guild).slice(0, 4096);
    if (e.thumbnailUser) embed.thumbnail = { url: user.displayAvatarURL ? user.displayAvatarURL({ size: 256 }) : member.user.displayAvatarURL() };
    if (e.image) embed.image = { url: e.image };
    if (e.footer) {
      embed.footer = { text: applyVars(e.footer, member, guild).slice(0, 2048) };
      if (e.footerIcon && guild.iconURL()) embed.footer.icon_url = guild.iconURL();
    }
    embed.timestamp = new Date().toISOString();
    payload.embeds = [embed];
  }

  return payload;
}

export function buildGoodbyePayload(member, guild, cfg) {
  return {
    content: applyVars(cfg.goodbyeText, member, guild).slice(0, 2000),
    allowedMentions: { parse: [] },
  };
}
