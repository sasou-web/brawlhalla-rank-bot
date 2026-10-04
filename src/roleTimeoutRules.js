/**
 * Règles de la commande /timeout déléguée par rôle — module PUR (aucun import Discord,
 * base ou config). Utilisé par le bot (commands/moderation.js), le stockage
 * (roleTimeout.js) et le serveur de prévisualisation du dashboard (scripts/dash-mock.js).
 *
 * - parseTimeoutDuration : grammaire des durées des giveaways (w/d/h/m/s combinables,
 *   nombre seul = minutes), en version STRICTE (« 2.5h » ou « 10x » sont refusés) et
 *   bornée de 1 min à 28 jours (maximum Discord).
 * - cooldownRemainingMs : temps restant avant un nouvel usage (0 = disponible).
 * - validateRoleTimeoutPatch : validation des réglages envoyés par le dashboard, sans
 *   correction silencieuse (toute valeur invalide est refusée avec un message).
 * - evaluateTimeoutRequest : qui peut exclure qui (autorisation + protections).
 */

export const TIMEOUT_MIN_MS = 60_000;
export const TIMEOUT_MAX_MS = 28 * 86_400_000; // 2 419 200 000 ms = 40 320 min (limite Discord)
export const COOLDOWN_MAX_SEC = 86_400; // 24 h
export const DEFAULT_COOLDOWN_SEC = 300;
export const MAX_ALLOWED_ROLES = 25;

const MAX_ROLE_ID_LENGTH = 32;

/** Réglages par défaut d'un serveur (objet neuf à chaque appel). */
export function defaultRoleTimeoutConfig() {
  return { enabled: false, allowedRoleIds: [], cooldownSec: DEFAULT_COOLDOWN_SEC };
}

// ---------- Durée ----------

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
// Une suite de segments « nombre + unité », espaces tolérés entre et dans les segments.
const STRICT_DURATION = /^(?:\d+\s*[wdhms]\s*)+$/;
const SEGMENT = /(\d+)\s*([wdhms])/g;

const DURATION_INVALID = "Durée invalide. Exemples : 10m, 2h, 1d, 1h30m (nombre seul = minutes).";
const DURATION_TOO_SHORT = "Durée trop courte : minimum 1 minute.";
const DURATION_TOO_LONG = "Durée trop longue : maximum 28 jours (limite Discord).";

/**
 * « 10m », « 2h », « 1d 12h », « 1h30m », « 15 » (= 15 min) → { ok: true, ms }.
 * Sinon { ok: false, error } avec un message en français.
 */
export function parseTimeoutDuration(input) {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return { ok: false, error: DURATION_INVALID };
  let ms;
  if (/^\d+$/.test(s)) {
    ms = Number(s) * UNIT_MS.m;
  } else if (STRICT_DURATION.test(s)) {
    ms = 0;
    for (const m of s.matchAll(SEGMENT)) ms += Number(m[1]) * UNIT_MS[m[2]];
  } else {
    return { ok: false, error: DURATION_INVALID };
  }
  if (!(ms >= TIMEOUT_MIN_MS)) return { ok: false, error: DURATION_TOO_SHORT };
  if (ms > TIMEOUT_MAX_MS) return { ok: false, error: DURATION_TOO_LONG };
  return { ok: true, ms };
}

// ---------- Cooldown ----------

/** Millisecondes restantes avant un nouvel usage (0 si jamais utilisé, expiré ou cooldown désactivé). */
export function cooldownRemainingMs(lastTs, cooldownSec, now) {
  const windowMs = Number(cooldownSec) * 1000;
  const last = Number(lastTs);
  if (!(windowMs > 0) || !(last > 0)) return 0;
  return Math.min(windowMs, Math.max(0, last + windowMs - now));
}

// ---------- Validation des réglages (dashboard) ----------

const COOLDOWN_INVALID = "Le cooldown doit être un nombre entier de secondes entre 0 et 86 400 (24 h).";

/**
 * Valide un patch partiel { enabled?, allowedRoleIds?, cooldownSec? }. Les clés inconnues
 * sont ignorées. `roleIds` (Set ou tableau) = rôles existants du serveur, obligatoire si
 * `allowedRoleIds` est modifié ; `everyoneRoleId` = id du rôle @everyone (= id du serveur).
 * → { ok: true, value } (patch nettoyé) | { ok: false, error }.
 */
export function validateRoleTimeoutPatch(patch, { roleIds, everyoneRoleId } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "Modification invalide." };
  const value = {};

  if ("enabled" in patch) {
    if (typeof patch.enabled !== "boolean") return { ok: false, error: "L'activation doit valoir vrai ou faux." };
    value.enabled = patch.enabled;
  }

  if ("cooldownSec" in patch) {
    const v = patch.cooldownSec;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > COOLDOWN_MAX_SEC) return { ok: false, error: COOLDOWN_INVALID };
    value.cooldownSec = v;
  }

  if ("allowedRoleIds" in patch) {
    const list = patch.allowedRoleIds;
    if (!Array.isArray(list)) return { ok: false, error: "La liste des rôles autorisés est invalide." };
    const known = roleIds instanceof Set ? roleIds : Array.isArray(roleIds) ? new Set(roleIds) : null;
    // Jamais de validation à l'aveugle : sans la liste des rôles du serveur, on refuse.
    if (!known) return { ok: false, error: "Impossible de vérifier les rôles du serveur." };
    const out = [];
    for (const id of list) {
      const valid = typeof id === "string" && id.length > 0 && id.length <= MAX_ROLE_ID_LENGTH;
      if (valid && everyoneRoleId && id === everyoneRoleId) {
        return { ok: false, error: "Le rôle @everyone ne peut pas être autorisé : tout le monde pourrait exclure." };
      }
      if (!valid || !known.has(id)) return { ok: false, error: `Rôle introuvable sur le serveur : ${String(id).slice(0, MAX_ROLE_ID_LENGTH)}.` };
      if (!out.includes(id)) out.push(id);
    }
    if (out.length > MAX_ALLOWED_ROLES) return { ok: false, error: `${MAX_ALLOWED_ROLES} rôles autorisés au maximum.` };
    value.allowedRoleIds = out;
  }

  return { ok: true, value };
}

// ---------- Autorisation ----------

const REFUSALS = {
  disabled: "La commande /timeout est désactivée sur ce serveur.",
  forbidden: "Tu n'as pas la permission d'utiliser /timeout.",
  self: "Tu ne peux pas t'exclure toi-même.",
  "self-bot": "Je ne peux pas m'exclure moi-même.",
  bot: "Impossible d'exclure un bot.",
  owner: "Impossible d'exclure le propriétaire du serveur.",
  staff: "Impossible d'exclure un administrateur ou un modérateur.",
  hierarchy: "Ce membre a un rôle égal ou supérieur au tien.",
  unmoderatable: "Je ne peux pas exclure ce membre : son rôle est au-dessus du mien ou il me manque la permission « Exclure temporairement des membres ».",
};

const refuse = (code, message = REFUSALS[code]) => ({ ok: false, code, message });

/**
 * Décide si `executor` peut exclure `target`. Descripteurs de membre :
 *   { id, isBot, isOwner, isAdmin, isModerator, roleIds, highestPosition, moderatable, timedOutUntil }
 * Les modérateurs natifs (ModerateMembers, Administrator, propriétaire) passent toujours,
 * même module désactivé, sans cooldown. Les protections sur la cible valent pour tous.
 * → { ok: true, bypassCooldown, via: "role" | "moderator", roleId } | { ok: false, code, message }.
 */
export function evaluateTimeoutRequest({ config, executor, target, botUserId, now }) {
  const cfg = config || {};
  const moderator = Boolean(executor.isModerator || executor.isAdmin || executor.isOwner);
  let roleId = null;
  if (!moderator) {
    if (!cfg.enabled) return refuse("disabled");
    const allowed = new Set(Array.isArray(cfg.allowedRoleIds) ? cfg.allowedRoleIds : []);
    roleId = (executor.roleIds || []).find((id) => allowed.has(id)) || null;
    if (!roleId) return refuse("forbidden");
  }

  if (target.id === executor.id) return refuse("self");
  if (botUserId && target.id === botUserId) return refuse("self-bot");
  if (target.isBot) return refuse("bot");
  if (target.isOwner) return refuse("owner");
  if (target.isAdmin || target.isModerator) return refuse("staff");
  if (!executor.isOwner && Number(target.highestPosition) >= Number(executor.highestPosition)) return refuse("hierarchy");
  if (!target.moderatable) return refuse("unmoderatable");
  const until = Number(target.timedOutUntil) || 0;
  if (until > now) return refuse("already", `Ce membre est déjà exclu jusqu'à <t:${Math.floor(until / 1000)}:f>.`);

  return { ok: true, bypassCooldown: moderator, via: moderator ? "moderator" : "role", roleId };
}
