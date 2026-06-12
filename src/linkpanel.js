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
 *   benefitsTitle, benefits, footerText, color, buttonLabel, thumbnailUrl, bannerUrl } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelId: "",
  title: "🔗 Lier ton compte Brawlhalla",
  description: "Relie ton compte en 10 secondes et reçois automatiquement tes rôles selon ton rang.",
  benefitsTitle: "✨ Pourquoi lier ton compte ?",
  benefits:
    "🎖️ **Rôles de rank automatiques** en 1v1 & 2v2\n" +
    "🔄 **Mise à jour auto** de tes rôles à chaque changement de rang\n" +
    "🌍 **Rôle de région** (EU, US, BRZ...)\n" +
    "🏆 **Classement du serveur** + rôle « 👑 N°1 du serveur »\n" +
    "📊 Tes stats accessibles via `/stats` et `/rank`",
  footerText:
    "💡 Le plus fiable : ton **Brawlhalla ID** (sur corehalla.com ou dans l'appli). " +
    "Le pseudo marche aussi, mais l'API est parfois capricieuse.",
  color: "#4ea1ff",
  buttonLabel: "Lier mon compte",
  thumbnailUrl: "",
  bannerUrl: "",
};

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
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
  if ("buttonLabel" in clean) clean.buttonLabel = String(clean.buttonLabel || "Lier mon compte").slice(0, 80);
  Object.assign(g, clean);
  await save();
  return getLinkPanelConfig(guildId);
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
  const head = `## ${cfg.title || "🔗 Lier ton compte Brawlhalla"}\n${cfg.description || ""}`.slice(0, 4000);
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
        `### ${cfg.benefitsTitle || "✨ Pourquoi lier ton compte ?"}\n${cfg.benefits.trim()}`.slice(0, 4000),
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
        .setLabel((cfg.buttonLabel || "Lier mon compte").slice(0, 80))
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
