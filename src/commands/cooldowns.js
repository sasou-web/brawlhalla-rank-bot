import { EPHEMERAL } from "./shared.js";

/**
 * Cooldowns par (catégorie, utilisateur), en mémoire.
 *
 * Protège les commandes coûteuses (appels API Brawlhalla, rendu canvas) contre le spam
 * d'un même membre — ce qui éviterait de saturer l'API déjà fragile ou le rendu d'images.
 * Chaque catégorie a son propre "bucket" : un membre peut utiliser /carte et /versus
 * indépendamment, mais pas spammer la même commande.
 */

const buckets = new Map(); // key -> Map(userId -> lastTs)
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

// Nettoyage périodique : retire les entrées plus vieilles que `maxAgeMs` pour éviter
// que les maps ne grossissent indéfiniment avec le temps.
function maybeSweep(maxAgeMs) {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, m] of buckets) {
    for (const [uid, ts] of m) if (now - ts > maxAgeMs) m.delete(uid);
    if (m.size === 0) buckets.delete(key);
  }
}

/**
 * Vérifie (et arme) le cooldown pour (key, userId).
 * Renvoie { ok, remainingMs } : ok=true si l'action est autorisée (et le cooldown est ré-armé).
 * Un `ms` <= 0 autorise toujours.
 */
export function checkCooldown(key, userId, ms) {
  if (!ms || ms <= 0) return { ok: true, remainingMs: 0 };
  const now = Date.now();
  let m = buckets.get(key);
  if (!m) {
    m = new Map();
    buckets.set(key, m);
  }
  const last = m.get(userId) ?? 0;
  const remaining = ms - (now - last);
  if (remaining > 0) return { ok: false, remainingMs: remaining };
  m.set(userId, now);
  maybeSweep(Math.max(ms, 60_000));
  return { ok: true, remainingMs: 0 };
}

/**
 * Applique un cooldown à une interaction de commande. À appeler AVANT deferReply().
 * Si le membre est en cooldown, répond un message éphémère et renvoie false
 * (le handler doit alors `return`). Sinon arme le cooldown et renvoie true.
 */
export async function enforceCooldown(interaction, key, ms) {
  const { ok, remainingMs } = checkCooldown(key, interaction.user.id, ms);
  if (ok) return true;
  const secs = Math.ceil(remainingMs / 1000);
  const content = `⏳ Doucement ! Réessaie dans **${secs}s**.`;
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
    else await interaction.reply({ content, flags: EPHEMERAL });
  } catch {
    /* best-effort */
  }
  return false;
}

// Réinitialise tous les cooldowns (tests).
export function resetCooldowns() {
  buckets.clear();
  lastSweep = Date.now();
}
