import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

const KEY = "linkpanel";

/**
 * Panneau de liaison persistant (Components V2) : un joli cadre + un bouton « Lier mon
 * compte ». Au clic, un modal (ID / pseudo) lance la liaison, qui réutilise le flux de
 * /lier (menu de sélection + carte de confirmation). Plus besoin de connaître la commande.
 *
 * Structure : { guilds: { [guildId]: { enabled, channelId, title, description,
 *   benefitsTitle, benefits, footerText, color, buttonLabel, thumbnailUrl, bannerUrl } },
 *   posted: { [guildId]: { channelId, messageId } } }
 * `posted` (dernier panneau publié) reste hors de la config éditable du dashboard.
 */
// Textes du panneau (les mêmes que propose « Remettre le texte conseillé » du dashboard).
// Courts, en étapes : ce que tu fais, puis ce que tu gagnes. N'y citer que ce que la liaison
// apporte vraiment (rôles 1v1/2v2/3v3, région et Top 100, /top, contrôle de rank du LFG).
export const DEFAULT_TEXTS = {
  title: "🔗 Lie ton compte Brawlhalla",
  description:
    "**3 étapes**, 10 secondes ⏱️\n" +
    "**1.** Clique sur **Lier mon compte** en bas 👇\n" +
    "**2.** Mets ton **Brawlhalla ID** (ou ton pseudo)\n" +
    "**3.** Confirme que c'est bien toi ✅",
  benefitsTitle: "🎁 Ce que tu gagnes",
  benefits:
    "🎖️ **Ton rank en rôle** en 1v1, 2v2 et 3v3, mis à jour tout seul\n" +
    "🌍 **Ta région** + le rôle **Top 100** si tu y es\n" +
    "👑 **Classement du serveur** avec `/top`\n" +
    "🔍 **LFG 2v2 et 3v3** : trouve des mates de ton niveau\n" +
    "📊 **Tes stats** avec `/stats` et `/carte`",
  footerText: "💡 Ton **ID** est sur **corehalla.com** (tape ton pseudo). Plus sûr que la recherche par pseudo.",
  buttonLabel: "Lier mon compte",
};

const DEFAULT_CONFIG = {
  enabled: false,
  channelId: "",
  ...DEFAULT_TEXTS,
  color: "#4ea1ff",
  thumbnailUrl: "",
  bannerUrl: "",
};

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {}, posted: {} });
  if (!cache.guilds) cache.guilds = {};
  if (!cache.posted) cache.posted = {};
  return cache;
}

function save() {
  writeChain = writeChain.then(() => saveDoc(KEY, cache), () => saveDoc(KEY, cache));
  return writeChain;
}

async function getGuild(guildId) {
  const c = await load();
  const g = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  c.guilds[guildId] = g;
  return g;
}

export async function getLinkPanelConfig(guildId) {
  return getGuild(guildId);
}

export async function setLinkPanelConfig(guildId, patch) {
  const g = await getGuild(guildId);
  const clean = { ...patch };
  if ("title" in clean) clean.title = String(clean.title || "").slice(0, 256);
  if ("description" in clean) clean.description = String(clean.description || "").slice(0, 2000);
  if ("benefitsTitle" in clean) clean.benefitsTitle = String(clean.benefitsTitle || "").slice(0, 256);
  if ("benefits" in clean) clean.benefits = String(clean.benefits || "").slice(0, 2000);
  if ("footerText" in clean) clean.footerText = String(clean.footerText || "").slice(0, 1000);
  if ("buttonLabel" in clean) clean.buttonLabel = String(clean.buttonLabel || DEFAULT_TEXTS.buttonLabel).slice(0, 80);
  Object.assign(g, clean);
  await save();
  return getLinkPanelConfig(guildId);
}

/** Remet les textes conseillés (titre, accroche, avantages, conseil, bouton). Garde salon et apparence. */
export async function resetLinkPanelTexts(guildId) {
  return setLinkPanelConfig(guildId, { ...DEFAULT_TEXTS });
}

/** Dernier panneau publié ({ channelId, messageId }) ou null. */
export async function getLinkPanelPosted(guildId) {
  const c = await load();
  return c.posted[guildId] || null;
}

export async function setLinkPanelPosted(guildId, posted) {
  const c = await load();
  if (posted) c.posted[guildId] = { channelId: String(posted.channelId), messageId: String(posted.messageId) };
  else delete c.posted[guildId];
  await save();
}

/** Vrai si un des composants (imbriqués, Components V2 compris) porte ce customId (PURE). */
export function hasCustomId(components, customId) {
  for (const comp of components || []) {
    if (!comp) continue;
    if ((comp.customId ?? comp.custom_id ?? comp.data?.custom_id) === customId) return true;
    if (hasCustomId(comp.components, customId)) return true;
    if (comp.accessory && hasCustomId([comp.accessory], customId)) return true;
  }
  return false;
}

/** Vrai si ce message est un panneau de liaison posté par le bot (PURE). */
export function isLinkPanelMessage(msg, botId) {
  return !!msg && msg.author?.id === botId && hasCustomId(msg.components, "lnkp_open");
}

// Couleur hex ("#4ea1ff") ou nombre -> entier. Repli sur le bleu du bot.
function parseColor(c) {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const n = parseInt(c.replace(/^#/, ""), 16);
    if (Number.isFinite(n)) return n;
  }
  return 0x4ea1ff;
}

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/** Payload Discord (Components V2) du panneau public de liaison. */
export function buildLinkPanelPayload(cfg) {
  const container = new ContainerBuilder().setAccentColor(parseColor(cfg.color));

  // Bannière intégrée en haut du cadre (optionnelle).
  if (cfg.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(cfg.bannerUrl)),
    );
  }

  // En-tête : titre + description, avec la vignette à droite si fournie.
  const head = `## ${cfg.title || DEFAULT_TEXTS.title}\n${cfg.description || ""}`.slice(0, 4000);
  if (cfg.thumbnailUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(cfg.thumbnailUrl)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  }

  // Avantages de la liaison.
  if (cfg.benefits && cfg.benefits.trim()) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${cfg.benefitsTitle || DEFAULT_TEXTS.benefitsTitle}\n${cfg.benefits.trim()}`.slice(0, 4000),
      ),
    );
  }

  // Pied : conseil (ID fiable) en sous-texte discret.
  if (cfg.footerText && cfg.footerText.trim()) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${cfg.footerText.trim()}`.slice(0, 4000)),
    );
  }

  // Bouton d'ouverture du modal, intégré dans le cadre.
  container.addSeparatorComponents(divider());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lnkp_open")
        .setLabel((cfg.buttonLabel || DEFAULT_TEXTS.buttonLabel).slice(0, 80))
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
