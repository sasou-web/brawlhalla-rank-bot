import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
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
 *   panelColor, bannerUrl, thumbnailUrl,         // apparence (couleur, grande image, vignette)
 *   rulesText, tosUrl, selectPlaceholder,        // règles à lire, lien CGU, placeholder du menu
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
    "Choisis un motif dans le menu ci-dessous pour ouvrir un ticket privé.",
  panelColor: "#5865f2",
  bannerUrl: "",
  thumbnailUrl: "",
  rulesText: "",
  tosUrl: "",
  selectPlaceholder: "Choisis un motif pour ouvrir un ticket",
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
  // Le dashboard envoie le tableau complet de motifs : on normalise (id stable, longueurs).
  if (patch && Array.isArray(patch.topics)) {
    patch = { ...patch, topics: normalizeTopics(patch.topics) };
  }
  Object.assign(g, patch);
  await save();
  return getTicketConfig(guildId);
}

// Normalise une liste de motifs venant du dashboard : garde l'id existant ou en génère un,
// borne les longueurs (limites Discord) et fournit un emoji par défaut.
function normalizeTopics(arr) {
  return arr.slice(0, 25).map((t, i) => ({
    id: (t && t.id && String(t.id)) || `t${Date.now().toString(36)}${i}`,
    label: String((t && t.label) || "Ticket").slice(0, 80),
    emoji: t && t.emoji ? String(t.emoji).slice(0, 40) : "🎫",
    description: String((t && t.description) || "").slice(0, 100),
  }));
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

// ====================================================================
// Construction du panneau public (embed + menu déroulant / bouton)
// Partagé entre le panneau Discord (/setup-tickets) et le dashboard web.
// ====================================================================

// Couleur hex ("#5865f2") ou nombre -> entier pour EmbedBuilder. Repli sur le bleu Discord.
function parseColor(c) {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const n = parseInt(c.replace(/^#/, ""), 16);
    if (Number.isFinite(n)) return n;
  }
  return 0x5865f2;
}

// Résout un emoji d'option : custom (<:name:id> / <a:name:id>) ou unicode court. Sinon undefined.
function resolveEmoji(e) {
  if (!e) return undefined;
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(e);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  if ([...e].length <= 4) return e; // emoji unicode
  return undefined;
}

function buildDescription(cfg) {
  let d = cfg.panelDescription || "Clique pour ouvrir un ticket privé avec le staff.";
  if (cfg.tosUrl) d += `\n\n📜 [Terms of Service](${cfg.tosUrl})`;
  return d.slice(0, 4000);
}

/** Payload Discord (embeds + components) du panneau public de tickets, à partir de la config. */
export function buildTicketPanelPayload(cfg) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.panelColor))
    .setTitle((cfg.panelTitle || "🎫 Support & Tickets").slice(0, 256))
    .setDescription(buildDescription(cfg));

  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);
  if (cfg.bannerUrl) embed.setImage(cfg.bannerUrl);

  if (cfg.rulesText && cfg.rulesText.trim()) {
    embed.addFields({ name: "📌 À lire avant d'ouvrir un ticket", value: cfg.rulesText.slice(0, 1024) });
  }

  const topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const optionsText = topics
    .filter((t) => t.description)
    .map((t) => `${t.emoji || "•"} **${t.label}** → ${t.description}`)
    .join("\n");
  if (optionsText) {
    embed.addFields({ name: "🎫 Options de ticket", value: optionsText.slice(0, 1024) });
  }

  let row;
  if (topics.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("tckopen_select")
      .setPlaceholder((cfg.selectPlaceholder || "Ouvrir un ticket").slice(0, 150))
      .addOptions(
        topics.slice(0, 25).map((t) => {
          const opt = { label: String(t.label || "Ticket").slice(0, 100), value: t.id };
          if (t.description) opt.description = String(t.description).slice(0, 100);
          const em = resolveEmoji(t.emoji);
          if (em) opt.emoji = em;
          return opt;
        }),
      );
    row = new ActionRowBuilder().addComponents(select);
  } else {
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tckopen_btn").setLabel("Ouvrir un ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
    );
  }

  return { embeds: [embed], components: [row] };
}
