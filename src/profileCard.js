import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { TIER_COLORS } from "./config.js";

/**
 * Rendu d'une "carte profil" Brawlhalla en image PNG (Buffer), facon carte de rank.
 * Aucune dependance systeme : @napi-rs/canvas embarque skia. On tente toutefois de
 * charger une police systeme courante (Linux) pour un rendu net ; sinon repli generique.
 */

// Enregistre une police systeme si disponible (sinon skia utilise un repli).
let FONT = "sans-serif";
let FONT_BOLD = "sans-serif";
const FONT_TRIES = [
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "CardBold", true],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Card", false],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "CardBold", true],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "Card", false],
  ["C:\\Windows\\Fonts\\arialbd.ttf", "CardBold", true],
  ["C:\\Windows\\Fonts\\arial.ttf", "Card", false],
];
for (const [path, name, bold] of FONT_TRIES) {
  try {
    if (GlobalFonts.registerFromPath(path, name)) {
      if (bold) FONT_BOLD = name;
      else FONT = name;
    }
  } catch {
    /* police absente : on continue */
  }
}

const hex = (n) => "#" + (n ?? 0x99aab5).toString(16).padStart(6, "0");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function winrate(games, wins) {
  if (!games || games <= 0) return null;
  return Math.round((wins / games) * 1000) / 10;
}

/**
 * @param profile profil renvoye par getPlayerProfile
 * @param opts { avatarBuffer?: Buffer, displayName?: string, mainLegend?: string, glory?: number|null }
 * @returns Buffer PNG
 */
export async function renderProfileCard(profile, opts = {}) {
  const W = 900;
  const H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const tier1 = profile.tiers?.["1v1"] ?? null;
  const accent = TIER_COLORS[tier1] ?? 0x4ea1ff;

  // Fond degrade sombre teinte par le tier.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#15171c");
  g.addColorStop(1, "#0c0d10");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Bande d'accent a gauche.
  ctx.fillStyle = hex(accent);
  ctx.fillRect(0, 0, 10, H);

  // Avatar (cercle) si fourni.
  let textX = 40;
  if (opts.avatarBuffer) {
    try {
      const img = await loadImage(opts.avatarBuffer);
      const size = 150;
      const ax = 40;
      const ay = 45;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, ax, ay, size, size);
      ctx.restore();
      // Anneau colore.
      ctx.lineWidth = 5;
      ctx.strokeStyle = hex(accent);
      ctx.beginPath();
      ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
      ctx.stroke();
      textX = ax + size + 30;
    } catch {
      /* avatar illisible : on ignore */
    }
  }

  // Nom.
  const name = (opts.displayName || profile.name || "Joueur").slice(0, 22);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 44px ${FONT_BOLD}`;
  ctx.fillText(name, textX, 80);

  // Sous-ligne : region · niveau · rang mondial.
  const sub = [];
  if (profile.region && profile.region !== "?") sub.push(profile.region);
  sub.push(`Niveau ${profile.level || 0}`);
  if (profile.globalRank) sub.push(`Rang mondial #${profile.globalRank}`);
  ctx.fillStyle = "#9aa0aa";
  ctx.font = `22px ${FONT}`;
  ctx.fillText(sub.join("   •   "), textX, 115);

  // Main legende.
  if (opts.mainLegend) {
    ctx.fillStyle = hex(accent);
    ctx.font = `bold 22px ${FONT_BOLD}`;
    ctx.fillText(`🗡 Main : ${opts.mainLegend}`, textX, 150);
  }

  // Blocs de stats.
  const wr = winrate(profile.games1v1, profile.wins1v1);
  const blocks = [
    { label: "RANG 1v1", value: tier1 ?? "Non classé", sub: `${profile.ratings?.["1v1"] || 0}  (peak ${profile.peak1v1 || 0})` },
    { label: "RANG 2v2", value: profile.tiers?.["2v2"] ?? "Non classé", sub: `${profile.ratings?.["2v2"] || 0}` },
    { label: "WINRATE 1v1", value: wr != null ? `${wr}%` : "—", sub: `${profile.wins1v1 || 0}/${profile.games1v1 || 0}` },
    { label: "GLORY EST.", value: opts.glory != null ? String(opts.glory) : "—", sub: " " },
  ];

  const bx = 40;
  const by = 195;
  const bw = (W - bx * 2 - 30) / 4;
  const bh = 90;
  blocks.forEach((b, i) => {
    const x = bx + i * (bw + 10);
    ctx.fillStyle = "#1d2026";
    roundRect(ctx, x, by, bw, bh, 12);
    ctx.fill();

    ctx.fillStyle = "#8b919b";
    ctx.font = `15px ${FONT}`;
    ctx.fillText(b.label, x + 14, by + 26);

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 26px ${FONT_BOLD}`;
    ctx.fillText(String(b.value).slice(0, 14), x + 14, by + 56);

    ctx.fillStyle = "#9aa0aa";
    ctx.font = `15px ${FONT}`;
    ctx.fillText(String(b.sub).slice(0, 18), x + 14, by + 78);
  });

  return canvas.toBuffer("image/png");
}
