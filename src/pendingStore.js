import { db } from "./db.js";

/**
 * File de récupération en arrière-plan, persistée en SQLite.
 *
 * Les profils/recherches qui ont échoué à cause de l'API Brawlhalla sont réessayés en
 * boucle (`retryPending` dans brawlhalla.js). Avant, ces files vivaient uniquement en
 * mémoire et étaient PERDUES au redémarrage : un `/lier` qui avait échoué ne se rejouait
 * plus tout seul. Ici on les persiste pour qu'elles survivent à un restart / `pm2 restart`.
 *
 * Table `pending (kind, item)` : `kind` = "profile" | "search", `item` = brawlhalla_id
 * ou pseudo recherché. UPSERT idempotent (INSERT OR IGNORE), suppression par paire.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS pending (
    kind     TEXT NOT NULL,
    item     TEXT NOT NULL,
    added_ts INTEGER NOT NULL,
    PRIMARY KEY (kind, item)
  );
`);

const addStmt = db.prepare("INSERT OR IGNORE INTO pending (kind, item, added_ts) VALUES (?, ?, ?)");
const delStmt = db.prepare("DELETE FROM pending WHERE kind = ? AND item = ?");
const listStmt = db.prepare("SELECT item FROM pending WHERE kind = ? ORDER BY added_ts ASC");
const pruneStmt = db.prepare("DELETE FROM pending WHERE added_ts < ?");

/** Ajoute un élément à récupérer (idempotent). */
export function addPending(kind, item) {
  addStmt.run(kind, String(item), Date.now());
}

/** Retire un élément récupéré avec succès. */
export function removePending(kind, item) {
  delStmt.run(kind, String(item));
}

/** Liste les éléments en attente pour un type donné (les plus anciens d'abord). */
export function loadPending(kind) {
  return listStmt.all(kind).map((r) => r.item);
}

/** Purge les éléments plus vieux que `maxAgeMs` (hygiène : ne pas réessayer indéfiniment). */
export function prunePending(maxAgeMs) {
  pruneStmt.run(Date.now() - Math.max(0, maxAgeMs));
}
