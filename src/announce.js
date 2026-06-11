// Annonces / messages personnalisés envoyés depuis le dashboard web.
// Construit un payload Discord (contenu texte + embed entièrement personnalisable)
// à partir d'une config fournie par l'admin, et gère les mentions (rôles / @everyone).

function hexToInt(hex) {
  const m = String(hex || "").match(/#?([0-9a-f]{6})/i);
  return m ? parseInt(m[1], 16) : 0x7c5cff;
}

// Variables disponibles au niveau serveur (pas de membre ciblé ici).
export function applyServerVars(str, guild) {
  if (!str) return str;
  return String(str)
    .replaceAll("{server}", guild?.name ?? "")
    .replaceAll("{membercount}", String(guild?.memberCount ?? ""))
    .replaceAll("{count}", String(guild?.memberCount ?? ""))
    .replaceAll("{date}", new Date().toLocaleDateString("fr-FR"))
    .replaceAll("{time}", new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
}

function clampStr(s, max) {
  return String(s ?? "").slice(0, max);
}

// Construit un objet embed brut (API Discord) à partir de la config, ou null si vide.
function buildEmbed(guild, e) {
  if (!e) return null;
  const embed = {};
  const v = (s) => applyServerVars(s, guild);

  if (e.title) embed.title = clampStr(v(e.title), 256);
  if (e.url) embed.url = String(e.url).trim();
  if (e.description) embed.description = clampStr(v(e.description), 4000);
  embed.color = hexToInt(e.color);

  if (e.author && e.author.name) {
    embed.author = { name: clampStr(v(e.author.name), 256) };
    if (e.author.iconUrl) embed.author.icon_url = String(e.author.iconUrl).trim();
    if (e.author.url) embed.author.url = String(e.author.url).trim();
  }

  if (e.thumbnail) embed.thumbnail = { url: String(e.thumbnail).trim() };
  if (e.image) embed.image = { url: String(e.image).trim() };

  if (Array.isArray(e.fields)) {
    const fields = e.fields
      .filter((f) => f && (f.name || f.value))
      .slice(0, 25)
      .map((f) => ({
        name: clampStr(v(f.name) || "\u200b", 256),
        value: clampStr(v(f.value) || "\u200b", 1024),
        inline: !!f.inline,
      }));
    if (fields.length) embed.fields = fields;
  }

  if (e.footer || e.footerIcon) {
    embed.footer = { text: clampStr(v(e.footer) || guild?.name || "", 2048) };
    if (e.footerIcon) {
      const ico = e.footerIcon === true ? guild?.iconURL?.() : String(e.footerIcon).trim();
      if (ico) embed.footer.icon_url = ico;
    }
  }

  if (e.timestamp) embed.timestamp = new Date().toISOString();

  // Embed considéré non vide s'il a au moins un contenu visible.
  const hasContent =
    embed.title || embed.description || embed.author || embed.image || embed.thumbnail || embed.fields;
  return hasContent ? embed : null;
}

/**
 * Construit le payload d'envoi (channel.send) pour une annonce personnalisée.
 * @returns {{ payload: object|null, error?: string }}
 */
export function buildAnnouncePayload(guild, cfg, { hasAttachment = false } = {}) {
  const mode = cfg.mode || "embed";
  const wantText = mode === "text" || mode === "both";
  const wantEmbed = mode === "embed" || mode === "both";

  // Mentions : @everyone et rôles sélectionnés.
  const roleIds = Array.isArray(cfg.mentionRoleIds) ? cfg.mentionRoleIds.filter(Boolean) : [];
  const mentionBits = [];
  if (cfg.mentionEveryone) mentionBits.push("@everyone");
  for (const id of roleIds) mentionBits.push(`<@&${id}>`);
  const mentionStr = mentionBits.join(" ");

  let content = wantText && cfg.content ? applyServerVars(cfg.content, guild) : "";

  // Placement du ping : variable {mentions} dans le texte = priorité (placement libre),
  // sinon au début ("top") ou à la fin ("end") du message.
  if (mentionStr && content.includes("{mentions}")) {
    content = content.replaceAll("{mentions}", mentionStr);
  } else {
    content = content.replaceAll("{mentions}", "");
    if (mentionStr) {
      const pos = cfg.mentionPosition || "top";
      content = pos === "end" ? `${content} ${mentionStr}`.trim() : `${mentionStr}\n${content}`.trim();
    }
  }
  content = content.trim();

  const embed = wantEmbed ? buildEmbed(guild, cfg.embed) : null;

  if (!content && !embed && !hasAttachment) {
    return { payload: null, error: "Message vide : ajoute du texte, un embed ou une image." };
  }

  const payload = {
    allowedMentions: {
      parse: cfg.mentionEveryone ? ["everyone"] : [],
      roles: roleIds,
    },
  };
  if (content) payload.content = clampStr(content, 2000);
  if (embed) payload.embeds = [embed];

  return { payload };
}

// Limite de taille des pièces jointes (8 Mo : sûr pour tous les serveurs).
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

// Nettoie un nom de fichier (Discord refuse certains caractères / chemins).
function sanitizeFileName(name) {
  const base = String(name || "image").split(/[\\/]/).pop().replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return base || "image.png";
}

/**
 * Convertit une data URL (data:<mime>;base64,xxxx) en pièce jointe pour channel.send.
 * @returns {{ file?: { attachment: Buffer, name: string }, error?: string }}
 */
export function dataUrlToAttachment(dataUrl, fileName) {
  const m = String(dataUrl || "").match(/^data:([\w/+.-]+)?;base64,(.+)$/s);
  if (!m) return { error: "Image invalide." };
  let buffer;
  try {
    buffer = Buffer.from(m[2], "base64");
  } catch {
    return { error: "Image illisible." };
  }
  if (!buffer.length) return { error: "Image vide." };
  if (buffer.length > MAX_ATTACHMENT_BYTES) return { error: "Image trop lourde (max 8 Mo)." };
  return { file: { attachment: buffer, name: sanitizeFileName(fileName) } };
}
