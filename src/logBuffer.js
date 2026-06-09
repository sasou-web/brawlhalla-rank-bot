/**
 * Capture en mémoire des derniers logs console (pour la page "Logs en direct" du dashboard).
 * Intercepte console.log/warn/error et conserve un tampon circulaire des dernières lignes.
 */

const MAX_LINES = 400;
const lines = [];
let installed = false;

function stringifyArg(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function push(level, args) {
  const msg = args.map(stringifyArg).join(" ");
  lines.push({ ts: Date.now(), level, msg });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/** Active la capture (idempotent). À appeler le plus tôt possible au démarrage. */
export function installLogCapture() {
  if (installed) return;
  installed = true;
  for (const level of ["log", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        push(level, args);
      } catch {
        /* la capture ne doit jamais casser le log réel */
      }
      orig(...args);
    };
  }
}

/** Renvoie les dernières lignes capturées (les plus récentes en fin de tableau). */
export function getRecentLogs(limit = 200) {
  return lines.slice(-Math.max(1, Math.min(limit, MAX_LINES)));
}
