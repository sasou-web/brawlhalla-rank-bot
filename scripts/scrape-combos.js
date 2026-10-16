/**
 * (Re)génère data/combos.json (la graine versionnée) depuis BrawlDatabase.
 * La logique vit dans src/combos.js (refreshCombos) — réutilisée par le dashboard, qui
 * écrit lui dans data/combos.live.json (gitignoré).
 *
 * Usage : node scripts/scrape-combos.js
 * Source & crédits : https://www.brawldatabase.com
 */
import { refreshCombos } from "../src/combos.js";

refreshCombos({ seed: true })
  .then((r) => {
    console.log(`✔ ${r.count} combos écrits dans data/combos.json`);
    console.log("Par arme :", r.byWeapon);
  })
  .catch((e) => {
    console.error("Échec scrape :", e.message);
    process.exit(1);
  });
