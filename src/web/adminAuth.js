// Vérification des droits admin du dashboard, extraite de server.js pour être testable
// sans Express ni Discord (un faux serveur suffit).
import { PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";

// Réponses Discord DÉFINITIVES : l'utilisateur n'est pas (ou plus) sur le serveur (exclu,
// banni, parti). Ce n'est surtout pas un échec transitoire : il n'est pas admin.
const NOT_MEMBER_CODES = new Set([RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser]);

/** true si `userId` est propriétaire du serveur ou a « Gérer le serveur ». Lève sur un échec transitoire. */
export async function isGuildAdmin(guild, userId) {
  if (!userId) return false; // members.fetch(undefined) chargerait TOUS les membres
  if (guild.ownerId === userId) return true;
  try {
    const member = await guild.members.fetch(userId);
    return member.permissions.has(PermissionFlagsBits.ManageGuild);
  } catch (err) {
    if (NOT_MEMBER_CODES.has(err?.code)) return false;
    throw err;
  }
}

/**
 * Re-vérification des droits admin à chaque requête, avec un cache court (ttlMs) pour ne pas
 * marteler l'API Discord : un admin déchu ou exclu perd l'accès en <= ttlMs, sans attendre
 * l'expiration (1 j) du JWT figé au login.
 *
 * Sur un échec TRANSITOIRE de l'API Discord (hoquet réseau, rate-limit), on ne révoque pas
 * pour autant : on garde la dernière valeur connue (cache, sinon flag du JWT signé au login),
 * mais seulement si elle date de moins de graceMs. Au-delà, la promesse est rejetée (droits
 * invérifiables) : l'appelant répond 503, jamais un accès accordé sur une info périmée.
 *
 * check(userId) → Promise<boolean> (voir isGuildAdmin).
 * Renvoie verify(session) → Promise<boolean>, session = JWT décodé ({ id, isAdmin, iat }).
 */
export function createAdminVerifier(check, { ttlMs = 60_000, graceMs = 5 * 60_000, now = Date.now } = {}) {
  const cache = new Map(); // userId -> { admin, exp, checkedAt }
  return async function verifyAdmin(session) {
    const t = now();
    const userId = session.id;
    const cached = cache.get(userId);
    if (cached && cached.exp > t) return cached.admin;
    try {
      const admin = await check(userId);
      cache.set(userId, { admin, exp: t + ttlMs, checkedAt: t });
      return admin;
    } catch (err) {
      // Dernière vérification réussie : le cache (même expiré), sinon le login (iat du JWT).
      const last = cached || { admin: Boolean(session.isAdmin), checkedAt: (Number(session.iat) || 0) * 1000 };
      if (t - last.checkedAt <= graceMs) return last.admin;
      cache.delete(userId); // trop vieux pour servir de repli : on ne le garde pas
      throw err;
    }
  };
}
