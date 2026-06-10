/**
 * Récupère les true combos depuis BrawlDatabase et génère data/combos.json.
 *
 * Méthode : on parcourt les fiches /combos/{id}/ (fragments htmx) et on lit les
 * meta OpenGraph (titre = "Arme | Notation", description = stats, og:video = mp4).
 * Robuste car ces meta sont stables. Les IDs absents renvoient 500 (ignorés).
 *
 * Usage : node scripts/scrape-combos.js
 * Données et crédits : https://www.brawldatabase.com
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://www.brawldatabase.com";
const MAX_ID = 240;
const CONCURRENCY = 10;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "data", "combos.json");
const HEADERS = { "HX-Request": "true", "User-Agent": "Mozilla/5.0 (combo-scraper)" };

const decode = (s) =>
  (s || "")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function fetchCombo(id) {
  let res;
  try {
    res = await fetch(`${BASE}/combos/${id}/`, { headers: HEADERS });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  const t = await res.text();

  const vid = t.match(/\/media\/combos\/([\w-]+)\/(\d+)\.mp4/);
  if (!vid) return null;
  const weapon = vid[1];

  const notationRaw = (t.match(/combo--viewer__header[\s\S]*?<h1>([\s\S]*?)<\/h1>/) || [])[1] || "";
  const notation = decode(
    notationRaw.replace(/<span class="modifier">(.*?)<\/span>/g, "[$1]").replace(/<[^>]+>/g, ""),
  );
  const desc = (t.match(/og:description" content="([^"]*)"/) || [])[1] || "";
  const stats = desc.match(/Usability:\s*(\d+)\s*\|\s*Damage Range:\s*(.+?)\s*\|\s*Dexterity:\s*(.+?)\s*\|\s*Average Damage:\s*(\d+)/);

  if (!notation) return null;
  return {
    id,
    weapon,
    notation,
    usability: stats ? Number(stats[1]) : 0,
    damage: stats ? stats[2].trim() : "—",
    dexterity: stats ? stats[3].trim() : "Any",
    avgDamage: stats ? Number(stats[4]) : 0,
    video: `${BASE}/media/combos/${weapon}/${id}.mp4`,
    url: `${BASE}/combos/${id}/`,
  };
}

async function main() {
  const ids = Array.from({ length: MAX_ID }, (_, i) => i + 1);
  const combos = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchCombo));
    for (const c of results) if (c) combos.push(c);
    process.stdout.write(`\r…${Math.min(i + CONCURRENCY, ids.length)}/${ids.length} (trouvés: ${combos.length})`);
  }
  process.stdout.write("\n");

  combos.sort((a, b) => a.weapon.localeCompare(b.weapon) || b.usability - a.usability || a.id - b.id);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ source: BASE, scrapedAt: new Date().toISOString(), combos }, null, 2));

  const byWeapon = {};
  for (const c of combos) byWeapon[c.weapon] = (byWeapon[c.weapon] || 0) + 1;
  console.log(`✔ ${combos.length} combos écrits dans ${OUT}`);
  console.log("Par arme :", byWeapon);
}

main().catch((e) => {
  console.error("Échec scrape :", e.message);
  process.exit(1);
});
