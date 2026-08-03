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
import { applyVars } from "./welcome.js";

/**
 * Section League of Legends.
 *
 * Première brique : accueil des membres qui obtiennent le rôle LoL.
 * Le rôle lui-même est attribué par l'onboarding Discord (Paramètres du serveur →
 * Intégration/Onboarding : la réponse « League of Legends » donne le rôle). Le bot
 * se contente d'observer l'ajout du rôle — peu importe la source (onboarding,
 * reaction-role, attribution manuelle par le staff) — et poste le message d'accueil.
 */
const KEY = "lol";

const DEFAULT_CONFIG = {
  enabled: false,
  roleId: "",
  channelId: "",
  mode: "embed", // "embed" | "text" | "both"
  pingUser: true,
  oncePerMember: true,
  text: "{user} vient de rejoindre la section **League of Legends** 🎮",
  embed: {
    color: "#c89b3c",
    title: "🎮 Bienvenue sur la section LoL, {username} !",
    description:
      "Content de t'avoir avec nous sur **{server}** !\n\n" +
      "Ici tu peux parler de **League of Legends** librement : compos, patchs, ranked, " +
      "recherche de duo… Lance-toi, la commu t'attend 💬",
    image: "",
    thumbnailUser: true,
    footer: "{server} • Section LoL",
    footerIcon: true,
  },
};

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {}, greeted: {} });
  if (!cache.guilds) cache.guilds = {};
  if (!cache.greeted) cache.greeted = {};
  return cache;
}

function doWrite() {
  saveDoc(KEY, cache);
}

function save() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

function getGuild(guildId) {
  const c = load();
  const stored = c.guilds[guildId] || {};
  const g = { ...DEFAULT_CONFIG, ...stored, embed: { ...DEFAULT_CONFIG.embed, ...(stored.embed || {}) } };
  c.guilds[guildId] = g;
  return g;
}

export async function getLolConfig(guildId) {
  return JSON.parse(JSON.stringify(getGuild(guildId)));
}

export async function setLolConfig(guildId, patch) {
  const g = getGuild(guildId);
  Object.assign(g, patch);
  if (patch.embed) g.embed = { ...DEFAULT_CONFIG.embed, ...patch.embed };
  await save();
  return getLolConfig(guildId);
}

// ----- Anti-doublon : mémorise les membres déjà accueillis -----
function alreadyGreeted(guildId, userId) {
  const c = load();
  return Array.isArray(c.greeted[guildId]) && c.greeted[guildId].includes(userId);
}

function markGreeted(guildId, userId) {
  const c = load();
  const list = Array.isArray(c.greeted[guildId]) ? c.greeted[guildId] : [];
  if (list.includes(userId)) return;
  list.push(userId);
  // Borne la liste pour ne pas faire grossir le document indéfiniment.
  c.greeted[guildId] = list.slice(-5000);
  save();
}

/** Réinitialise l'historique d'accueil (bouton du dashboard). */
export async function resetGreeted(guildId) {
  const c = load();
  const n = (c.greeted[guildId] || []).length;
  c.greeted[guildId] = [];
  await save();
  return n;
}

/** Nombre de membres déjà accueillis (affiché dans le dashboard). */
export async function greetedCount(guildId) {
  const c = load();
  return (c.greeted[guildId] || []).length;
}

function hexToInt(hex) {
  const m = String(hex || "").match(/#?([0-9a-f]{6})/i);
  return m ? parseInt(m[1], 16) : 0xc89b3c;
}

/** Message d'accueil LoL (Components V2 en mode embed, texte simple sinon). */
export function buildLolWelcomePayload(member, guild, cfg) {
  const user = member.user || member;
  const mention = `<@${user.id}>`;
  const wantText = cfg.mode === "text" || cfg.mode === "both";
  const wantEmbed = cfg.mode === "embed" || cfg.mode === "both";

  if (!wantEmbed) {
    let content = applyVars(cfg.text, member, guild);
    if (cfg.pingUser && !content.includes(mention)) content = `${mention} ${content}`;
    return { content: content.slice(0, 2000), allowedMentions: { users: cfg.pingUser ? [user.id] : [] } };
  }

  const e = cfg.embed || {};
  const avatar = user.displayAvatarURL ? user.displayAvatarURL({ size: 256 }) : null;
  const container = new ContainerBuilder().setAccentColor(hexToInt(e.color));

  const head = [];
  const title = e.title
    ? applyVars(e.title, member, guild)
    : `🎮 Bienvenue sur la section LoL, ${member.displayName || user.username} !`;
  head.push(`## ${title}`.slice(0, 256));
  if (e.description) head.push(applyVars(e.description, member, guild));
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
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(e.image)),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const footerName = e.footer ? applyVars(e.footer, member, guild) : `${guild.name} • Section LoL`;
  const pingInside = cfg.pingUser && !wantText;
  const footerLine = `-# ${footerName} • <t:${Math.floor(Date.now() / 1000)}:f>${pingInside ? ` • ${mention}` : ""}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));

  const components = [];
  if (wantText) {
    let content = applyVars(cfg.text, member, guild);
    if (cfg.pingUser && !content.includes(mention)) content = `${mention} ${content}`;
    components.push(new TextDisplayBuilder().setContent(content.slice(0, 2000)));
  }
  components.push(container);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: cfg.pingUser ? [user.id] : [] },
  };
}

/**
 * Poste le message d'accueil LoL si le membre vient d'obtenir le rôle configuré.
 * `previousRoleIds` = rôles du membre AVANT la mise à jour (tableau vide à l'arrivée).
 * Renvoie toujours { ok, reason? } — l'appelant n'a pas à gérer d'exception métier.
 */
export async function handleLolRole(member, { previousRoleIds = [] } = {}) {
  const guild = member.guild;
  const cfg = getGuild(guild.id);
  if (!cfg.enabled) return { ok: false, reason: "module désactivé" };
  if (!cfg.roleId) return { ok: false, reason: "aucun rôle LoL configuré" };
  if (!cfg.channelId) return { ok: false, reason: "aucun salon configuré" };
  if (!member.roles.cache.has(cfg.roleId)) return { ok: false, reason: "rôle absent" };
  if (previousRoleIds.includes(cfg.roleId)) return { ok: false, reason: "rôle déjà présent" };
  if (cfg.oncePerMember && alreadyGreeted(guild.id, member.id)) return { ok: false, reason: "déjà accueilli" };

  const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return { ok: false, reason: "salon introuvable ou non textuel" };

  await ch.send(buildLolWelcomePayload(member, guild, cfg));
  if (cfg.oncePerMember) markGreeted(guild.id, member.id);
  return { ok: true };
}
