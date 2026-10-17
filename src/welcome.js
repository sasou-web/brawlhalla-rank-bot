import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ThumbnailBuilder,
  MessageFlags,
} from "discord.js";
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
  pingRoleId: "",
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
  // Alerte staff (./welcomeStaff.js) : prévient un salon staff à chaque arrivée, avec un
  // lien vers le message de bienvenue de Discord. Rôle notifié au plus une fois par délai.
  staffEnabled: false,
  staffChannelId: "",
  staffRoleId: "",
  staffChatChannelId: "",
  staffPingCooldownMin: 10,
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
// `opts.role` (id validé par pingRoleId, ou "") active {role} : messages d'accueil seulement.
export function applyVars(str, member, guild, opts = {}) {
  if (!str) return str;
  const user = member.user || member;
  const name = member.displayName || user.globalName || user.username || "membre";
  let out = String(str);
  if (opts.role !== undefined) out = out.replaceAll("{role}", opts.role ? `<@&${opts.role}>` : "");
  return out
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

/**
 * Rôle pingé par {role} : un rôle existant du serveur, jamais @everyone (même id que le
 * serveur). Renvoie l'id validé, ou "" (la variable est alors vidée et personne n'est pingé).
 */
export function pingRoleId(guild, roleId) {
  const id = String(roleId || "");
  if (!/^\d{17,20}$/.test(id) || id === guild.id) return "";
  const cache = guild.roles?.cache;
  if (cache && !cache.has(id)) return "";
  return id;
}

/**
 * Mentions autorisées d'un message d'accueil : le membre (si pingUser) et le rôle choisi,
 * rien d'autre (ni @everyone/@here, ni un <@&id> collé à la main). `test` : le bouton
 * « Envoyer un test » affiche le rôle sans notifier ses membres.
 */
export function greetingMentions(userId, cfg, roleId, { test = false } = {}) {
  return { users: cfg.pingUser ? [userId] : [], roles: roleId && !test ? [roleId] : [] };
}

// ----- Payloads -----
export function buildWelcomePayload(member, guild, cfg, { test = false } = {}) {
  const user = member.user || member;
  const mention = `<@${user.id}>`;
  const roleId = pingRoleId(guild, cfg.pingRoleId);
  const roleMention = roleId ? `<@&${roleId}>` : "";
  const vars = (str) => applyVars(str, member, guild, { role: roleId });
  const allowedMentions = greetingMentions(user.id, cfg, roleId, { test });
  const wantText = cfg.mode === "text" || cfg.mode === "both";
  const wantEmbed = cfg.mode === "embed" || cfg.mode === "both";

  // Mode texte seul : message classique (pas de Components V2).
  if (!wantEmbed) {
    let content = vars(cfg.text);
    if (roleMention && !content.includes(roleMention)) content = `${roleMention} ${content}`;
    if (cfg.pingUser && !content.includes(mention)) content = `${mention} ${content}`;
    return { content: content.slice(0, 2000), allowedMentions };
  }

  // Mode embed / both : Components V2 (carte stylée, bordure de couleur, avatar à droite).
  const e = cfg.embed || {};
  const avatar = user.displayAvatarURL ? user.displayAvatarURL({ size: 256 }) : null;
  const container = new ContainerBuilder().setAccentColor(hexToInt(e.color));

  const head = [];
  const title = e.title ? vars(e.title) : `👋 Bienvenue ${member.displayName || user.username} !`;
  head.push(`## ${title}`.slice(0, 256));
  if (e.description) head.push(vars(e.description));
  const headText = head.join("\n").slice(0, 4000);

  if (e.thumbnailUser && avatar) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headText));
  }

  if (e.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(e.image)));
  }

  // Pied : serveur + horodatage, en sous-texte discret. Le ping du membre est intégré ici
  // (un composant texte V2 dans le container notifie bien, grâce à allowedMentions).
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const footerName = e.footer ? vars(e.footer) : guild.name;
  const pingInside = cfg.pingUser && !wantText;
  // Rôle choisi sans {role} dans les textes : ajouté comme le ping du membre (texte, sinon pied).
  const roleMissing = roleMention && !headText.includes(roleMention) && !footerName.includes(roleMention);
  const roleInside = roleMissing && !wantText;
  const footerLine = `-# ${footerName} • <t:${Math.floor(Date.now() / 1000)}:f>${pingInside ? ` • ${mention}` : ""}${roleInside ? ` • ${roleMention}` : ""}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));

  // Le texte (mode « both ») reste un composant au-dessus de la carte. Le ping seul (mode
  // embed) est désormais intégré dans la carte (voir pingInside ci-dessus).
  const components = [];
  if (wantText) {
    let content = vars(cfg.text);
    if (roleMissing && !content.includes(roleMention)) content = `${roleMention} ${content}`;
    if (cfg.pingUser && !content.includes(mention)) content = `${mention} ${content}`;
    components.push(new TextDisplayBuilder().setContent(content.slice(0, 2000)));
  }
  components.push(container);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions,
  };
}

export function buildGoodbyePayload(member, guild, cfg) {
  return {
    content: applyVars(cfg.goodbyeText, member, guild).slice(0, 2000),
    allowedMentions: { parse: [] },
  };
}
