import { loadDoc, saveDoc } from "./db.js";
import { COOLDOWN_MAX_SEC, cooldownRemainingMs, defaultRoleTimeoutConfig, validateRoleTimeoutPatch } from "./roleTimeoutRules.js";

/**
 * /timeout délégué par rôle : réglages par serveur et cooldown persistant.
 * Les règles (durées, validation, autorisation) sont dans roleTimeoutRules.js (pur).
 *
 * Config (kv.roletimeout, modifiable par le staff via le dashboard) :
 *   { guilds: { [guildId]: { enabled, allowedRoleIds, cooldownSec } } }
 * État (kv.roletimeoutState, jamais exposé au dashboard) :
 *   { guilds: { [guildId]: { lastUse: { [executorUserId]: tsMs } } } }
 * Le cooldown n'est écrit qu'après un timeout réussi et survit aux redémarrages.
 */

const CONFIG_KEY = "roletimeout";
const STATE_KEY = "roletimeoutState";
const STATE_TTL_MS = COOLDOWN_MAX_SEC * 1000; // au-delà, une entrée ne peut plus bloquer personne

let configDoc = null;
let stateDoc = null;

function configs() {
  if (!configDoc) {
    configDoc = loadDoc(CONFIG_KEY, { guilds: {} });
    if (!configDoc.guilds) configDoc.guilds = {};
  }
  return configDoc;
}

function states() {
  if (!stateDoc) {
    stateDoc = loadDoc(STATE_KEY, { guilds: {} });
    if (!stateDoc.guilds) stateDoc.guilds = {};
  }
  return stateDoc;
}

/** Erreur de réglage avec le statut HTTP à renvoyer au dashboard (400 par défaut). */
export class RoleTimeoutConfigError extends Error {
  constructor(message, httpStatus = 400) {
    super(message);
    this.name = "RoleTimeoutConfigError";
    this.httpStatus = httpStatus;
  }
}

export async function getRoleTimeoutConfig(guildId) {
  const g = { ...defaultRoleTimeoutConfig(), ...(configs().guilds[guildId] || {}) };
  return { enabled: Boolean(g.enabled), allowedRoleIds: [...(g.allowedRoleIds || [])], cooldownSec: g.cooldownSec };
}

/**
 * Applique un patch partiel validé. `resolveRoles()` → { roleIds, everyoneRoleId } n'est
 * appelé que si la liste des rôles change. Rien n'est écrit si la validation échoue.
 */
export async function setRoleTimeoutConfig(guildId, patch, { resolveRoles } = {}) {
  let roles = {};
  if (patch && typeof patch === "object" && "allowedRoleIds" in patch && typeof resolveRoles === "function") {
    try {
      roles = await resolveRoles();
    } catch {
      throw new RoleTimeoutConfigError("Impossible de vérifier les rôles du serveur (Discord injoignable). Réessaie.", 503);
    }
  }
  const v = validateRoleTimeoutPatch(patch, roles);
  if (!v.ok) throw new RoleTimeoutConfigError(v.error, 400);
  const c = configs();
  c.guilds[guildId] = { ...(await getRoleTimeoutConfig(guildId)), ...v.value };
  saveDoc(CONFIG_KEY, c);
  return getRoleTimeoutConfig(guildId);
}

/** Section du dashboard ({ get, set }) branchée sur la route PUT /api/config/:section. */
export function roleTimeoutSection(guildId, resolveRoles) {
  return {
    get: () => getRoleTimeoutConfig(guildId),
    set: (patch) => setRoleTimeoutConfig(guildId, patch, { resolveRoles }),
  };
}

/** Millisecondes avant que `userId` puisse réutiliser /timeout (0 = disponible). */
export function getTimeoutCooldownRemaining(guildId, userId, cooldownSec, now = Date.now()) {
  const last = states().guilds[guildId]?.lastUse?.[userId];
  return cooldownRemainingMs(last, cooldownSec, now);
}

/** Arme le cooldown de `userId` (à appeler uniquement après un timeout réussi). */
export function recordTimeoutUse(guildId, userId, now = Date.now()) {
  const s = states();
  const st = (s.guilds[guildId] ||= {});
  const lastUse = (st.lastUse ||= {});
  lastUse[userId] = now;
  // Ménage : une entrée de plus de 24 h ne bloque plus personne (cooldown maximal).
  for (const [id, ts] of Object.entries(lastUse)) if (!(now - ts <= STATE_TTL_MS)) delete lastUse[id];
  saveDoc(STATE_KEY, s);
}
