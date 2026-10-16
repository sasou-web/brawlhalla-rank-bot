/**
 * Tournois récurrents : règles PURES (aucun import Discord ni base, importé aussi par
 * scripts/dash-mock.js). Le stockage et l'automatisation sont dans tournamentSchedule.js.
 *
 * Un modèle décrit un créneau hebdomadaire en heure locale `tz` (weekday : 0 = dimanche …
 * 6 = samedi, comme Date#getDay). `nextRunAt` = heure de début (timestamp) de l'occurrence
 * visée ; `lastFired.open|checkin|start` = l'occurrence (`nextRunAt`) pour laquelle l'action a
 * déjà été tirée, ce qui garantit qu'aucune action ne part deux fois, même après un redémarrage.
 */

export const SCHEDULE_TZ = "Europe/Paris";
export const EVENT_DURATION_MS = 3 * 3600 * 1000; // durée affichée de l'événement Discord

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const WEEK_MINUTES = 7 * 24 * 60;

// Clés du tournoi reprises du modèle (= TOURNAMENT_KEYS du dashboard, sans name ni startTime,
// gérés par le modèle lui-même).
export const TEMPLATE_KEYS = [
  "format",
  "region",
  "maxParticipants",
  "bestOf",
  "finalsBestOf",
  "rulesText",
  "prizeText",
  "mapPool",
  "checkInEnabled",
  "signupChannelId",
  "announceChannelId",
  "participantRoleId",
  "pingRoleId",
  "matchCategoryId",
  "modRoleId",
  "modAlertChannelId",
  "createVoice",
  "alertMinutes",
  "castFromTopN",
  "hallOfFameChannelId",
];

const ID_KEYS = new Set(["signupChannelId", "announceChannelId", "participantRoleId", "pingRoleId", "matchCategoryId", "modRoleId", "modAlertChannelId", "hallOfFameChannelId"]);
const TEXT_LIMITS = { region: 12, rulesText: 1000, prizeText: 200, mapPool: 300 };
const INT_RANGES = { maxParticipants: [2, 256], bestOf: [1, 9], finalsBestOf: [1, 9], alertMinutes: [1, 60] };
const CAST_VALUES = [0, 4, 8, 16, 32];

export const DEFAULT_SCHEDULE = {
  enabled: true,
  name: "Tournoi hebdo",
  template: {},
  weekday: 5,
  hour: 21,
  minute: 0,
  tz: SCHEDULE_TZ,
  openHoursBefore: 48,
  checkinMinutesBefore: 30,
  autoBracket: true,
  createEvent: true,
  nextRunAt: 0,
  lastFired: { open: 0, checkin: 0, start: 0 },
  eventId: "",
};

export const WEEKDAY_LABELS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// ---------- Fuseau horaire (Intl : ICU complet en Node 20) ----------

const FORMATTERS = new Map();
function partsFormatter(tz) {
  if (!FORMATTERS.has(tz)) {
    FORMATTERS.set(
      tz,
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }),
    );
  }
  return FORMATTERS.get(tz);
}
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Date et heure murales de `ts` dans le fuseau `tz`.
export function zonedParts(ts, tz = SCHEDULE_TZ) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ts))) p[type] = value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: WEEKDAY_INDEX[p.weekday] };
}

// Décalage (ms) du fuseau par rapport à UTC à l'instant `ts` (ex. +2 h l'été à Paris).
function tzOffset(ts, tz) {
  const p = zonedParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

// Heure murale (jour J, hh:mm dans `tz`) → timestamp UTC. Deux passes pour les changements
// d'heure : une heure qui n'existe pas (passage à l'heure d'été) est décalée d'une heure,
// une heure en double (passage à l'heure d'hiver) prend la seconde.
export function zonedTime(year, month, day, hour, minute, tz = SCHEDULE_TZ) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - tzOffset(wall, tz);
  return wall - tzOffset(first, tz);
}

/** Prochaine occurrence du créneau STRICTEMENT après `now` (timestamp). */
export function nextOccurrence(schedule, now) {
  const tz = schedule.tz || SCHEDULE_TZ;
  const today = zonedParts(now, tz);
  const delta = (((Number(schedule.weekday) - today.weekday) % 7) + 7) % 7;
  for (let week = 0; week < 3; week++) {
    // Date.UTC normalise le débordement de jours (31 + 2 → 2 du mois suivant).
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + delta + 7 * week));
    const ts = zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), Number(schedule.hour), Number(schedule.minute), tz);
    if (ts > now) return ts;
  }
  return 0; // inatteignable pour un créneau valide
}

const DATE_FMT = new Map();
/** « vendredi 23 octobre à 21:00 » (heure de `tz`). */
export function formatOccurrence(ts, tz = SCHEDULE_TZ) {
  if (!DATE_FMT.has(tz)) {
    DATE_FMT.set(tz, new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }));
  }
  return DATE_FMT.get(tz).format(new Date(ts));
}

/** Horaires de l'occurrence visée : ouverture des inscriptions, check-in, début. */
export function occurrenceTimes(schedule) {
  const startAt = Number(schedule.nextRunAt) || 0;
  if (!startAt) return { openAt: 0, checkinAt: 0, startAt: 0 };
  return {
    openAt: startAt - schedule.openHoursBefore * HOUR,
    checkinAt: startAt - schedule.checkinMinutesBefore * MINUTE,
    startAt,
  };
}

// ---------- Décision du tick ----------

/** Le tournoi courant est-il celui que ce modèle a ouvert pour son occurrence visée ? */
export function isOccurrenceTournament(schedule, tournament) {
  return !!tournament && !!schedule.nextRunAt && tournament.scheduleId === schedule.id && tournament.scheduleRunAt === schedule.nextRunAt;
}

/**
 * Action à mener maintenant pour un modèle (au plus une par tick, dans l'ordre) :
 * - "open"    : ouvrir les inscriptions de l'occurrence ;
 * - "skip"    : l'ouverture est due mais un autre tournoi existe → alerte staff, créneau suivant ;
 * - "missed"  : la fenêtre d'inscription est passée sans ouverture (bot hors ligne) → créneau suivant ;
 * - "checkin" : ouvrir le check-in (si le tournoi l'a activé) ;
 * - "start"   : heure du début → bracket automatique ou alerte staff ;
 * - "advance" : occurrence terminée, ou reprise en main par le staff (tournoi supprimé ou
 *               remplacé) → passer au créneau suivant sans rien toucher.
 * Un tournoi qui n'est pas celui de l'occurrence n'est JAMAIS modifié.
 * Modèle désactivé : rien de nouveau ne s'ouvre, mais l'occurrence déjà ouverte va au bout.
 */
export function dueActions(schedule, now, current) {
  const T = Number(schedule?.nextRunAt) || 0;
  if (!T) return [];
  const fired = schedule.lastFired || {};

  if (fired.open !== T) {
    if (!schedule.enabled || now < T - schedule.openHoursBefore * HOUR) return [];
    if (now >= T) return ["missed"];
    return current ? ["skip"] : ["open"];
  }

  if (!isOccurrenceTournament(schedule, current)) return now >= T ? ["advance"] : [];

  if (current.checkInEnabled && fired.checkin !== T) {
    return now >= T - schedule.checkinMinutesBefore * MINUTE ? ["checkin"] : [];
  }
  if (fired.start !== T) {
    // Check-in ouvert en retard (bot hors ligne) : les joueurs gardent toute la fenêtre prévue.
    const checkinEnd = current.checkInEnabled ? (Number(fired.checkinAt) || 0) + schedule.checkinMinutesBefore * MINUTE : 0;
    return now >= Math.max(T, checkinEnd) ? ["start"] : [];
  }
  return ["advance"];
}

/** Créneau suivant à viser après l'occurrence `nextRunAt` (0 si le modèle est désactivé). */
export function followingRunAt(schedule, now) {
  if (!schedule.enabled) return 0;
  return nextOccurrence(schedule, Math.max(now, Number(schedule.nextRunAt) || 0));
}

// ---------- Chevauchements ----------

// Fenêtre hebdomadaire occupée par un modèle (minutes depuis dimanche 0 h) : de l'ouverture
// des inscriptions à la fin prévue du tournoi. Un seul tournoi existe à la fois par serveur.
function weeklyWindow(s) {
  const slot = Number(s.weekday) * 1440 + Number(s.hour) * 60 + Number(s.minute);
  const before = Number(s.openHoursBefore) * 60;
  return { start: (((slot - before) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES, length: before + EVENT_DURATION_MS / MINUTE };
}

/** Deux modèles se marchent-ils dessus (inscriptions de l'un pendant le tournoi de l'autre) ? */
export function schedulesOverlap(a, b) {
  const wa = weeklyWindow(a);
  const wb = weeklyWindow(b);
  const mod = (n) => ((n % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  return mod(wb.start - wa.start) < wa.length || mod(wa.start - wb.start) < wb.length;
}

// ---------- Validation ----------

function int(v, [min, max]) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Nettoie un template de tournoi : seules les clés de TEMPLATE_KEYS, typées et bornées. */
export function normalizeTemplate(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of TEMPLATE_KEYS) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (ID_KEYS.has(k)) out[k] = /^\d{1,25}$/.test(String(v ?? "")) ? String(v) : "";
    else if (k in TEXT_LIMITS) out[k] = String(v ?? "").trim().slice(0, TEXT_LIMITS[k]);
    else if (k in INT_RANGES) {
      const n = int(v, INT_RANGES[k]);
      if (n !== null) out[k] = n;
    } else if (k === "format") out[k] = v === "2v2" ? "2v2" : "1v1";
    else if (k === "castFromTopN") out[k] = CAST_VALUES.includes(Number(v)) ? Number(v) : 0;
    else if (k === "checkInEnabled" || k === "createVoice") out[k] = !!v;
  }
  return out;
}

/**
 * Valide un modèle complet (création, ou fusion modèle existant + modification).
 * Les champs gérés par le bot (id, nextRunAt, lastFired, eventId) ne viennent jamais de `input`.
 * Renvoie { ok: true, value } ou { ok: false, error } (message pour l'admin).
 */
export function normalizeSchedule(input, base = DEFAULT_SCHEDULE) {
  const src = { ...base, ...(input || {}) };
  const name = String(src.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, error: "Donne un nom au tournoi." };

  const weekday = Math.trunc(Number(src.weekday));
  const hour = Math.trunc(Number(src.hour));
  const minute = Math.trunc(Number(src.minute));
  if (!(weekday >= 0 && weekday <= 6)) return { ok: false, error: "Jour invalide." };
  if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) return { ok: false, error: "Heure invalide." };

  const openHoursBefore = Math.trunc(Number(src.openHoursBefore));
  if (!(openHoursBefore >= 1 && openHoursBefore <= 144)) return { ok: false, error: "Les inscriptions doivent ouvrir entre 1 h et 144 h (6 jours) avant le début." };
  const checkinMinutesBefore = Math.trunc(Number(src.checkinMinutesBefore));
  if (!(checkinMinutesBefore >= 5 && checkinMinutesBefore <= 720)) return { ok: false, error: "Le check-in doit ouvrir entre 5 et 720 min avant le début." };
  if (checkinMinutesBefore >= openHoursBefore * 60) return { ok: false, error: "Le check-in doit ouvrir après les inscriptions." };

  const template = { ...normalizeTemplate(base.template), ...normalizeTemplate(input?.template) };
  if (!template.signupChannelId) return { ok: false, error: "Choisis le salon d'inscription : sans lui, personne ne peut s'inscrire." };

  return {
    ok: true,
    value: {
      enabled: !!src.enabled,
      name,
      template,
      weekday,
      hour,
      minute,
      tz: SCHEDULE_TZ, // fuseau fixe : le serveur joue à l'heure de Paris
      openHoursBefore,
      checkinMinutesBefore,
      autoBracket: !!src.autoBracket,
      createEvent: !!src.createEvent,
    },
  };
}

// ---------- Événement Discord ----------

/**
 * Données de `guild.scheduledEvents.create` pour une occurrence (événement externe, un par
 * occurrence). Les énumérations discord.js sont passées par l'appelant (module pur).
 */
export function buildEventData(schedule, tournament, startAt, { locationName = "", privacyLevel, entityType } = {}) {
  const t = tournament || {};
  const lines = [`${t.format || "1v1"} · BO${t.bestOf || 3} · finale BO${t.finalsBestOf || 5} · ${t.maxParticipants || 16} places${t.region ? ` · ${t.region}` : ""}`];
  if (t.checkInEnabled) lines.push(`Check-in ${schedule.checkinMinutesBefore} min avant le début.`);
  if (t.rulesText) lines.push(`Règles : ${t.rulesText}`);
  if (t.prizeText) lines.push(`Récompenses : ${t.prizeText}`);
  lines.push(locationName ? `Inscriptions dans #${locationName}.` : "Inscriptions sur le serveur.");
  return {
    name: String(schedule.name || t.name || "Tournoi").slice(0, 100),
    description: lines.join("\n").slice(0, 1000),
    scheduledStartTime: new Date(startAt),
    scheduledEndTime: new Date(startAt + EVENT_DURATION_MS),
    privacyLevel,
    entityType,
    entityMetadata: { location: (locationName ? `#${locationName}` : "Discord").slice(0, 100) },
    reason: "Tournoi récurrent",
  };
}
