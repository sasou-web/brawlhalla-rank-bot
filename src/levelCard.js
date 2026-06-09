import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { SERVER_LEVEL_TIERS } from "./config.js";

/**
 * Carte de niveau (XP) facon MEE6/Arcane, en image PNG (Buffer).
 */

let FONT = "sans-serif";
let FONT_BOLD = "sans-serif";
const FONT_TRIES = [
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "LvlBold", true],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Lvl", false],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "LvlBold", true],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "Lvl", false],
  ["C:\\Windows\\Fonts\\arialbd.ttf", "LvlBold", true],
  ["C:\\Windows\\Fonts\\arial.ttf", "Lvl", false],
];
for (const [path, name, bold] of FONT_TRIES) {
  try {
    if (GlobalFonts.registerFromPath(path, name)) {
      if (bold) FONT_BOLD = name;
      else FONT = name;
    }
  } catch {
    /* police absente */
  }
}

const hex = (n) => "#" + (n ?? 0x5865f2).toString(16).padStart(6, "0");
const NF = new Intl.NumberFormat("fr-FR");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Couleur d'accent = palier de niveau atteint le plus haut (degrade Brawlhalla).
function accentForLevel(level) {
  const reached = [...SERVER_LEVEL_TIERS].reverse().find((t) => t.level <= level);
  return reached?.color ?? 0x5865f2;
}

/**
 * @param opts { displayName, avatarBuffer?, level, rank, totalMembers, xp, xpIntoLevel, xpForNext, messages }
 * @returns Buffer PNG
 */
export async function renderLevelCard(opts = {}) {
  const W = 900;
  const H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = accentForLevel(opts.level || 0);

  // Fond.
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "#15171c");
  g.addColorStop(1, "#0c0d10");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hex(accent);
  ctx.fillRect(0, 0, 10, H);

  // Avatar.
  let textX = 45;
  if (opts.avatarBuffer) {
    try {
      const img = await loadImage(opts.avatarBuffer);
      const size = 150;
      const ax = 45;
      const ay = 55;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, ax, ay, size, size);
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.strokeStyle = hex(accent);
      ctx.beginPath();
      ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
      ctx.stroke();
      textX = ax + size + 30;
    } catch {
      /* sans avatar */
    }
  }

  // Nom.
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 40px ${FONT_BOLD}`;
  ctx.fillText((opts.displayName || "Membre").slice(0, 22), textX, 80);

  // Niveau + rang (a droite du nom).
  ctx.textAlign = "right";
  ctx.fillStyle = hex(accent);
  ctx.font = `bold 40px ${FONT_BOLD}`;
  ctx.fillText(`NIVEAU ${opts.level || 0}`, W - 45, 70);
  if (opts.rank) {
    ctx.fillStyle = "#9aa0aa";
    ctx.font = `22px ${FONT}`;
    ctx.fillText(`Rang #${opts.rank}${opts.totalMembers ? ` / ${opts.totalMembers}` : ""}`, W - 45, 105);
  }
  ctx.textAlign = "left";

  // Barre d'XP.
  const into = Math.max(0, Math.floor(opts.xpIntoLevel || 0));
  const next = Math.max(1, Math.floor(opts.xpForNext || 1));
  const ratio = Math.max(0, Math.min(1, into / next));
  const barX = textX;
  const barY = 165;
  const barW = W - barX - 45;
  const barH = 34;

  ctx.fillStyle = "#23262e";
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  if (ratio > 0) {
    ctx.fillStyle = hex(accent);
    roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, barH / 2);
    ctx.fill();
  }

  // Texte XP au-dessus de la barre.
  ctx.fillStyle = "#c8ccd2";
  ctx.font = `20px ${FONT}`;
  ctx.fillText(`${NF.format(into)} / ${NF.format(next)} XP`, barX, barY - 12);

  ctx.textAlign = "right";
  ctx.fillStyle = "#9aa0aa";
  ctx.font = `18px ${FONT}`;
  const extra = [];
  if (typeof opts.xp === "number") extra.push(`Total ${NF.format(Math.floor(opts.xp))} XP`);
  if (typeof opts.messages === "number") extra.push(`${NF.format(opts.messages)} msg`);
  ctx.fillText(extra.join("  •  "), W - 45, barY - 12);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
