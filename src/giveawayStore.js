import { db } from "./db.js";

/**
 * Persistance des giveaways (concours) en SQLite.
 *
 * Deux tables dédiées (fort volume d'écritures + requêtes par état/échéance) :
 *  - `giveaways`        : un concours = prix, salon, message, gagnants, échéance, statut.
 *  - `giveaway_entries` : une participation = (giveaway_id, user_id). PRIMARY KEY composite
 *                         → INSERT OR IGNORE idempotent, un membre ne participe qu'une fois.
 *
 * Le statut suit le cycle de vie : "active" → "ended" (tirage fait) ou "cancelled" (annulé).
 * `winner_ids` est un JSON d'IDs Discord, rempli au tirage (et au reroll).
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS giveaways (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    message_id       TEXT,
    prize            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    winners_count    INTEGER NOT NULL DEFAULT 1,
    required_role_id TEXT,
    host_id          TEXT NOT NULL,
    image_url        TEXT NOT NULL DEFAULT '',
    created_ts       INTEGER NOT NULL,
    ends_ts          INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active',
    winner_ids       TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(status, ends_ts);
  CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id, status);

  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id     TEXT NOT NULL,
    entered_ts  INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_entries_giveaway ON giveaway_entries(giveaway_id);
`);

const insGiveaway = db.prepare(`
  INSERT INTO giveaways (guild_id, channel_id, prize, description, winners_count, required_role_id, host_id, image_url, created_ts, ends_ts, status, winner_ids)
  VALUES (@guild_id, @channel_id, @prize, @description, @winners_count, @required_role_id, @host_id, @image_url, @created_ts, @ends_ts, 'active', '[]')
`);
const setMessageStmt = db.prepare("UPDATE giveaways SET message_id = ? WHERE id = ?");
const getStmt = db.prepare("SELECT * FROM giveaways WHERE id = ?");
const byGuildStmt = db.prepare("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_ts DESC LIMIT ?");
const activeByGuildStmt = db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_ts ASC");
const dueStmt = db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_ts <= ?");
const setStatusStmt = db.prepare("UPDATE giveaways SET status = ? WHERE id = ?");
const setWinnersStmt = db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ? WHERE id = ?");
const setEndsStmt = db.prepare("UPDATE giveaways SET ends_ts = ? WHERE id = ?");
const delGiveawayStmt = db.prepare("DELETE FROM giveaways WHERE id = ?");

const addEntryStmt = db.prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, entered_ts) VALUES (?, ?, ?)");
const delEntryStmt = db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?");
const hasEntryStmt = db.prepare("SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?");
const countEntriesStmt = db.prepare("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?");
const listEntriesStmt = db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?");
const delEntriesStmt = db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ?");

function rowToGiveaway(row) {
  if (!row) return null;
  let winners = [];
  try {
    winners = JSON.parse(row.winner_ids || "[]");
  } catch {
    winners = [];
  }
  return { ...row, winnerIds: Array.isArray(winners) ? winners : [] };
}

/** Crée un giveaway (statut "active"). Renvoie l'enregistrement complet avec son id. */
export function createGiveawayRow({
  guildId,
  channelId,
  prize,
  description = "",
  winnersCount = 1,
  requiredRoleId = null,
  hostId,
  imageUrl = "",
  endsTs,
}) {
  const info = insGiveaway.run({
    guild_id: String(guildId),
    channel_id: String(channelId),
    prize: String(prize).slice(0, 250),
    description: String(description || "").slice(0, 1500),
    winners_count: Math.max(1, Math.min(50, Number(winnersCount) || 1)),
    required_role_id: requiredRoleId ? String(requiredRoleId) : null,
    host_id: String(hostId),
    image_url: String(imageUrl || "").slice(0, 500),
    created_ts: Date.now(),
    ends_ts: Number(endsTs),
  });
  return rowToGiveaway(getStmt.get(info.lastInsertRowid));
}

/** Enregistre l'id du message Discord publié pour ce giveaway. */
export function setGiveawayMessage(id, messageId) {
  setMessageStmt.run(String(messageId), id);
}

/** Récupère un giveaway par son id (avec winnerIds parsés). */
export function getGiveaway(id) {
  return rowToGiveaway(getStmt.get(id));
}

/** Liste les derniers giveaways d'un serveur (tous statuts), récents d'abord. */
export function listGiveaways(guildId, limit = 25) {
  return byGuildStmt.all(String(guildId), Math.max(1, Math.min(100, limit))).map(rowToGiveaway);
}

/** Liste les giveaways actifs d'un serveur (échéance la plus proche d'abord). */
export function listActiveGiveaways(guildId) {
  return activeByGuildStmt.all(String(guildId)).map(rowToGiveaway);
}

/** Liste les giveaways actifs dont l'échéance est dépassée (à clôturer). */
export function listDueGiveaways(now = Date.now()) {
  return dueStmt.all(now).map(rowToGiveaway);
}

/** Marque un giveaway comme terminé en mémorisant les gagnants tirés. */
export function markGiveawayEnded(id, winnerIds) {
  setWinnersStmt.run(JSON.stringify(winnerIds || []), id);
}

/** Met à jour le statut brut (ex : "cancelled"). */
export function setGiveawayStatus(id, status) {
  setStatusStmt.run(status, id);
}

/** Repousse l'échéance d'un giveaway actif. */
export function setGiveawayEnds(id, endsTs) {
  setEndsStmt.run(Number(endsTs), id);
}

/** Supprime un giveaway et toutes ses participations. */
export function deleteGiveaway(id) {
  delEntriesStmt.run(id);
  delGiveawayStmt.run(id);
}

// ---------- Participations ----------

/** Ajoute une participation (idempotent). Renvoie true si nouvelle entrée. */
export function addEntry(giveawayId, userId) {
  return addEntryStmt.run(giveawayId, String(userId), Date.now()).changes > 0;
}

/** Retire une participation. Renvoie true si une entrée a été retirée. */
export function removeEntry(giveawayId, userId) {
  return delEntryStmt.run(giveawayId, String(userId)).changes > 0;
}

/** Indique si un membre participe déjà. */
export function hasEntry(giveawayId, userId) {
  return Boolean(hasEntryStmt.get(giveawayId, String(userId)));
}

/** Nombre de participants. */
export function countEntries(giveawayId) {
  return countEntriesStmt.get(giveawayId)?.n || 0;
}

/** Liste des IDs Discord des participants. */
export function listEntries(giveawayId) {
  return listEntriesStmt.all(giveawayId).map((r) => r.user_id);
}
