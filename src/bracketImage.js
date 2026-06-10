import { createCanvas } from "@napi-rs/canvas";
import { FONT, FONT_BOLD } from "./cardFont.js";

/**
 * Rendu visuel d'un bracket d'elimination simple en image PNG (Buffer).
 * Colonnes = rounds, de gauche (round 0) a droite (finale).
 */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ELLIP = (ctx, text, maxW) => {
  let s = String(text ?? "—");
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
};

/**
 * @param t tournoi (avec rounds, matches, participants)
 * @param opts { fromRound?: number } — ne dessine que les rounds >= fromRound (vue "top N")
 * @returns Buffer PNG
 */
export function renderBracketImage(t, opts = {}) {
  const rounds = t.rounds || 0;
  if (rounds < 1) throw new Error("Bracket non généré.");
  const size = Math.pow(2, rounds);
  let fromRound = Math.max(0, Math.min(Math.floor(opts.fromRound || 0), rounds - 1));
  // Plafond de hauteur : trop de matchs au 1er round affiché = canvas géant (ex. 64/128
  // joueurs). On avance automatiquement fromRound (vue "top N") pour borner l'image.
  const MAX_FIRST_ROUND_MATCHES = 32;
  let n0 = size / Math.pow(2, fromRound + 1); // matchs au premier round affiche
  while (n0 > MAX_FIRST_ROUND_MATCHES && fromRound < rounds - 1) {
    fromRound++;
    n0 = size / Math.pow(2, fromRound + 1);
  }
  const shownRounds = rounds - fromRound;

  const boxW = 200;
  const boxH = 40;
  const gapV = 12;
  const colW = 232;
  const mTop = 24;
  const mLeft = 16;

  // Centres verticaux par round (indexes en round ABSOLU, a partir de fromRound).
  const centers = [];
  centers[fromRound] = [];
  for (let i = 0; i < n0; i++) centers[fromRound][i] = mTop + i * (boxH + gapV) + boxH / 2;
  for (let r = fromRound + 1; r < rounds; r++) {
    centers[r] = [];
    const count = size / Math.pow(2, r + 1);
    for (let i = 0; i < count; i++) centers[r][i] = (centers[r - 1][2 * i] + centers[r - 1][2 * i + 1]) / 2;
  }

  const W = mLeft * 2 + shownRounds * colW;
  const H = mTop * 2 + n0 * (boxH + gapV);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Fond.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#14161b");
  g.addColorStop(1, "#0b0c0f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const nameOf = (id) => (id ? t.participants.find((p) => p.id === id)?.name ?? "?" : null);

  for (let r = fromRound; r < rounds; r++) {
    const count = size / Math.pow(2, r + 1);
    const x = mLeft + (r - fromRound) * colW;
    for (let i = 0; i < count; i++) {
      const m = t.matches[`r${r}m${i}`] || {};
      const cy = centers[r][i];
      const y = cy - boxH / 2;

      // Connecteurs vers le round suivant.
      if (r < rounds - 1) {
        const nextCy = centers[r + 1][Math.floor(i / 2)];
        ctx.strokeStyle = "#2a2e37";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + boxW, cy);
        ctx.lineTo(x + colW - 16, cy);
        ctx.lineTo(x + colW - 16, nextCy);
        ctx.stroke();
      }

      // Boite du match.
      ctx.fillStyle = m.locked ? "#241f2e" : "#1b1e25";
      roundRect(ctx, x, y, boxW, boxH, 8);
      ctx.fill();
      if (m.locked) {
        ctx.strokeStyle = "#9b59b6";
        ctx.lineWidth = 1.5;
        roundRect(ctx, x, y, boxW, boxH, 8);
        ctx.stroke();
      }

      const aName = nameOf(m.aId) ?? (m.round > fromRound || fromRound > 0 ? "À déterminer" : null);
      const bName = nameOf(m.bId) ?? (m.round > fromRound || fromRound > 0 ? "À déterminer" : null);
      const drawSlot = (name, score, sy, isWinner) => {
        ctx.font = isWinner ? `bold 15px ${FONT_BOLD}` : `14px ${FONT}`;
        ctx.fillStyle = name ? (isWinner ? "#ffffff" : "#aab0ba") : "#5a606b";
        ctx.fillText(ELLIP(ctx, name ?? "—", boxW - 40), x + 10, sy);
        if (typeof score === "number") {
          ctx.fillStyle = isWinner ? "#2ecc71" : "#7d828c";
          ctx.textAlign = "right";
          ctx.fillText(String(score), x + boxW - 8, sy);
          ctx.textAlign = "left";
        }
      };
      const done = m.status === "done";
      drawSlot(aName, done || m.scoreA || m.scoreB ? m.scoreA : undefined, y + 17, done && m.winnerId === m.aId);
      // separateur
      ctx.strokeStyle = "#2a2e37";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 6, y + boxH / 2);
      ctx.lineTo(x + boxW - 6, y + boxH / 2);
      ctx.stroke();
      drawSlot(bName, done || m.scoreA || m.scoreB ? m.scoreB : undefined, y + boxH - 8, done && m.winnerId === m.bId);
    }
  }

  return canvas.toBuffer("image/png");
}
