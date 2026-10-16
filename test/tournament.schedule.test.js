import test from "node:test";
import assert from "node:assert/strict";
import {
  nextOccurrence,
  dueActions,
  schedulesOverlap,
  normalizeSchedule,
  zonedParts,
  formatOccurrence,
  buildEventData,
} from "../src/tournamentScheduleRules.js";
import { createSchedule, updateSchedule, getSchedule, tickSchedules, runScheduleNow } from "../src/tournamentSchedule.js";
import { createTournament, getTournament, registerEntrant, checkInEntrant, archiveTournament } from "../src/tournament.js";
import { teardownTournament } from "../src/tournamentAutomation.js";

/**
 * Tournois récurrents : créneaux en heure de Paris (changements d'heure), ordre des actions
 * sans doublon, et occurrence complète sur le vrai store (base SQLite temporaire).
 */

const H = 3600 * 1000;
const MIN = 60 * 1000;
const at = (iso) => Date.parse(iso);
const friday21 = { weekday: 5, hour: 21, minute: 0, tz: "Europe/Paris" };

// ---------- nextOccurrence ----------

test("nextOccurrence : vendredi 21 h depuis un jeudi (heure d'été)", () => {
  assert.equal(nextOccurrence(friday21, at("2026-10-22T10:00:00Z")), at("2026-10-23T19:00:00Z"));
});

test("nextOccurrence : depuis vendredi 21 h 01 ou 21 h pile → semaine suivante, après le passage à l'heure d'hiver (25/10/2026)", () => {
  assert.equal(nextOccurrence(friday21, at("2026-10-23T19:01:00Z")), at("2026-10-30T20:00:00Z"));
  assert.equal(nextOccurrence(friday21, at("2026-10-23T19:00:00Z")), at("2026-10-30T20:00:00Z"));
  assert.equal(nextOccurrence(friday21, at("2026-10-23T18:59:00Z")), at("2026-10-23T19:00:00Z"));
});

test("nextOccurrence : autour du passage à l'heure d'été (29/03/2026)", () => {
  assert.equal(nextOccurrence(friday21, at("2026-03-26T11:00:00Z")), at("2026-03-27T20:00:00Z"), "21 h CET = 20 h UTC");
  assert.equal(nextOccurrence(friday21, at("2026-03-28T11:00:00Z")), at("2026-04-03T19:00:00Z"), "21 h CEST = 19 h UTC");
  const sunday = { weekday: 0, hour: 21, minute: 0 };
  assert.equal(nextOccurrence(sunday, at("2026-03-28T11:00:00Z")), at("2026-03-29T19:00:00Z"), "le jour même du changement");
  assert.equal(nextOccurrence(sunday, at("2026-10-24T11:00:00Z")), at("2026-10-25T20:00:00Z"));
});

test("nextOccurrence : heure inexistante ou en double le jour du changement d'heure", () => {
  // 02:30 n'existe pas le 29/03/2026 : décalée d'une heure (03:30 CEST).
  const missing = nextOccurrence({ weekday: 0, hour: 2, minute: 30 }, at("2026-03-28T12:00:00Z"));
  assert.equal(missing, at("2026-03-29T01:30:00Z"));
  // 02:30 existe deux fois le 25/10/2026 : une seule occurrence, bien à 02:30 heure de Paris.
  const twice = nextOccurrence({ weekday: 0, hour: 2, minute: 30 }, at("2026-10-24T12:00:00Z"));
  const p = zonedParts(twice, "Europe/Paris");
  assert.deepEqual([p.day, p.month, p.hour, p.minute], [25, 10, 2, 30]);
});

test("nextOccurrence : passage de mois et d'année", () => {
  assert.equal(nextOccurrence(friday21, at("2026-12-30T12:00:00Z")), at("2027-01-01T20:00:00Z"));
});

test("formatOccurrence : date lisible en heure de Paris", () => {
  assert.equal(formatOccurrence(at("2026-10-23T19:00:00Z")), "vendredi 23 octobre à 21:00");
});

// ---------- dueActions ----------

const T = at("2026-10-23T19:00:00Z");
const sched = (extra = {}) => ({ id: "s1", enabled: true, openHoursBefore: 48, checkinMinutesBefore: 30, nextRunAt: T, lastFired: {}, ...extra });
const ours = (extra = {}) => ({ name: "Friday", status: "registration", checkInEnabled: true, participants: [], scheduleId: "s1", scheduleRunAt: T, ...extra });

test("dueActions : rien avant l'ouverture, puis open une seule fois", () => {
  assert.deepEqual(dueActions(sched(), T - 49 * H, null), []);
  assert.deepEqual(dueActions(sched(), T - 48 * H, null), ["open"]);
  const opened = sched({ lastFired: { open: T } });
  for (const now of [T - 48 * H, T - 47 * H, T - 31 * MIN]) assert.deepEqual(dueActions(opened, now, ours()), [], "jamais rouvert");
});

test("dueActions : checkin puis start dans l'ordre, puis créneau suivant", () => {
  let s = sched({ lastFired: { open: T } });
  assert.deepEqual(dueActions(s, T - 30 * MIN, ours()), ["checkin"]);
  assert.deepEqual(dueActions(s, T + 5 * MIN, ours()), ["checkin"], "le check-in passe avant le début, même en retard");
  s = sched({ lastFired: { open: T, checkin: T, checkinAt: T - 30 * MIN } });
  assert.deepEqual(dueActions(s, T - 29 * MIN, ours({ status: "checkin" })), []);
  assert.deepEqual(dueActions(s, T, ours({ status: "checkin" })), ["start"]);
  s = sched({ lastFired: { open: T, checkin: T, checkinAt: T - 30 * MIN, start: T } });
  assert.deepEqual(dueActions(s, T + MIN, ours({ status: "running" })), ["advance"]);
});

test("dueActions : sans check-in, start directement à l'heure", () => {
  const s = sched({ lastFired: { open: T } });
  const t = ours({ checkInEnabled: false });
  assert.deepEqual(dueActions(s, T - 30 * MIN, t), []);
  assert.deepEqual(dueActions(s, T, t), ["start"]);
});

test("dueActions : check-in ouvert en retard → les joueurs gardent toute la fenêtre", () => {
  const s = sched({ lastFired: { open: T, checkin: T, checkinAt: T + 10 * MIN } });
  assert.deepEqual(dueActions(s, T + 39 * MIN, ours({ status: "checkin" })), []);
  assert.deepEqual(dueActions(s, T + 40 * MIN, ours({ status: "checkin" })), ["start"]);
});

test("dueActions : rien si un tournoi étranger est en cours", () => {
  const foreign = { name: "Tournoi manuel", status: "registration", checkInEnabled: true, participants: [] };
  // Avant l'ouverture : on n'écrase pas, on signale (skip = alerte + créneau suivant).
  assert.deepEqual(dueActions(sched(), T - 47 * H, foreign), ["skip"]);
  // Après l'ouverture, le tournoi du modèle a été remplacé par le staff : on n'y touche pas.
  const s = sched({ lastFired: { open: T } });
  assert.deepEqual(dueActions(s, T - 30 * MIN, foreign), []);
  assert.deepEqual(dueActions(s, T - MIN, null), []);
  assert.deepEqual(dueActions(s, T, foreign), ["advance"]);
  // Même modèle mais autre occurrence (tournoi de la semaine précédente encore là).
  assert.deepEqual(dueActions(s, T - 30 * MIN, ours({ scheduleRunAt: T - 7 * 24 * H })), []);
});

test("dueActions : fenêtre manquée (bot hors ligne) et modèle désactivé", () => {
  assert.deepEqual(dueActions(sched(), T + MIN, null), ["missed"]);
  assert.deepEqual(dueActions(sched({ enabled: false }), T - 47 * H, null), [], "désactivé : rien ne s'ouvre");
  assert.deepEqual(dueActions(sched({ enabled: false, lastFired: { open: T } }), T - 30 * MIN, ours()), ["checkin"], "l'occurrence ouverte va au bout");
  assert.deepEqual(dueActions(sched({ nextRunAt: 0 }), T, null), []);
});

// ---------- Chevauchements et validation ----------

test("schedulesOverlap : un seul tournoi à la fois", () => {
  const s = (weekday, hour, openHoursBefore = 48) => ({ weekday, hour, minute: 0, openHoursBefore });
  assert.equal(schedulesOverlap(s(5, 21), s(5, 23, 1)), true, "même soir");
  assert.equal(schedulesOverlap(s(5, 21), s(6, 21)), true, "inscriptions du samedi pendant le vendredi");
  assert.equal(schedulesOverlap(s(5, 21), s(1, 21)), false, "vendredi et lundi");
  assert.equal(schedulesOverlap(s(5, 21, 2), s(6, 21, 2)), false);
  assert.equal(schedulesOverlap(s(0, 1, 2), s(6, 22, 1)), true, "chevauchement autour de minuit dimanche");
});

test("normalizeSchedule : champs requis, bornes et clés du template", () => {
  const base = { name: "Friday 1v1", template: { signupChannelId: "123" } };
  assert.match(normalizeSchedule({ ...base, name: "  " }).error, /nom/);
  assert.match(normalizeSchedule({ ...base, template: {} }).error, /salon d'inscription/);
  assert.match(normalizeSchedule({ ...base, openHoursBefore: 1, checkinMinutesBefore: 60 }).error, /après les inscriptions/);
  assert.match(normalizeSchedule({ ...base, hour: 24 }).error, /Heure/);
  const v = normalizeSchedule({ ...base, tz: "America/New_York", nextRunAt: 5, template: { signupChannelId: "123", maxParticipants: 999, format: "3v3", participants: [1], forfeitMinutes: 3, castFromTopN: 6, modRoleId: "<@&1>" } });
  assert.equal(v.ok, true);
  assert.equal(v.value.tz, "Europe/Paris", "fuseau fixe");
  assert.equal("nextRunAt" in v.value, false, "géré par le bot");
  assert.deepEqual(v.value.template, { signupChannelId: "123", maxParticipants: 256, format: "1v1", castFromTopN: 0, modRoleId: "" });
});

test("buildEventData : événement externe de 3 h dans le salon d'inscription", () => {
  const d = buildEventData({ name: "Friday 1v1", checkinMinutesBefore: 30 }, { format: "1v1", bestOf: 3, finalsBestOf: 5, maxParticipants: 16, checkInEnabled: true, prizeText: "Nitro" }, T, { locationName: "inscriptions", privacyLevel: 2, entityType: 3 });
  assert.equal(d.scheduledStartTime.getTime(), T);
  assert.equal(d.scheduledEndTime.getTime(), T + 3 * H);
  assert.deepEqual(d.entityMetadata, { location: "#inscriptions" });
  assert.equal(d.entityType, 3);
  assert.match(d.description, /Check-in 30 min/);
  assert.match(d.description, /Nitro/);
});

// ---------- Vrai store : occurrence complète ----------

function fakeDiscord(guildId) {
  const sent = [];
  const events = [];
  const eventOps = [];
  const channel = (id) => ({
    id,
    name: id === "1001" ? "inscriptions" : id,
    guildId,
    isTextBased: () => true,
    send: async (payload) => {
      sent.push({ channelId: id, payload });
      return { id: `msg-${sent.length}` };
    },
    messages: { fetch: async () => ({ edit: async () => {} }) },
  });
  const client = { channels: { fetch: async (id) => channel(id) } };
  const guild = {
    id: guildId,
    members: { me: { permissions: { has: () => true } } },
    channels: { fetch: async (id) => channel(id) },
    scheduledEvents: {
      create: async (data) => {
        events.push(data);
        return { id: `ev-${events.length}` };
      },
      fetch: async (id) => ({
        id,
        status: 1, // Scheduled : jamais démarré
        delete: async () => eventOps.push(["delete", id]),
        setStatus: async (st) => eventOps.push(["status", id, st]),
      }),
    },
  };
  return { client, guild, sent, events, eventOps };
}

const TEMPLATE = {
  format: "1v1",
  region: "EU",
  maxParticipants: 8,
  bestOf: 3,
  finalsBestOf: 5,
  rulesText: "Stock 3 vies",
  checkInEnabled: true,
  signupChannelId: "1001",
  announceChannelId: "1002",
  modAlertChannelId: "1003",
};
const MONDAY = at("2026-10-19T10:00:00Z");

test("occurrence complète : ouverture depuis le modèle, check-in, bracket, sans aucun doublon", async () => {
  const G = "g_sched_full";
  const d = fakeDiscord(G);
  const s = await createSchedule(G, { name: "Friday 1v1", ...friday21, template: TEMPLATE }, MONDAY);
  assert.equal(s.nextRunAt, T);

  await tickSchedules(d.client, d.guild, MONDAY);
  assert.equal(await getTournament(G), null, "trop tôt");

  // Mercredi 21 h : ouverture (deux ticks, une seule ouverture).
  await tickSchedules(d.client, d.guild, T - 48 * H);
  await tickSchedules(d.client, d.guild, T - 48 * H + MIN);
  let t = await getTournament(G);
  assert.equal(t.status, "registration");
  assert.equal(t.name, "Friday 1v1");
  for (const [k, v] of Object.entries(TEMPLATE)) assert.equal(t[k], v, `clé ${k} reprise du modèle`);
  assert.equal(t.startTime, "vendredi 23 octobre à 21:00");
  assert.equal(t.scheduleId, s.id);
  assert.equal(t.scheduleRunAt, T);
  assert.equal(t.signupMessageId, "msg-1", "panneau publié");
  assert.equal(t.scheduledEventId, "ev-1");
  assert.equal(d.events.length, 1, "un seul événement Discord");
  assert.equal(d.events[0].scheduledStartTime.getTime(), T);
  assert.equal(d.sent.filter((m) => m.channelId === "1002").length, 1, "une seule annonce d'ouverture");
  assert.equal((await getSchedule(G, s.id)).lastFired.open, T);

  await registerEntrant(G, { members: ["u1"], name: "P1" });
  await registerEntrant(G, { members: ["u2"], name: "P2" });
  await registerEntrant(G, { members: ["u3"], name: "P3" });

  // Check-in à 20 h 30.
  await tickSchedules(d.client, d.guild, T - 31 * MIN);
  assert.equal((await getTournament(G)).status, "registration");
  await tickSchedules(d.client, d.guild, T - 30 * MIN);
  await tickSchedules(d.client, d.guild, T - 29 * MIN);
  assert.equal((await getTournament(G)).status, "checkin");
  assert.equal(d.sent.filter((m) => m.channelId === "1002").length, 2, "une seule annonce de check-in");
  await checkInEntrant(G, "u1");
  await checkInEntrant(G, "u2");

  // 21 h : bracket avec les 2 joueurs check-in, puis créneau suivant.
  await tickSchedules(d.client, d.guild, T);
  t = await getTournament(G);
  assert.equal(t.status, "running");
  assert.equal(t.rounds, 1);
  assert.equal((await getSchedule(G, s.id)).nextRunAt, at("2026-10-30T20:00:00Z"));
  assert.deepEqual(d.eventOps, [["status", "ev-1", 2]], "événement Discord passé en cours");
  await tickSchedules(d.client, d.guild, T + MIN);
  assert.equal(d.sent.filter((m) => m.channelId === "1002").length, 3, "une seule annonce de bracket");
});

test("pas assez d'inscrits à l'heure du début : alerte staff, tournoi laissé en check-in", async () => {
  const G = "g_sched_few";
  const d = fakeDiscord(G);
  await createSchedule(G, { name: "Friday 1v1", ...friday21, template: TEMPLATE }, MONDAY);
  await tickSchedules(d.client, d.guild, T - 47 * H);
  await registerEntrant(G, { members: ["u1"], name: "P1" });
  await tickSchedules(d.client, d.guild, T - 30 * MIN);
  await checkInEntrant(G, "u1");
  await tickSchedules(d.client, d.guild, T);
  assert.equal((await getTournament(G)).status, "checkin", "pas d'archivage automatique");
  const alerts = d.sent.filter((m) => m.channelId === "1003");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].payload.embeds[0].description, /1 joueur\(s\) éligible\(s\)/);
});

test("un tournoi existe déjà à l'ouverture : rien d'écrasé, alerte unique, créneau suivant", async () => {
  const G = "g_sched_busy";
  const d = fakeDiscord(G);
  const s = await createSchedule(G, { name: "Friday 1v1", ...friday21, template: TEMPLATE }, MONDAY);
  await createTournament(G, { name: "Tournoi manuel" });
  await tickSchedules(d.client, d.guild, T - 47 * H);
  await tickSchedules(d.client, d.guild, T - 46 * H);
  assert.equal((await getTournament(G)).name, "Tournoi manuel");
  assert.equal(d.sent.filter((m) => m.channelId === "1003").length, 1);
  assert.equal((await getSchedule(G, s.id)).nextRunAt, at("2026-10-30T20:00:00Z"));
  await assert.rejects(runScheduleNow(d.client, d.guild, s.id, T - 46 * H), /existe déjà/);
});

test("archivage avant le début : événement Discord supprimé, modèle passé au créneau suivant", async () => {
  const G = "g_sched_archive";
  const d = fakeDiscord(G);
  const s = await createSchedule(G, { name: "Friday 1v1", ...friday21, template: TEMPLATE }, MONDAY);
  await tickSchedules(d.client, d.guild, T - 47 * H);
  const t = await getTournament(G);
  await archiveTournament(G);
  await teardownTournament(d.guild, t);
  assert.deepEqual(d.eventOps, [["delete", "ev-1"]]);
  const after = await getSchedule(G, s.id);
  assert.equal(after.nextRunAt, at("2026-10-30T20:00:00Z"));
  assert.equal(after.eventId, "");
  await tickSchedules(d.client, d.guild, T - 46 * H);
  assert.equal(await getTournament(G), null, "l'occurrence archivée ne se rouvre pas");
});

test("modification d'un modèle : chevauchement refusé, occurrence en cours conservée", async () => {
  const G = "g_sched_update";
  const d = fakeDiscord(G);
  const a = await createSchedule(G, { name: "Friday 1v1", ...friday21, template: TEMPLATE }, MONDAY);
  await assert.rejects(createSchedule(G, { name: "Friday 2v2", ...friday21, hour: 23, template: TEMPLATE }, MONDAY), /Chevauchement avec « Friday 1v1 »/);
  const b = await createSchedule(G, { name: "Monday 2v2", weekday: 1, hour: 21, minute: 0, openHoursBefore: 24, template: TEMPLATE }, MONDAY);
  assert.equal(b.nextRunAt, at("2026-10-19T19:00:00Z"));
  await assert.rejects(updateSchedule(G, b.id, { weekday: 5, hour: 23 }, MONDAY), /Chevauchement/);
  await updateSchedule(G, b.id, { enabled: false }, MONDAY);
  assert.equal((await getSchedule(G, b.id)).nextRunAt, 0, "désactivé : plus rien de prévu");

  await tickSchedules(d.client, d.guild, T - 47 * H);
  const moved = await updateSchedule(G, a.id, { weekday: 6 }, T - 46 * H);
  assert.equal(moved.nextRunAt, T, "l'occurrence ouverte garde ses horaires");
});
