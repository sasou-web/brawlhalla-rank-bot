import { ComponentType, TextInputStyle } from "discord.js";

/**
 * Preuves envoyées par upload dans un modal (composant File Upload, type 19, dans un
 * Label, type 18) : liaison de compte, ouverture de ticket, litige de tournoi (et plus tard
 * le ladder). Socle commun : construction du modal en JSON brut, lecture des fichiers,
 * validation, téléchargement pour re-post.
 *
 * Deux contraintes Discord dictent la forme :
 * - `FileUploadBuilder.setFileTypes` n'existe pas dans @discordjs/builders 1.14 : le filtre
 *   `file_types` passe donc en JSON brut. Côté API, il n'accepte que des catégories
 *   (`image`, `video`…) ou des extensions précédées d'un point (`.png`), 10 au plus, et ne
 *   regarde que l'extension : la validation serveur (`validateProofFiles`) reste obligatoire.
 * - Les URL d'attachement sont signées et expirent (~24 h) : on retélécharge et on re-poste
 *   le fichier dans le message de revue, on ne stocke jamais l'URL seule.
 */

export const PROOF_UPLOAD_ID = "files";
export const PROOF_COMMENT_ID = "comment";
// Plafond par fichier, quelle que soit la limite du salon (le bot re-poste le fichier).
export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
// Plafond de l'ensemble re-posté dans un seul message (limite d'upload d'un bot sans boost).
export const PROOF_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const VIDEO_EXT = [".mp4", ".mov"];
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);
// Le re-post ne télécharge que depuis le CDN Discord (défense en profondeur).
const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/** Extensions proposées au sélecteur de fichiers du client Discord. */
export function proofFileTypes({ allowVideo = false } = {}) {
  return allowVideo ? [...IMAGE_EXT, ...VIDEO_EXT] : [...IMAGE_EXT];
}

function extOf(name) {
  const m = /\.[a-z0-9]+$/i.exec(String(name || ""));
  return m ? m[0].toLowerCase() : "";
}

function baseMime(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase();
}

/**
 * Valide les fichiers reçus (fonction pure). `files` : itérable d'objets
 * `{ name, size, contentType }` (Attachment discord.js). Type accepté si le MIME OU, à défaut
 * de MIME, l'extension est une image (png/jpg/webp), ou une vidéo mp4/mov si `allowVideo`.
 * Renvoie `{ ok: true, files }` ou `{ ok: false, error }` (message prêt à afficher).
 */
export function validateProofFiles(
  files,
  { maxBytes = PROOF_MAX_BYTES, maxFiles = 3, allowVideo = false, maxTotalBytes = PROOF_MAX_TOTAL_BYTES, required = false } = {},
) {
  const list = files ? [...(typeof files.values === "function" ? files.values() : files)] : [];
  if (list.length === 0) {
    return required ? { ok: false, error: "Ajoute au moins une capture." } : { ok: true, files: [] };
  }
  if (list.length > maxFiles) {
    return { ok: false, error: `${list.length} fichiers envoyés : ${maxFiles} au maximum.` };
  }
  let total = 0;
  for (const f of list) {
    const name = f?.name || "fichier";
    const mime = baseMime(f?.contentType);
    const ext = extOf(name);
    const isImage = mime ? IMAGE_MIME.has(mime) : IMAGE_EXT.includes(ext);
    const isVideo = mime ? VIDEO_MIME.has(mime) : VIDEO_EXT.includes(ext);
    if (!isImage && !(allowVideo && isVideo)) {
      const accepted = allowVideo ? "PNG, JPG, WebP, MP4 ou MOV" : "PNG, JPG ou WebP";
      return { ok: false, error: `« ${name} » n'est pas accepté : envoie une image ${accepted}.` };
    }
    const size = Number(f?.size) || 0;
    if (size > maxBytes) {
      return { ok: false, error: `« ${name} » est trop lourd (${formatBytes(size)}, max ${formatBytes(maxBytes)}).` };
    }
    total += size;
  }
  if (total > maxTotalBytes) {
    return { ok: false, error: `Fichiers trop lourds au total (${formatBytes(total)}, max ${formatBytes(maxTotalBytes)}).` };
  }
  return { ok: true, files: list };
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

/** Taille max par fichier pour cette interaction : la limite du salon, plafonnée à 8 Mio. */
export function proofMaxBytes(interaction) {
  const limit = Number(interaction?.attachmentSizeLimit);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, PROOF_MAX_BYTES) : PROOF_MAX_BYTES;
}

/** Label (type 18) contenant le composant d'upload (type 19), en JSON brut pour `file_types`. */
export function uploadLabel({ label, description, customId = PROOF_UPLOAD_ID, min = 1, max = 3, required = true, allowVideo = false }) {
  const component = {
    type: ComponentType.FileUpload,
    custom_id: customId,
    min_values: min,
    max_values: max,
    required,
    file_types: proofFileTypes({ allowVideo }),
  };
  return { type: ComponentType.Label, label: String(label).slice(0, 45), ...(description ? { description: String(description).slice(0, 100) } : {}), component };
}

/** Label (type 18) contenant un champ texte (type 4). */
export function textLabel({ label, description, customId, paragraph = false, required = false, maxLength, minLength, placeholder, value }) {
  const component = { type: ComponentType.TextInput, custom_id: customId, style: paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short, required };
  if (maxLength) component.max_length = maxLength;
  if (minLength) component.min_length = minLength;
  if (placeholder) component.placeholder = String(placeholder).slice(0, 100);
  if (value) component.value = value;
  return { type: ComponentType.Label, label: String(label).slice(0, 45), ...(description ? { description: String(description).slice(0, 100) } : {}), component };
}

/** Modal complet en JSON brut (à passer à `interaction.showModal`). */
export function uploadModal({ customId, title, components }) {
  return { custom_id: customId, title: String(title).slice(0, 45), components };
}

// Retire `file_types` d'un modal (repli si l'API refuse le filtre).
function withoutFileTypes(modal) {
  return {
    ...modal,
    components: modal.components.map((c) =>
      c.component?.type === ComponentType.FileUpload ? { ...c, component: { ...c.component, file_types: undefined } } : c,
    ),
  };
}

/**
 * Ouvre le modal. Si Discord refuse le corps (400 « Invalid Form Body », filtre `file_types`
 * non reconnu par exemple), réessaie une fois sans filtre : l'interaction n'a pas été
 * acquittée par l'échec, et la validation serveur filtre de toute façon.
 */
export async function showUploadModal(interaction, modal) {
  try {
    return await interaction.showModal(modal);
  } catch (err) {
    if (err?.code !== 50035) throw err;
    console.warn("Modal d'upload refusé, nouvel essai sans file_types :", err.message);
    return interaction.showModal(withoutFileTypes(modal));
  }
}

/** Fichiers envoyés dans le modal (tableau, vide si aucun ou si le champ est absent). */
export function readUploadedFiles(interaction, customId = PROOF_UPLOAD_ID) {
  try {
    const col = interaction.fields?.getUploadedFiles?.(customId);
    return col ? [...col.values()] : [];
  } catch {
    return [];
  }
}

/** Valeur d'un champ texte du modal, ou "" s'il est absent. */
export function readTextField(interaction, customId) {
  try {
    return interaction.fields?.getTextInputValue?.(customId)?.trim() || "";
  } catch {
    return "";
  }
}

/** Nom de fichier sûr pour `attachment://` (ASCII, sans espace, extension conservée). */
export function safeFileName(name, index = 0) {
  const ext = extOf(name);
  const stem = String(name || "")
    .slice(0, String(name || "").length - ext.length)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${index + 1}_${stem || "preuve"}${ext || ".png"}`;
}

export function isImageFile(name) {
  return IMAGE_EXT.includes(extOf(name));
}

/**
 * Télécharge les fichiers (déjà validés) pour les re-poster. Renvoie
 * `[{ attachment: Buffer, name }]` ; lève une erreur lisible si un fichier échoue
 * (hôte inattendu, HTTP, délai, taille réelle supérieure à `maxBytes`).
 */
export async function downloadProofFiles(files, { maxBytes = PROOF_MAX_BYTES, fetchImpl = fetch } = {}) {
  const out = [];
  for (const [i, f] of files.entries()) {
    let url;
    try {
      url = new URL(f.url);
    } catch {
      throw new Error(`lien de « ${f.name} » invalide`);
    }
    if (url.protocol !== "https:" || !DISCORD_CDN_HOSTS.has(url.hostname)) {
      throw new Error(`« ${f.name} » ne vient pas de Discord`);
    }
    const res = await fetchImpl(url.href, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`téléchargement de « ${f.name} » refusé (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`« ${f.name} » dépasse ${formatBytes(maxBytes)}`);
    out.push({ attachment: buf, name: safeFileName(f.name, i) });
  }
  return out;
}

/**
 * Lit, valide et télécharge les fichiers d'un modal en une fois. Renvoie
 * `{ ok: true, files: [{ attachment, name }] }` ou `{ ok: false, error }`.
 */
export async function collectProofFiles(interaction, opts = {}) {
  const raw = readUploadedFiles(interaction, opts.customId);
  const maxBytes = opts.maxBytes ?? proofMaxBytes(interaction);
  const v = validateProofFiles(raw, { ...opts, maxBytes });
  if (!v.ok) return v;
  if (v.files.length === 0) return { ok: true, files: [] };
  try {
    return { ok: true, files: await downloadProofFiles(v.files, { maxBytes, fetchImpl: opts.fetchImpl }) };
  } catch (err) {
    return { ok: false, error: `Impossible de récupérer ta capture : ${err.message}.` };
  }
}

/**
 * Envoie `payload` avec les fichiers re-postés. Si l'envoi avec fichiers échoue (trop lourd,
 * permission « Joindre des fichiers » absente), renvoie sans fichiers : embeds sans image ni
 * champ « Preuve », contenu remplacé par `fallbackContent` (par défaut le contenu d'origine
 * suivi d'un avertissement). Messages classiques uniquement (pas Components V2).
 * Renvoie { message, filesPosted }.
 */
export async function sendWithFilesFallback(channel, payload, files, { fallbackContent } = {}) {
  if (!files?.length) return { message: await channel.send(payload), filesPosted: false };
  try {
    return { message: await channel.send({ ...payload, files }), filesPosted: true };
  } catch (err) {
    console.warn("Preuve : envoi avec fichiers refusé, nouvel essai sans :", err.message);
    const embeds = (payload.embeds || []).map((e) => {
      const json = typeof e?.toJSON === "function" ? e.toJSON() : e;
      const { image: _image, ...rest } = json;
      return { ...rest, fields: (json.fields || []).filter((f) => f.name !== "Preuve") };
    });
    const note = "⚠️ La capture n'a pas pu être jointe.";
    const content = fallbackContent ?? (payload.content ? `${payload.content}\n${note}` : note);
    return { message: await channel.send({ ...payload, content, embeds }), filesPosted: false };
  }
}

/**
 * Modal de litige réutilisable (tournoi, ladder) : raison obligatoire + capture facultative
 * (images, ou vidéo MP4/MOV, 3 fichiers au plus).
 */
export function buildDisputeModal(customId) {
  return uploadModal({
    customId,
    title: "Signaler un litige",
    components: [
      textLabel({
        label: "Que s'est-il passé ?",
        customId: "reason",
        paragraph: true,
        required: true,
        minLength: 5,
        maxLength: 500,
        placeholder: "Ex : score déclaré faux, l'adversaire ne répond plus…",
      }),
      uploadLabel({
        label: "Capture du score (facultatif)",
        description: "Image ou courte vidéo, 3 fichiers max.",
        min: 0,
        max: 3,
        required: false,
        allowVideo: true,
      }),
    ],
  });
}
