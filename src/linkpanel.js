import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { loadDoc, saveDoc } from "./db.js";

const KEY = "linkpanel";

/**
 * Panneau de liaison persistant : un embed + un bouton « Lier mon compte » posté dans un
 * salon. Au clic, un modal s'ouvre (pseudo / ID), puis on réutilise le flux de /lier
 * (menu de sélection + carte de confirmation). Plus besoin de connaître la commande.
 *
 * Structure : { guilds: { [guildId]: { enabled, channelId, title, description, color,
 *                                      buttonLabel, thumbnailUrl } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  channelId: "",
  title: "🔗 Lier ton compte Brawlhalla",
  description:
    "Clique sur le bouton ci-dessous pour lier ton compte et recevoir automatiquement tes rôles de rank.\n\n" +
    "💡 **Le plus fiable : ton Brawlhalla ID.** Tu le trouves sur **corehalla.com** (cherche ton pseudo) " +
    "ou dans l'appli Brawlhalla. La recherche par pseudo marche aussi, mais l'API est parfois capricieuse.",
  color: "#4ea1ff",
  buttonLabel: "Lier mon compte",
  thumbnailUrl: "",
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
  if ("description" in clean) clean.description = String(clean.description || "").slice(0, 3500);
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

/** Payload Discord (embed + bouton) du panneau public de liaison. */
export function buildLinkPanelPayload(cfg) {
  const embed = new EmbedBuilder()
    .setTitle(cfg.title || "🔗 Lier ton compte Brawlhalla")
    .setDescription(cfg.description || "Clique pour lier ton compte.")
    .setColor(parseColor(cfg.color));
  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lnkp_open")
      .setLabel((cfg.buttonLabel || "Lier mon compte").slice(0, 80))
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}
