// Instantané de data/bot.db AVANT une mise à jour (appelé par update.sh, non bloquant).
//
// Point de retour si la nouvelle version migre mal les données : la sauvegarde cron de 4 h
// peut avoir jusqu'à 24 h de retard. db.backup() = API de sauvegarde en ligne de SQLite, via
// better-sqlite3 (déjà installé) : copie cohérente d'une base en cours d'utilisation (WAL),
// sans arrêter le bot ni dépendre du CLI sqlite3 (absent du serveur).
//
// Usage : node scripts/snapshot-db.js [etiquette]   (update.sh passe le commit courant)
// Produit backups/pre-update_<horodatage>[_<etiquette>].db, ne garde que les KEEP derniers.
// Restauration : comme une archive (DEPLOY.md), sans le gunzip.
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "pre-update_";
export const KEEP = 5;

// Même format que les archives de backup-data.sh (heure locale) : AAAA-MM-JJ_HH-MM-SS.
function stampOf(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Instantanés à supprimer pour n'en garder que `keep` (l'horodatage du nom donne l'ordre). */
export function snapshotsToPrune(names, keep = KEEP) {
  return names
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(".db"))
    .sort()
    .reverse()
    .slice(keep);
}

/** Copie `src` dans `dir` puis fait la rotation. Renvoie le chemin créé, ou null sans base. */
export async function snapshotDb({ src, dir, label = "", keep = KEEP, now = new Date() }) {
  if (!existsSync(src)) return null;
  mkdirSync(dir, { recursive: true });
  const tag = String(label || "").replace(/[^\w.-]/g, "");
  const dest = join(dir, `${PREFIX}${stampOf(now)}${tag ? `_${tag}` : ""}.db`);
  const db = new Database(src, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    // Tout le reste en UNE étape : copiée par petits pas, la sauvegarde repartirait de zéro
    // à chaque écriture du bot entre deux pas.
    await db.backup(dest, { progress: () => 1e6 });
    // La copie hérite du mode WAL de la source : on la repasse en journal classique pour
    // qu'elle tienne en UN fichier (pas de -wal/-shm créés à l'ouverture, restauration = cp).
    const copy = new Database(dest, { fileMustExist: true });
    try {
      copy.pragma("journal_mode = DELETE");
    } finally {
      copy.close();
    }
  } catch (e) {
    // Une copie partielle ne doit pas passer pour un point de retour.
    for (const ext of ["", "-wal", "-shm"]) rmSync(dest + ext, { force: true });
    throw e;
  } finally {
    db.close();
  }
  for (const name of snapshotsToPrune(readdirSync(dir), keep)) {
    for (const ext of ["", "-wal", "-shm"]) rmSync(join(dir, name + ext), { force: true });
  }
  return dest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = process.env.BOT_DB_PATH ? resolve(process.env.BOT_DB_PATH) : join(ROOT, "data", "bot.db");
  try {
    const dest = await snapshotDb({ src, dir: join(ROOT, "backups"), label: process.argv[2] });
    console.log(dest ? `    Instantane : ${dest}` : `    ${src} introuvable : aucun instantane.`);
  } catch (e) {
    console.error(`    Instantane impossible : ${e.message}`);
    process.exitCode = 1;
  }
}
