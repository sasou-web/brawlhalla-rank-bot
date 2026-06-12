import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { loadDoc, saveDoc } from "./db.js";

/**
 * Notifications TikTok via un FLUX RSS.
 *
 * Pourquoi un flux RSS et pas du scraping direct : TikTok et les API gratuites
 * (tikwm, rsshub public) sont derriere des protections anti-bot (Cloudflare 403).
 * On lit donc un flux RSS genere par un service tiers (ex: RSS.app) a partir du
 * profil TikTok. Le bot ne fait que lire ce flux : fiable et sans cle.
 *
 * Structure : { guilds: { [guildId]: {
 *   enabled, feedUrl, username (affichage), channelId, roleId, pollIntervalMin, lastItemId
 * } } }
 */
const DEFAULT_CONFIG = {
  enabled: false,
  feedUrl: "", // URL du flux RSS (ex: https://rss.app/feeds/xxxx.xml)
  username: "", // pseudo affiche dans le message (optionnel)
  avatarUrl: "", // URL de la photo de profil TikTok (optionnel, affichee a cote du pseudo)
  message: "", // phrase d'annonce personnalisable ({pseudo} = nom affiche). Vide = phrase par defaut.
  showDate: true, // affiche la date/heure de la video en footer de l'embed ("TikTok • date")
  channelId: "",
  roleId: "", // role a ping (vide = pas de ping)
  pollIntervalMin: 10,
  lastItemId: "", // dernier item deja poste
};

// Phrase d'annonce par defaut. {pseudo} est remplace par le nom affiche, {url} par le lien.
export const DEFAULT_TIKTOK_MESSAGE =
  "Nouvelle vidéo de {pseudo} va la voir tout de suite ! <:Emoji_Wow_Metadev:1513693924814880879>";

const KEY = "tiktok";
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
  c.guilds[guildId] = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  return c.guilds[guildId];
}

export async function getTikTokConfig(guildId) {
  return { ...(await getGuild(guildId)) };
}

export async function setTikTokConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch);
  await save();
  return { ...g };
}

// ---------- Lecture d'un flux RSS / Atom (sans dependance) ----------

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

// Lien : RSS <link>url</link> ou Atom <link href="url"/>.
function extractLink(block) {
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decodeEntities(rss[1]);
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>(?:<\/link>)?/i);
  return atom ? decodeEntities(atom[1]) : "";
}

export async function fetchFeedItems(feedUrl) {
  if (!feedUrl) throw new Error("Aucune URL de flux définie.");
  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DiscordBot; tiktok-rss)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (flux inaccessible)`);
  const xml = await res.text();
  return parseFeedXml(xml);
}

/**
 * Parse pur du XML d'un flux RSS/Atom -> tableau d'items
 * { id, title, url, image, date, ts }, trié du plus récent au plus ancien.
 * Extrait de fetchFeedItems pour être testable sans réseau.
 */
export function parseFeedXml(xml) {
  // Decoupe en <item> (RSS) ou <entry> (Atom).
  const blocks = String(xml || "").match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
  const items = blocks.map((b) => {
    const link = extractLink(b);
    const guid = tag(b, "guid") || tag(b, "id") || link;
    const title = tag(b, "title");
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated");
    const description = tag(b, "description") || tag(b, "content") || tag(b, "summary");
    const imgMatch = description.match(/<img[^>]+src="([^"]+)"/i);
    return {
      id: guid || link || title,
      title,
      url: link,
      image: imgMatch ? imgMatch[1] : "",
      date,
      ts: date ? Date.parse(date) || 0 : 0,
    };
  });
  // Trie du plus recent au plus ancien (pour que [0] soit la derniere video).
  return items.filter((i) => i.id && i.url).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// ---------- Message poste dans le salon ----------

// Normalise vers une URL TikTok canonique (clic = ouvre la vraie page TikTok).
function canonicalUrl(url) {
  return String(url || "").replace(/^https?:\/\/(?:www\.|vm\.|m\.)?tiktok\.com/i, "https://www.tiktok.com");
}

// Recadre une image en 9:16 (format TikTok) via le CDN gratuit wsrv.nl,
// ce qui supprime les barres noires laterales des miniatures.
function cropImage(url) {
  if (!url) return "";
  return "https://wsrv.nl/?url=" + encodeURIComponent(url) + "&w=720&h=1280&fit=cover&a=center&output=jpg";
}

// Construit le payload : ligne d'annonce (+ping) + embed reduit a la seule miniature + bouton lien.
export function buildMessagePayload(cfg, item, { test = false } = {}) {
  const ping = cfg.roleId ? `<@&${cfg.roleId}>` : "";
  const handle = cfg.username ? cfg.username.replace(/^@+/, "") : "";
  // Nom affiche dans le message (ex: "KayaGF"). Repli sur le handle puis un texte neutre.
  const who = handle || "le compte suivi";
  const videoUrl = canonicalUrl(item.url);

  // Phrase d'annonce : modele configurable ({pseudo} / {url}), sinon phrase par defaut.
  const template = cfg.message && cfg.message.trim() ? cfg.message : DEFAULT_TIKTOK_MESSAGE;
  const intro = template.replace(/\{pseudo\}/gi, who).replace(/\{url\}/gi, videoUrl).trim();

  // Infos de la video : on separe la legende des hashtags pour un rendu propre dans le message.
  // (On les met dans le message et non dans l'embed : un embed avec du texte deviendrait
  //  plus large que la miniature verticale et laisserait un grand vide a droite.)
  const caption = String(item.title || "").replace(/\s+/g, " ").trim();
  const tags = (caption.match(/#[^\s#]+/g) || []).join(" ");
  let captionText = caption.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (captionText.length > 280) captionText = captionText.slice(0, 277).trimEnd() + "…";

  const firstLine = test ? `${ping} 🧪 **Test** — ${intro}`.trim() : `${ping} ${intro}`.trim();

  // Carte TikTok en Components V2 : annonce (ping) au-dessus, puis cadre rose avec
  // la légende, la miniature 9:16, un pied "TikTok • date" et le bouton "Voir sur TikTok".
  const container = new ContainerBuilder().setAccentColor(0xfe2c55);

  if (captionText) {
    const safe = captionText.replace(/[[\]]/g, ""); // évite de casser le lien markdown
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> [${safe}](${videoUrl})`));
  }
  if (item.image) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(cropImage(item.image))),
    );
  }

  // Pied : "📱 TikTok • <date>" + hashtags, en sous-texte.
  const footParts = ["📱 **TikTok**"];
  if (cfg.showDate !== false && item.date) {
    const d = new Date(item.date);
    if (!Number.isNaN(d.getTime())) footParts.push(`<t:${Math.floor(d.getTime() / 1000)}:f>`);
  }
  let footer = `-# ${footParts.join(" • ")}`;
  if (tags) footer += `\n-# ${tags}`;
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Voir sur TikTok").setEmoji("▶️").setURL(videoUrl),
    ),
  );

  return {
    components: [new TextDisplayBuilder().setContent(firstLine), container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] },
  };
}

// ---------- Poll : detecte et poste les nouveaux items ----------

// ID STABLE d'une vidéo : le numéro TikTok extrait de l'URL (/video/123...), qui ne change
// jamais. On dédoublonne là-dessus, et PAS sur le guid du flux RSS : RSS.app régénère parfois
// le guid/lien de la MÊME vidéo, ce qui faisait reposter un doublon. Repli : URL sans
// paramètres, puis id brut.
export function stableVideoId(item) {
  const m = String(item?.url || "").match(/\/video\/(\d+)/);
  if (m) return m[1];
  const base = String(item?.url || "").split(/[?#]/)[0];
  return base || item?.id || "";
}

export async function pollGuild(client, guildId) {
  const cfg = await getGuild(guildId);
  if (!cfg.enabled || !cfg.feedUrl || !cfg.channelId) return { posted: 0 };

  let items;
  try {
    items = await fetchFeedItems(cfg.feedUrl);
  } catch {
    return { posted: 0 }; // best-effort
  }
  if (!items.length) return { posted: 0 };

  // Premier passage : memorise le plus recent sans spammer l'historique.
  if (!cfg.lastItemId) {
    await setTikTokConfig(guildId, { lastItemId: stableVideoId(items[0]) });
    return { posted: 0 };
  }

  // Le dernier posté est reconnu via son ID stable, mais aussi via l'id brut / l'URL pour
  // tolérer les anciennes valeurs stockées (migration) sans tout reposter.
  const lastId = cfg.lastItemId;
  const isLast = (it) => stableVideoId(it) === lastId || it.id === lastId || it.url === lastId;

  let matched = false;
  const newOnes = [];
  for (const it of items) {
    if (isLast(it)) { matched = true; break; }
    newOnes.push(it);
  }

  // Dernier posté introuvable dans le flux (guid régénéré, flux purgé...) : on NE reposte PAS
  // tout l'historique. On resynchronise simplement sur la vidéo la plus récente, sans rien poster.
  if (!matched) {
    await setTikTokConfig(guildId, { lastItemId: stableVideoId(items[0]) });
    return { posted: 0 };
  }
  if (!newOnes.length) return { posted: 0 };

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { posted: 0 };

  let posted = 0;
  for (const it of newOnes.reverse()) {
    try {
      await channel.send(buildMessagePayload(cfg, it));
      posted++;
    } catch {
      break;
    }
  }
  await setTikTokConfig(guildId, { lastItemId: stableVideoId(items[0]) });
  return { posted };
}

// Poste la derniere publication (bouton Test). Ne touche pas a lastItemId.
export async function postTest(client, guildId) {
  const cfg = await getGuild(guildId);
  if (!cfg.feedUrl) return { ok: false, reason: "Aucune URL de flux définie." };
  if (!cfg.channelId) return { ok: false, reason: "Aucun salon défini." };

  let items;
  try {
    items = await fetchFeedItems(cfg.feedUrl);
  } catch (err) {
    return { ok: false, reason: `Lecture du flux échouée : ${err.message}` };
  }
  if (!items.length) return { ok: false, reason: "Le flux ne contient aucune publication." };

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, reason: "Salon introuvable ou non textuel." };

  try {
    await channel.send(buildMessagePayload(cfg, items[0], { test: true }));
  } catch (err) {
    return { ok: false, reason: `Envoi impossible (permissions du salon ?) : ${err.message}` };
  }
  return { ok: true, item: items[0] };
}
