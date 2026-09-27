/**
 * Sources de données TikTok (lecture seule, sans dépendance, sans clé).
 *
 * 1. "embed" (source principale) : la page officielle d'intégration d'un profil créateur,
 *    https://www.tiktok.com/embed/@<compte>. C'est ce que charge n'importe quel site qui
 *    affiche un profil TikTok : page publique, stable, peu protégée, et qui contient en JSON
 *    les ~10 dernières vidéos publiques (+ les épinglées), avec légende complète et miniature.
 *    Une seule requête, résultat quasi temps réel.
 *
 * 2. "rss" (secours, optionnel) : un flux RSS/Atom généré ailleurs (dépôt GitHub tiktok-rss,
 *    rss.app...). Plus lent (le générateur tourne à intervalle), mais indépendant de l'embed.
 *
 * Tout est normalisé vers le même format d'item :
 *   { id, videoId, url, title, image, date, ts, uploadTs, source }
 * où `videoId` est le numéro TikTok de la vidéo (identifiant stable, sert au dédoublonnage)
 * et `uploadTs` l'heure de mise en ligne déduite de cet ID (voir videoIdTime).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Erreur de lecture d'une source.
 * - status : code HTTP éventuel (403/429 = TikTok limite, on espace les requêtes).
 * - fatal  : problème de configuration probable (compte inexistant, privé...) plutôt
 *            qu'une panne passagère : on réessaie beaucoup moins souvent.
 */
export class SourceError extends Error {
  constructor(message, { status = 0, fatal = false } = {}) {
    super(message);
    this.name = "SourceError";
    this.status = status;
    this.fatal = fatal;
  }
}

// ---------- Identifiants ----------

/**
 * Normalise un compte TikTok : accepte "kaya", "@kaya", "https://www.tiktok.com/@kaya"
 * ou un lien de vidéo. Renvoie le pseudo en minuscules, ou "" s'il est invalide
 * (règles TikTok : 2 à 24 caractères, lettres, chiffres, "_" et ".").
 */
export function normalizeHandle(input) {
  let s = String(input || "").trim();
  const m = s.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, "").trim().toLowerCase();
  return /^[a-z0-9._]{2,24}$/.test(s) ? s : "";
}

const MIN_VIDEO_TS = Date.UTC(2016, 0, 1);

/**
 * Heure de mise en ligne (ms) encodée dans l'ID d'une vidéo TikTok : les 32 bits de poids
 * fort de l'ID sont un timestamp Unix en secondes. Renvoie 0 si l'ID n'en est pas un.
 * ⚠️ C'est l'heure d'UPLOAD : pour une vidéo programmée, la publication arrive plus tard.
 */
export function videoIdTime(id, now = Date.now()) {
  const s = String(id || "");
  if (!/^\d{15,20}$/.test(s)) return 0;
  const ms = Number(BigInt(s) >> 32n) * 1000;
  return ms >= MIN_VIDEO_TS && ms <= now + 24 * 3600 * 1000 ? ms : 0;
}

// ID STABLE d'une vidéo : le numéro TikTok extrait de l'URL (/video/123...), qui ne change
// jamais. On dédoublonne là-dessus, et PAS sur le guid d'un flux RSS : certains générateurs
// régénèrent le guid/lien de la MÊME vidéo. Repli : URL sans paramètres, puis id brut.
export function stableVideoId(item) {
  const m = String(item?.url || "").match(/\/video\/(\d+)/);
  if (m) return m[1];
  const base = String(item?.url || "").split(/[?#]/)[0];
  return base || item?.id || "";
}

/** Tri du plus récent au plus ancien : par ID TikTok (ordre d'upload), sinon par date. */
export function byNewest(a, b) {
  const x = String(a.videoId || "");
  const y = String(b.videoId || "");
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    const bx = BigInt(x);
    const by = BigInt(y);
    return bx === by ? 0 : bx > by ? -1 : 1;
  }
  return (b.ts || b.uploadTs || 0) - (a.ts || a.uploadTs || 0);
}

/** Compte TikTok déduit des liens des vidéos (tiktok.com/@compte/video/...). */
export function handleFromItems(items) {
  for (const it of items || []) {
    const m = String(it?.url || "").match(/tiktok\.com\/@([^/?#\s]+)\/video\//i);
    const h = m ? normalizeHandle(m[1]) : "";
    if (h) return h;
  }
  return "";
}

/** Compte déduit d'une URL de flux du générateur GitHub (…/rss/<compte>.xml). */
export function handleFromFeedUrl(url) {
  const m = String(url || "").match(/\/rss\/([^/?#]+)\.xml(?:[?#]|$)/i);
  return m ? normalizeHandle(decodeURIComponent(m[1])) : "";
}

// ---------- HTTP ----------

async function fetchText(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8", "Cache-Control": "no-cache", ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return { status: res.status, ok: res.ok, body: await res.text() };
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new SourceError(`délai dépassé (${FETCH_TIMEOUT_MS / 1000} s)`);
    }
    throw new SourceError(`réseau : ${err?.cause?.code || err?.message || err}`);
  }
}

// ---------- Source 1 : embed officiel du profil créateur ----------

function findDeep(node, pred, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return null;
  if (pred(node)) return node;
  for (const v of Object.values(node)) {
    const hit = findDeep(v, pred, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Parse pur de la page https://www.tiktok.com/embed/@compte -> { profile, items }.
 * Lève une SourceError explicite si la page ne contient pas de données exploitables.
 * Extrait de fetchEmbedItems pour être testable sans réseau.
 */
export function parseEmbedHtml(html, handle = "") {
  const m = String(html || "").match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new SourceError("page embed sans données (accès bloqué ou format TikTok changé)");
  let state;
  try {
    state = JSON.parse(m[1]);
  } catch {
    throw new SourceError("données de la page embed illisibles (JSON invalide)");
  }

  // Les données de la page sont sous state.source.data["/embed/@compte"]. On tolère une
  // casse ou un "/" final différents, puis on se rabat sur toute entrée qui a un videoList.
  const want = `/embed/@${normalizeHandle(handle)}`;
  const entries = Object.entries(state?.source?.data || {});
  const page =
    entries.find(([k]) => k.toLowerCase().replace(/\/+$/, "") === want)?.[1] ||
    entries.find(([k, v]) => k.startsWith("/embed/") && v && typeof v === "object")?.[1] ||
    findDeep(state, (v) => Array.isArray(v.videoList));
  if (!page) throw new SourceError("aucune liste de vidéos dans la page embed (format TikTok changé ?)");

  if (page.isError || page.errorCode) {
    throw new SourceError(
      `TikTok refuse l'embed de ce compte (code ${page.errorCode || page.errorStatus || "?"}) : compte inexistant, privé ou banni ?`,
      { fatal: true },
    );
  }
  const user = page.userInfo || {};
  if (user.privateAccount) throw new SourceError("ce compte TikTok est privé", { fatal: true });

  const owner = normalizeHandle(user.uniqueId) || normalizeHandle(handle);
  const list = Array.isArray(page.videoList) ? page.videoList : [];
  const items = [];
  for (const v of list) {
    const id = String(v?.id || v?.itemId || "");
    if (!/^\d{15,20}$/.test(id) || v.privateItem) continue;
    const author = normalizeHandle(v.authorUniqueId) || owner;
    if (owner && author !== owner) continue; // ne garde que les vidéos du compte suivi
    items.push({
      id,
      videoId: id,
      url: `https://www.tiktok.com/@${author}/video/${id}`,
      title: String(v.desc || "").trim(),
      // originCover = miniature 9:16 en JPEG ; cover = 3:4 avec bandes (repli).
      image: v.originCoverUrl || v.coverUrl || v.dynamicCoverUrl || "",
      date: "", // l'embed ne donne pas l'heure de publication
      ts: 0,
      uploadTs: videoIdTime(id),
      source: "embed",
    });
  }
  items.sort(byNewest);

  return {
    profile: {
      handle: owner,
      nickname: String(user.nickname || "").trim(),
      avatarUrl: user.avatarThumbUrl || "",
    },
    items,
  };
}

/** Lit les dernières vidéos d'un compte via l'embed officiel. */
export async function fetchEmbedItems(account) {
  const handle = normalizeHandle(account);
  if (!handle) throw new SourceError("compte TikTok invalide", { fatal: true });
  const { status, body } = await fetchText(`https://www.tiktok.com/embed/@${handle}`, {
    Accept: "text/html,application/xhtml+xml",
  });
  if (status === 403 || status === 429) {
    throw new SourceError(`HTTP ${status} (TikTok limite ou bloque les requêtes de ce serveur)`, { status });
  }
  if (status >= 500) throw new SourceError(`HTTP ${status} (TikTok indisponible)`, { status });
  try {
    // Un compte inexistant renvoie HTTP 400 AVEC une page contenant le code d'erreur :
    // on la parse quand même pour remonter un message clair.
    return parseEmbedHtml(body, handle);
  } catch (err) {
    if (status !== 200 && err instanceof SourceError && !err.fatal) {
      throw new SourceError(`HTTP ${status} : ${err.message}`, { status });
    }
    throw err;
  }
}

// ---------- Source 2 : flux RSS / Atom ----------

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

/**
 * Parse pur du XML d'un flux RSS/Atom -> tableau d'items, trié du plus récent au plus ancien.
 * `id` = guid brut du flux ; `videoId` = ID stable de la vidéo (celui qui sert au dédoublonnage).
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
    const item = {
      id: guid || link || title,
      title,
      url: link,
      image: imgMatch ? imgMatch[1] : "",
      date,
      ts: date ? Date.parse(date) || 0 : 0,
      source: "rss",
    };
    item.videoId = stableVideoId(item);
    item.uploadTs = videoIdTime(item.videoId);
    return item;
  });
  return items.filter((i) => i.id && i.url).sort(byNewest);
}

/** Lit un flux RSS/Atom. */
export async function fetchFeedItems(feedUrl) {
  if (!feedUrl) throw new SourceError("Aucune URL de flux définie.", { fatal: true });
  const { status, ok, body } = await fetchText(feedUrl, {
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  });
  if (!ok) throw new SourceError(`HTTP ${status} (flux inaccessible)`, { status });
  return parseFeedXml(body);
}
