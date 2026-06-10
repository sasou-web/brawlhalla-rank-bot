import { GlobalFonts } from "@napi-rs/canvas";

/**
 * Chargement de police partagé pour les cartes images (profil, niveau, bracket).
 * @napi-rs/canvas embarque Skia mais pas de police par défaut fiable selon l'OS : on
 * tente d'enregistrer une police système courante (Linux/Windows), sinon repli "sans-serif".
 * Évite la duplication de cette logique dans chaque fichier de rendu.
 */

export let FONT = "sans-serif";
export let FONT_BOLD = "sans-serif";

const FONT_TRIES = [
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "BotCardBold", true],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "BotCard", false],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "BotCardBold", true],
  ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "BotCard", false],
  ["C:\\Windows\\Fonts\\arialbd.ttf", "BotCardBold", true],
  ["C:\\Windows\\Fonts\\arial.ttf", "BotCard", false],
];

for (const [path, name, bold] of FONT_TRIES) {
  try {
    if (GlobalFonts.registerFromPath(path, name)) {
      if (bold) FONT_BOLD = name;
      else FONT = name;
    }
  } catch {
    /* police absente : on continue (repli sans-serif) */
  }
}
