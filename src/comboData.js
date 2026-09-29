/**
 * Données de combos PURES (aucun import Discord ni base) : métadonnées des armes,
 * découpage de la notation et catalogue public du Combo Lab.
 * Importé par src/combos.js (bot) ET par scripts/dash-mock.js (dashboard sans Discord).
 */

// slug d'arme BrawlDB -> libellé FR + emoji. L'ordre sert d'ordre d'affichage.
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

/**
 * Découpe une notation BrawlDB en étapes.
 * "Nlight[M] [SP] > Jump > Nair" -> [{ move: "Nlight", mods: ["M", "SP"] }, { move: "Jump", mods: [] }, …]
 */
export function splitNotation(notation) {
  return String(notation || "")
    .split(">")
    .map((part) => {
      const mods = [...part.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
      const move = part.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
      return { move, mods };
    })
    .filter((s) => s.move || s.mods.length);
}

/** Forme publique d'un combo (sans l'URL vidéo d'origine : le Lab passe par son proxy). */
export function toPublicCombo(c) {
  return {
    id: c.id,
    weapon: c.weapon,
    notation: c.notation,
    steps: splitNotation(c.notation),
    usability: c.usability,
    damage: c.damage,
    dexterity: c.dexterity,
    avgDamage: c.avgDamage,
    url: c.url,
  };
}

/** Catalogue du Combo Lab : armes présentes (ordre WEAPON_META) + combos publics. */
export function buildLabCatalog(combos) {
  const list = Array.isArray(combos) ? combos : [];
  const counts = {};
  for (const c of list) counts[c.weapon] = (counts[c.weapon] || 0) + 1;
  const known = Object.keys(WEAPON_META).filter((w) => counts[w]);
  const extra = Object.keys(counts).filter((w) => !WEAPON_META[w]).sort();
  const weapons = [...known, ...extra].map((slug) => ({
    slug,
    label: weaponLabel(slug),
    emoji: weaponEmoji(slug),
    count: counts[slug],
  }));
  return { weapons, combos: list.map(toPublicCombo) };
}
