import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus, PermissionFlagsBits } from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import { getTournament, createTournament, updateTournament, generateBracket } from "./tournament.js";
import { buildRegistrationAnnounce, buildCheckinAnnounce, buildBracketAnnounce, tournamentAnnouncePayload, refreshSignupPanel, publishSignupPanel } from "./tournamentUI.js";
import {
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  schedulesOverlap,
  nextOccurrence,
  followingRunAt,
  dueActions,
  formatOccurrence,
  buildEventData,
} from "./tournamentScheduleRules.js";

/**
 * Tournois récurrents (« modèles ») : le bot ouvre les inscriptions, passe en check-in et lance
 * le bracket tout seul chaque semaine, avec un événement planifié Discord par occurrence.
 * Règles pures (créneaux, ordre des actions, validation) : tournamentScheduleRules.js.
 *
 * Doc kv `tournament_schedule` (séparé du doc `tournament`, très écrit) :
 *   { guilds: { [guildId]: { schedules: { [id]: modèle } } } }
 * Le tournoi ouvert par un modèle porte `scheduleId`, `scheduleRunAt` (occurrence) et
 * `scheduledEventId` (événement Discord) : rien d'autre n'est jamais touché par l'automatisation.
 *
 * Point d'entrée : `tickSchedules(client, guild)`, appelé par `tournamentTick` (toutes les 60 s).
 */

const KEY = "tournament_schedule";
let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function doWrite() {
  saveDoc(KEY, cache);
}
function save() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

function guildSchedules(guildId) {
  const c = load();
  if (!c.guilds[guildId]) c.guilds[guildId] = {};
  if (!c.guilds[guildId].schedules) c.guilds[guildId].schedules = {};
  return c.guilds[guildId].schedules;
}

function scheduleId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const clone = (s) => structuredClone(s);

export async function listSchedules(guildId) {
  return Object.values(guildSchedules(guildId)).map(clone);
}

export async function getSchedule(guildId, id) {
  const s = guildSchedules(guildId)[id];
  return s ? clone(s) : null;
}

// Un seul tournoi existe à la fois : deux modèles actifs ne doivent pas se recouvrir.
function assertNoOverlap(guildId, candidate, selfId = null) {
  if (!candidate.enabled) return;
  for (const other of Object.values(guildSchedules(guildId))) {
    if (other.id === selfId || !other.enabled) continue;
    if (schedulesOverlap(candidate, other)) {
      throw new Error(
        `Chevauchement avec « ${other.name} » : un seul tournoi peut exister à la fois, et ses inscriptions ou son tournoi tomberaient pendant celui-ci. Décale le créneau ou réduis l'ouverture des inscriptions.`,
      );
    }
  }
}

export async function createSchedule(guildId, input, now = Date.now()) {
  const v = normalizeSchedule(input, DEFAULT_SCHEDULE);
  if (!v.ok) throw new Error(v.error);
  assertNoOverlap(guildId, v.value);
  const s = { ...DEFAULT_SCHEDULE, ...v.value, id: scheduleId(), lastFired: { open: 0, checkin: 0, start: 0 }, eventId: "", createdAt: now };
  s.nextRunAt = s.enabled ? nextOccurrence(s, now) : 0;
  guildSchedules(guildId)[s.id] = s;
  await save();
  return clone(s);
}

export async function updateSchedule(guildId, id, patch, now = Date.now()) {
  const s = guildSchedules(guildId)[id];
  if (!s) throw new Error("Modèle introuvable.");
  const v = normalizeSchedule(patch, s);
  if (!v.ok) throw new Error(v.error);
  assertNoOverlap(guildId, v.value, id);
  Object.assign(s, v.value);
  // Occurrence déjà ouverte : elle va au bout avec ses horaires, le nouveau créneau vaut pour
  // la suivante. Sinon on revise la date visée (désactivé → plus rien de prévu).
  const inProgress = s.nextRunAt && s.lastFired?.open === s.nextRunAt;
  if (!inProgress) s.nextRunAt = s.enabled ? nextOccurrence(s, now) : 0;
  await save();
  return clone(s);
}

// Le tournoi en cours éventuel continue : il n'est plus piloté, l'événement Discord est
// toujours fermé à son archivage (son id est sur le tournoi).
export async function deleteSchedule(guildId, id) {
  const all = guildSchedules(guildId);
  if (!all[id]) throw new Error("Modèle introuvable.");
  delete all[id];
  await save();
}

// Mutation interne d'un modèle (synchrone sur le cache, donc atomique entre deux ticks).
function mutate(guildId, id, fn) {
  const s = guildSchedules(guildId)[id];
  if (!s) return null;
  fn(s);
  return s;
}

// Marque une action comme tirée pour l'occurrence T AVANT ses effets : un tick qui chevauche le
// précédent, ou « Ouvrir maintenant » pendant un tick, ne la rejoue jamais. false si déjà tirée.
function claim(guildId, id, action, T, now) {
  let ok = false;
  mutate(guildId, id, (s) => {
    if (s.nextRunAt !== T) return;
    s.lastFired = { ...(s.lastFired || {}) };
    if (s.lastFired[action] === T) return;
    s.lastFired[action] = T;
    if (action === "checkin") s.lastFired.checkinAt = now;
    ok = true;
  });
  return ok;
}

// Passe au créneau suivant (0 si le modèle est désactivé).
function advance(guildId, id, now) {
  return mutate(guildId, id, (s) => {
    s.nextRunAt = followingRunAt(s, now);
  });
}

// ---------- Discord ----------

async function alertStaff(guild, tpl, text) {
  console.warn(text);
  if (!tpl?.modAlertChannelId) return;
  const ch = await guild.channels.fetch(tpl.modAlertChannelId).catch(() => null);
  if (!ch?.isTextBased?.() || ch.guildId !== guild.id) return;
  const ping = tpl.modRoleId ? `<@&${tpl.modRoleId}> ` : "";
  await ch
    .send({
      content: ping || undefined,
      embeds: [{ title: "🗓️ Tournoi récurrent", description: text.slice(0, 4096), color: 0xf39c12 }],
      allowedMentions: { roles: tpl.modRoleId ? [tpl.modRoleId] : [] },
    })
    .catch(() => {});
}

/** Le bot peut-il créer des événements ? (CREATE_EVENTS exigé depuis le 23/02/2026) */
export async function canCreateEvents(guild) {
  const me = guild.members?.me || (await guild.members?.fetchMe?.().catch(() => null));
  return !!me?.permissions?.has?.(PermissionFlagsBits.CreateEvents);
}

// Crée l'événement Discord de l'occurrence. Sans permission ou en cas d'échec : log, et le
// tournoi suit son cours normalement. Renvoie l'id de l'événement ou "".
async function createOccurrenceEvent(guild, schedule, t, startAt) {
  if (!(await canCreateEvents(guild))) {
    console.warn(`Tournoi récurrent « ${schedule.name} » : événement Discord non créé (permission « Créer des événements » manquante).`);
    return "";
  }
  const ch = t.signupChannelId ? await guild.channels.fetch(t.signupChannelId).catch(() => null) : null;
  const data = buildEventData(schedule, t, startAt, {
    locationName: ch?.name || "",
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
  });
  try {
    const ev = await guild.scheduledEvents.create(data);
    return ev.id;
  } catch (err) {
    console.warn(`Tournoi récurrent « ${schedule.name} » : événement Discord non créé :`, err.message);
    return "";
  }
}

/**
 * Fin d'un tournoi (archivage ou suppression, via teardownTournament) : ferme son événement
 * Discord (« Terminé » s'il a démarré, supprimé s'il n'a jamais commencé ; Discord démarre et
 * termine seul un événement externe à ses horaires) et, si l'occurrence n'était pas allée au
 * bout, passe le modèle au créneau suivant. Best-effort.
 */
export async function closeScheduledOccurrence(guild, t, now = Date.now()) {
  if (!guild || !t) return;
  if (t.scheduledEventId && guild.scheduledEvents) {
    const ev = await guild.scheduledEvents.fetch(t.scheduledEventId).catch(() => null);
    if (ev?.status === GuildScheduledEventStatus.Active) await ev.setStatus(GuildScheduledEventStatus.Completed, "Tournoi terminé").catch(() => {});
    else if (ev?.status === GuildScheduledEventStatus.Scheduled) await ev.delete().catch(() => {});
  }
  if (!t.scheduleId) return;
  const s = mutate(guild.id, t.scheduleId, (sch) => {
    if (t.scheduledEventId && sch.eventId === t.scheduledEventId) sch.eventId = "";
    if (sch.nextRunAt && sch.nextRunAt === t.scheduleRunAt) sch.nextRunAt = followingRunAt(sch, now);
  });
  if (s) await save();
}

// ---------- Actions ----------

// Ouvre les inscriptions de l'occurrence T : tournoi créé depuis le modèle, panneau publié,
// annonce, puis événement Discord.
async function openOccurrence(client, guild, s, T, now) {
  if (!claim(guild.id, s.id, "open", T, now)) return null;
  await save();
  // Un tournoi créé à la main pendant l'écriture ne doit pas être écrasé (aucune E/S entre ce
  // test et la création : rien ne peut s'intercaler).
  const existing = await getTournament(guild.id);
  if (existing) {
    advance(guild.id, s.id, now);
    await save();
    await alertStaff(guild, s.template, `Tournoi récurrent « ${s.name} » du ${formatOccurrence(T, s.tz)} non ouvert : un tournoi est déjà en cours (« ${existing.name} »).`);
    return null;
  }
  const startTime = formatOccurrence(T, s.tz);
  await createTournament(guild.id, { ...s.template, name: s.name, startTime, scheduleId: s.id, scheduleRunAt: T });
  const t = await updateTournament(guild.id, { status: "registration" });
  await publishSignupPanel(client, guild.id).catch((err) => console.warn(`Tournoi récurrent « ${s.name} » : panneau d'inscription non publié :`, err.message));
  await tournamentAnnouncePayload(client, guild.id, buildRegistrationAnnounce(t));
  if (s.createEvent) {
    const eventId = await createOccurrenceEvent(guild, s, t, T);
    if (eventId) {
      // Le tournoi a pu être supprimé entre-temps : l'événement serait alors orphelin.
      const cur = await getTournament(guild.id);
      if (cur?.scheduleId === s.id && cur.scheduleRunAt === T) await updateTournament(guild.id, { scheduledEventId: eventId });
      mutate(guild.id, s.id, (sch) => (sch.eventId = eventId));
      await save();
    }
  }
  console.log(`Tournoi récurrent « ${s.name} » : inscriptions ouvertes (début ${startTime}).`);
  return getTournament(guild.id);
}

async function runAction(client, guild, s, action, current, now) {
  const T = s.nextRunAt;
  const when = formatOccurrence(T, s.tz);
  if (action === "open") return openOccurrence(client, guild, s, T, now);

  if (action === "skip" || action === "missed") {
    if (!claim(guild.id, s.id, "open", T, now)) return;
    advance(guild.id, s.id, now);
    await save();
    const reason =
      action === "skip"
        ? `un tournoi est déjà en cours (« ${current?.name ?? "?"} »). Archive-le pour que le prochain s'ouvre.`
        : "le bot était hors ligne pendant toute la fenêtre d'inscription.";
    await alertStaff(guild, s.template, `Tournoi récurrent « ${s.name} » du ${when} non ouvert : ${reason}`);
    return;
  }

  if (action === "advance") {
    advance(guild.id, s.id, now);
    await save();
    return;
  }

  if (action === "checkin") {
    if (!claim(guild.id, s.id, "checkin", T, now)) return;
    await save();
    // Le staff a pu avancer le tournoi à la main : on ne revient jamais en arrière.
    if (current.status !== "registration") return;
    const t = await updateTournament(guild.id, { status: "checkin" });
    await refreshSignupPanel(client, guild.id);
    await tournamentAnnouncePayload(client, guild.id, buildCheckinAnnounce(t));
    console.log(`Tournoi récurrent « ${s.name} » : check-in ouvert.`);
    return;
  }

  if (action === "start") {
    if (!claim(guild.id, s.id, "start", T, now)) return;
    advance(guild.id, s.id, now);
    await save();
    if (!["registration", "checkin"].includes(current.status)) return; // déjà lancé par le staff
    const eligible = current.participants.filter((p) => !current.checkInEnabled || p.checkedIn).length;
    if (!s.autoBracket) {
      await alertStaff(guild, current, `Tournoi récurrent « ${s.name} » : c'est l'heure du début (${eligible} joueur(s) prêt(s)). Lance le bracket depuis le dashboard.`);
      return;
    }
    if (eligible < 2) {
      const step = current.status === "checkin" ? "check-in" : "inscriptions";
      await alertStaff(
        guild,
        current,
        `Tournoi récurrent « ${s.name} » : ${eligible} joueur(s) éligible(s) à l'heure du début, le bracket n'est pas lancé. Le tournoi reste en ${step} : à vous de décider (attendre, lancer ou archiver).`,
      );
      return;
    }
    try {
      const t = await generateBracket(guild.id);
      await refreshSignupPanel(client, guild.id);
      await tournamentAnnouncePayload(client, guild.id, buildBracketAnnounce(t));
      // Discord démarre seul un événement externe à son heure ; on le fait aussi au cas où il
      // serait en retard (déjà démarré : refus ignoré).
      if (t.scheduledEventId && guild.scheduledEvents) {
        const ev = await guild.scheduledEvents.fetch(t.scheduledEventId).catch(() => null);
        if (ev?.status === GuildScheduledEventStatus.Scheduled) await ev.setStatus(GuildScheduledEventStatus.Active, "Bracket lancé").catch(() => {});
      }
      console.log(`Tournoi récurrent « ${s.name} » : bracket lancé (${eligible} joueur(s)).`);
    } catch (err) {
      await alertStaff(guild, current, `Tournoi récurrent « ${s.name} » : bracket non lancé (${err.message}).`);
    }
  }
}

const ticking = new Set();

/** Tick des modèles du serveur : au plus une action par modèle, jamais deux ticks en parallèle. */
export async function tickSchedules(client, guild, now = Date.now()) {
  if (ticking.has(guild.id)) return;
  ticking.add(guild.id);
  try {
    for (const s of await listSchedules(guild.id)) {
      try {
        // Modèle actif sans date visée (donnée ancienne ou éditée à la main) : on la recalcule.
        if (s.enabled && !s.nextRunAt) {
          mutate(guild.id, s.id, (sch) => (sch.nextRunAt = nextOccurrence(sch, now)));
          await save();
          continue;
        }
        const current = await getTournament(guild.id);
        const [action] = dueActions(s, now, current);
        if (action) await runAction(client, guild, s, action, current, now);
      } catch (err) {
        console.warn(`Tournoi récurrent « ${s.name} » :`, err.message);
      }
    }
  } finally {
    ticking.delete(guild.id);
  }
}

/**
 * « Ouvrir maintenant » (dashboard, pour tester) : ouvre tout de suite les inscriptions de la
 * prochaine occurrence ; check-in et bracket suivent ensuite les horaires du modèle.
 */
export async function runScheduleNow(client, guild, id, now = Date.now()) {
  const s = guildSchedules(guild.id)[id];
  if (!s) throw new Error("Modèle introuvable.");
  if (await getTournament(guild.id)) throw new Error("Un tournoi existe déjà : archive-le ou supprime-le avant d'ouvrir ce modèle.");
  // Occurrence déjà ouverte (puis abandonnée) ou dépassée : on vise la suivante.
  let T = s.nextRunAt;
  if (!T || T <= now || s.lastFired?.open === T) T = nextOccurrence(s, Math.max(now, T || 0));
  s.nextRunAt = T;
  const t = await openOccurrence(client, guild, clone(s), T, now);
  if (!t) throw new Error("Ouverture annulée : un autre tournoi vient d'être créé, ou cette occurrence est déjà ouverte.");
  return t;
}
