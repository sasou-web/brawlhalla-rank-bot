/**
 * Progression « Je maîtrise ce combo » : un membre coche les combos qu'il sait placer.
 *
 * Table dédiée `combo_mastery` (irremplaçable, donc sauvegardée par backup-data.sh).
 * `xp_ts` mémorise le gain d'XP d'un combo : il survit au décochage, si bien que
 * décocher / recocher ne rapporte jamais deux fois. La maîtrise étant déclarative,
 * le nombre de combos récompensés par jour est plafonné (MASTERY_XP_DAILY).
 */
import { db } from "./db.js";

export const MASTERY_XP = 10; // XP par combo maîtrisé (une seule fois par combo)
export const MASTERY_XP_DAILY = 5; // combos récompensés au plus par jour (UTC)

db.exec(`
  CREATE TABLE IF NOT EXISTS combo_mastery (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    combo_id   INTEGER NOT NULL,
    weapon     TEXT NOT NULL,
    mastered   INTEGER NOT NULL DEFAULT 1,
    xp_ts      INTEGER NOT NULL DEFAULT 0,
    updated_ts INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, combo_id)
  );
`);

const listStmt = db.prepare("SELECT combo_id AS id FROM combo_mastery WHERE guild_id = ? AND user_id = ? AND mastered = 1");
const getStmt = db.prepare("SELECT mastered, xp_ts AS xpTs FROM combo_mastery WHERE guild_id = ? AND user_id = ? AND combo_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO combo_mastery (guild_id, user_id, combo_id, weapon, mastered, updated_ts)
  VALUES (@g, @u, @id, @weapon, @mastered, @now)
  ON CONFLICT(guild_id, user_id, combo_id) DO UPDATE SET
    mastered = @mastered, weapon = @weapon, updated_ts = @now
`);
const xpTodayStmt = db.prepare("SELECT COUNT(*) AS c FROM combo_mastery WHERE guild_id = ? AND user_id = ? AND xp_ts >= ?");
const claimStmt = db.prepare(
  "UPDATE combo_mastery SET xp_ts = ? WHERE guild_id = ? AND user_id = ? AND combo_id = ? AND mastered = 1 AND xp_ts = 0",
);

/** Ids (nombres) des combos maîtrisés par un membre. */
export function masteredSet(guildId, userId) {
  return new Set(listStmt.all(String(guildId), String(userId)).map((r) => Number(r.id)));
}

export function isMastered(guildId, userId, comboId) {
  return getStmt.get(String(guildId), String(userId), Number(comboId))?.mastered === 1;
}

/** Coche / décoche un combo. `combo` = { id, weapon }. Renvoie l'état final (booléen). */
export function setMastery(guildId, userId, combo, mastered, now = Date.now()) {
  upsertStmt.run({
    g: String(guildId),
    u: String(userId),
    id: Number(combo.id),
    weapon: String(combo.weapon),
    mastered: mastered ? 1 : 0,
    now,
  });
  return Boolean(mastered);
}

/** Inverse l'état d'un combo. Renvoie le nouvel état (true = maîtrisé). */
export function toggleMastery(guildId, userId, combo, now = Date.now()) {
  return setMastery(guildId, userId, combo, !isMastered(guildId, userId, combo.id), now);
}

function utcDayStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Réserve le gain d'XP d'un combo maîtrisé. Renvoie :
 *   "granted" → l'XP doit être accordée maintenant (réservation enregistrée) ;
 *   "already" → ce combo a déjà rapporté de l'XP ;
 *   "limit"   → limite du jour atteinte (le combo reste maîtrisé ; il pourra rapporter
 *               plus tard s'il est décoché puis recoché un autre jour) ;
 *   "none"    → le combo n'est pas coché.
 * Transaction synchrone : aucun double gain possible, même sur des clics simultanés.
 */
export const claimMasteryXp = db.transaction((guildId, userId, comboId, now = Date.now(), dailyLimit = MASTERY_XP_DAILY) => {
  const g = String(guildId);
  const u = String(userId);
  const row = getStmt.get(g, u, Number(comboId));
  if (!row || row.mastered !== 1) return "none";
  if (row.xpTs > 0) return "already";
  if (xpTodayStmt.get(g, u, utcDayStart(now)).c >= dailyLimit) return "limit";
  return claimStmt.run(now, g, u, Number(comboId)).changes > 0 ? "granted" : "already";
});

/**
 * Statistiques de progression par rapport au dataset courant (les combos retirés de
 * BrawlDB ne comptent plus). Renvoie { count, weaponsCompleted, byWeapon: { w: { done, total } } }.
 */
export function masteryStats(mastered, combos) {
  const byWeapon = {};
  let count = 0;
  for (const c of combos || []) {
    const s = (byWeapon[c.weapon] ||= { done: 0, total: 0 });
    s.total++;
    if (mastered.has(Number(c.id))) {
      s.done++;
      count++;
    }
  }
  const weaponsCompleted = Object.values(byWeapon).filter((s) => s.total > 0 && s.done === s.total).length;
  return { count, weaponsCompleted, byWeapon };
}
