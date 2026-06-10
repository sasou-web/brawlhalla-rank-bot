/**
 * Métriques de fiabilité de l'API Brawlhalla (en mémoire, remises à zéro au redémarrage).
 *
 * Objectif : rendre observable « quand et pourquoi l'API lâche », au lieu de le deviner.
 * Chaque TENTATIVE HTTP (y compris les retries) est comptée et classée. On en dérive un
 * taux de succès et on garde la dernière erreur. Exposé via brawlhalla.getApiMetrics()
 * (dashboard + /ping).
 */

function freshState() {
  return {
    startedAt: Date.now(),
    requests: 0, // tentatives HTTP totales (retries compris)
    ok: 0, // réponses 2xx
    notFound: 0, // 404 (absence légitime de donnée, ex. pas d'équipe 2v2)
    rateLimited: 0, // 429
    serverErrors: 0, // 5xx (origine qui tombe par fenêtres)
    otherClient: 0, // autres 4xx
    networkErrors: 0, // échec réseau / fetch rejeté
    retries: 0, // nombre de re-tentatives effectuées
    cooldowns: 0, // nombre de cooldowns globaux posés (429/503)
    lastSuccessTs: 0,
    lastError: null, // { ts, status, message }
  };
}

let m = freshState();

/**
 * Enregistre l'issue d'une tentative HTTP.
 * @param {"ok"|"notFound"|"rateLimited"|"serverErrors"|"otherClient"|"networkErrors"} kind
 * @param {{status?: number, message?: string}} [info]
 */
export function recordOutcome(kind, info = {}) {
  m.requests += 1;
  if (kind in m && typeof m[kind] === "number") m[kind] += 1;
  if (kind === "ok") {
    m.lastSuccessTs = Date.now();
  } else if (kind !== "notFound") {
    m.lastError = { ts: Date.now(), status: info.status ?? 0, message: info.message ?? kind };
  }
}

export function recordRetry() {
  m.retries += 1;
}

export function recordCooldown() {
  m.cooldowns += 1;
}

/**
 * Instantané des métriques + taux de succès dérivé.
 * Le taux de succès exclut les 404 (absence légitime de donnée).
 * @param {object} [extra] champs additionnels (cooldown, files, index…) fusionnés au résultat.
 */
export function snapshot(extra = {}) {
  const meaningful = m.ok + m.rateLimited + m.serverErrors + m.otherClient + m.networkErrors;
  const successRate = meaningful > 0 ? m.ok / meaningful : 1;
  return {
    ...m,
    meaningful,
    successRate, // 0..1 (ok / tentatives significatives, hors 404)
    uptimeMs: Date.now() - m.startedAt,
    ...extra,
  };
}

// Réinitialise les compteurs (tests).
export function resetMetrics() {
  m = freshState();
}
