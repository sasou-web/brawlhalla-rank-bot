// Genere les icones du dashboard (favicon, apple-touch-icon, icones PWA) a partir
// du logo source assets/icon-source.webp.
//
//   npm run icons
//
// Les PNG produits sont versionnes : a relancer uniquement si tu remplaces le logo.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "assets", "icon-source.webp");
const OUT_DIR = resolve(ROOT, "src", "web", "public");

// Le logo comporte des zones transparentes (coins). On l'aplatit sur un fond opaque
// repris de l'image elle-meme, sinon l'icone apparait trouee dans les onglets et
// sur l'ecran d'accueil.
const BACKDROP = "#041b1a";

const logo = await loadImage(SOURCE);

/**
 * @param {number} size cote en pixels
 * @param {object} [opts]
 * @param {boolean} [opts.round] coins arrondis (onglets, favoris)
 * @param {number}  [opts.inset] marge autour du logo, en fraction du cote
 */
function draw(size, { round = false, inset = 0 } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.save();
  if (round) {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.22);
    ctx.clip();
  }
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, size, size);

  // Cadrage "cover" : le logo remplit le carre sans deformation.
  const box = size * (1 - inset * 2);
  const scale = box / Math.max(logo.width, logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  ctx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

const targets = [
  // Onglets et favoris : coins arrondis, comme l'icone d'origine.
  ["favicon-32.png", 32, { round: true }],
  ["favicon-192.png", 192, { round: true }],
  ["icon-192.png", 192, { round: true }],
  ["icon-512.png", 512, { round: true }],
  // iOS applique lui-meme son masque arrondi : on fournit un carre plein.
  ["apple-touch-icon.png", 180, {}],
  // Android "maskable" : fond bord a bord + logo dans la zone de securite (80 %).
  ["icon-maskable-512.png", 512, { inset: 0.1 }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(resolve(OUT_DIR, name), draw(size, opts));
  console.log(`ok  ${name} (${size}x${size})`);
}
