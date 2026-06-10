/**
 * Accès aux true combos Brawlhalla (données BrawlDatabase, voir scripts/scrape-combos.js).
 * Crédits & source : https://www.brawldatabase.com
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "..", "data", "combos.json");

// slug d'arme BrawlDB -> libellé FR + emoji.
export const WEAPON_META = {
  sword: { label: "Épée", emoji: "🗡️" },
  hammer: { label: "Marteau", emoji: "🔨" },
  blasters: { label: "Blasters", emoji: "🔫" },
  lance: { label: "Lance", emoji: "🐎" },
  spear: { label: "Spear", emoji: "🔱" },
  katars: { label: "Katars", emoji: "🐾" },
  axe: { label: "Hache", emoji: "🪓" },
  bow: { label: "Arc", emoji: "🏹" },
  gauntlets: { label: "Gantelets", emoji: "🥊" },
  scythe: { label: "Faux", emoji: "☠️" },
  cannon: { label: "Canon", emoji: "💣" },
  orb: { label: "Orbe", emoji: "🔮" },
  greatsword: { label: "Grande épée", emoji: "⚔️" },
  battle_boots: { label: "Bottes", emoji: "🥾" },
  unarmed: { label: "Mains nues", emoji: "✊" },
  chakram: { label: "Chakram", emoji: "💫" },
};

export const weaponLabel = (slug) => WEAPON_META[slug]?.label || slug;
export const weaponEmoji = (slug) => WEAPON_META[slug]?.emoji || "⚔️";

let cache = null;
export async function loadCombos() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(DATA, "utf8"));
    cache = Array.isArray(raw.combos) ? raw.combos : [];
  } catch {
    cache = [];
  }
  return cache;
}

// Liste des armes présentes dans la base, dans l'ordre de WEAPON_META.
export async function weaponsWithCombos() {
  const combos = await loadCombos();
  const present = new Set(combos.map((c) => c.weapon));
  return Object.keys(WEAPON_META).filter((w) => present.has(w));
}

// Combos d'une arme, triés par usability décroissante (déjà trié dans le JSON).
export async function combosFor(weapon) {
  const combos = await loadCombos();
  return combos.filter((c) => c.weapon === weapon);
}
