import test from "node:test";
import assert from "node:assert/strict";
import {
  TIMEOUT_MAX_MS,
  COOLDOWN_MAX_SEC,
  parseTimeoutDuration,
  cooldownRemainingMs,
  validateRoleTimeoutPatch,
  evaluateTimeoutRequest,
} from "../src/roleTimeoutRules.js";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------- parseTimeoutDuration ----------

test("durée : unités simples et combinées", () => {
  assert.deepEqual(parseTimeoutDuration("10m"), { ok: true, ms: 600_000 });
  assert.equal(parseTimeoutDuration("2h").ms, 2 * HOUR);
  assert.equal(parseTimeoutDuration("1d").ms, DAY);
  assert.equal(parseTimeoutDuration("1w").ms, 7 * DAY);
  assert.equal(parseTimeoutDuration("1h30m").ms, HOUR + 30 * MIN);
});

test("durée : casse et espaces tolérés", () => {
  assert.equal(parseTimeoutDuration("1D 12H").ms, DAY + 12 * HOUR);
  assert.equal(parseTimeoutDuration("  45m ").ms, 45 * MIN);
});

test("durée : nombre seul = minutes", () => {
  assert.deepEqual(parseTimeoutDuration("15"), { ok: true, ms: 900_000 });
});

test("durée : bornes 1 min à 28 jours", () => {
  assert.equal(parseTimeoutDuration("1m").ms, MIN);
  assert.equal(parseTimeoutDuration("28d").ms, TIMEOUT_MAX_MS);
  assert.equal(parseTimeoutDuration("4w").ms, TIMEOUT_MAX_MS);
  const short = parseTimeoutDuration("30s");
  assert.equal(short.ok, false);
  assert.match(short.error, /trop courte/);
  const long = parseTimeoutDuration("29d");
  assert.equal(long.ok, false);
  assert.match(long.error, /trop longue/);
  assert.equal(parseTimeoutDuration("0").ok, false);
});

test("durée : syntaxe invalide refusée", () => {
  for (const s of ["", "abc", "2.5h", "10x", "-5m", "1h abc", null, undefined]) {
    const r = parseTimeoutDuration(s);
    assert.equal(r.ok, false, `« ${s} » devrait être refusé`);
    assert.match(r.error, /Durée/);
  }
});

// ---------- cooldownRemainingMs ----------

test("cooldown : bloque pendant la fenêtre", () => {
  const now = 1_700_000_000_000;
  assert.equal(cooldownRemainingMs(now - 100_000, 300, now), 200_000);
});

test("cooldown : 0 après expiration ou sans usage précédent", () => {
  const now = 1_700_000_000_000;
  assert.equal(cooldownRemainingMs(now - 301_000, 300, now), 0);
  assert.equal(cooldownRemainingMs(0, 300, now), 0);
  assert.equal(cooldownRemainingMs(undefined, 300, now), 0);
});

test("cooldown : 0 seconde = désactivé", () => {
  const now = 1_700_000_000_000;
  assert.equal(cooldownRemainingMs(now - 1000, 0, now), 0);
});

// ---------- validateRoleTimeoutPatch ----------

const ROLES = { roleIds: new Set(["r1", "r2", "r3"]), everyoneRoleId: "g1" };

test("validation : patch valide accepté et nettoyé", () => {
  const r = validateRoleTimeoutPatch({ enabled: true, allowedRoleIds: ["r1", "r2", "r1"], cooldownSec: 600, foo: "bar" }, ROLES);
  assert.deepEqual(r, { ok: true, value: { enabled: true, allowedRoleIds: ["r1", "r2"], cooldownSec: 600 } });
});

test("validation : cooldown hors bornes, non entier ou non numérique refusé", () => {
  for (const v of [-1, COOLDOWN_MAX_SEC + 1, 2.5, "300", null, NaN]) {
    const r = validateRoleTimeoutPatch({ cooldownSec: v }, ROLES);
    assert.equal(r.ok, false, `${String(v)} devrait être refusé`);
    assert.match(r.error, /cooldown/i);
  }
});

test("validation : cooldown 0 et 86 400 acceptés", () => {
  assert.deepEqual(validateRoleTimeoutPatch({ cooldownSec: 0 }, ROLES).value, { cooldownSec: 0 });
  assert.deepEqual(validateRoleTimeoutPatch({ cooldownSec: 86_400 }, ROLES).value, { cooldownSec: 86_400 });
});

test("validation : rôles inconnus, @everyone, id non textuel, plus de 25 rôles", () => {
  assert.match(validateRoleTimeoutPatch({ allowedRoleIds: ["r1", "inconnu"] }, ROLES).error, /introuvable/);
  assert.match(validateRoleTimeoutPatch({ allowedRoleIds: ["g1"] }, ROLES).error, /everyone/);
  assert.match(validateRoleTimeoutPatch({ allowedRoleIds: [123] }, ROLES).error, /introuvable/);
  assert.match(validateRoleTimeoutPatch({ allowedRoleIds: [{ id: "r1" }] }, ROLES).error, /introuvable/);
  const many = Array.from({ length: 26 }, (_, i) => `x${i}`);
  const r = validateRoleTimeoutPatch({ allowedRoleIds: many }, { roleIds: new Set(many), everyoneRoleId: "g1" });
  assert.equal(r.ok, false);
  assert.match(r.error, /25/);
  // 25 rôles distincts : accepté.
  assert.equal(validateRoleTimeoutPatch({ allowedRoleIds: many.slice(0, 25) }, { roleIds: new Set(many) }).ok, true);
});

test("validation : enabled non booléen et allowedRoleIds non tableau refusés", () => {
  assert.equal(validateRoleTimeoutPatch({ enabled: "true" }, ROLES).ok, false);
  assert.equal(validateRoleTimeoutPatch({ enabled: 1 }, ROLES).ok, false);
  assert.equal(validateRoleTimeoutPatch({ allowedRoleIds: "r1" }, ROLES).ok, false);
});

test("validation : allowedRoleIds sans la liste des rôles du serveur → refus", () => {
  assert.equal(validateRoleTimeoutPatch({ allowedRoleIds: ["r1"] }).ok, false);
  assert.equal(validateRoleTimeoutPatch({ allowedRoleIds: ["r1"] }, { everyoneRoleId: "g1" }).ok, false);
  // Sans changement de rôles, la liste n'est pas nécessaire.
  assert.equal(validateRoleTimeoutPatch({ cooldownSec: 60 }).ok, true);
});

// ---------- evaluateTimeoutRequest ----------

const NOW = 1_700_000_000_000;
const CFG = { enabled: true, allowedRoleIds: ["helper"], cooldownSec: 300 };

function member(over = {}) {
  return { id: "u1", isBot: false, isOwner: false, isAdmin: false, isModerator: false, roleIds: [], highestPosition: 1, moderatable: true, timedOutUntil: 0, ...over };
}
const helper = (over = {}) => member({ id: "exec", roleIds: ["helper"], highestPosition: 5, ...over });
const target = (over = {}) => member({ id: "target", highestPosition: 1, ...over });
const evaluate = ({ config = CFG, executor = helper(), tgt = target(), botUserId = "bot" } = {}) =>
  evaluateTimeoutRequest({ config, executor, target: tgt, botUserId, now: NOW });

test("autorisation : rôle autorisé → ok via le rôle, cooldown appliqué", () => {
  assert.deepEqual(evaluate(), { ok: true, bypassCooldown: false, via: "role", roleId: "helper" });
});

test("autorisation : rôle non autorisé → forbidden", () => {
  const r = evaluate({ executor: helper({ roleIds: ["autre"] }) });
  assert.equal(r.code, "forbidden");
  assert.match(r.message, /permission/);
});

test("autorisation : module désactivé → disabled pour un membre du rôle", () => {
  const r = evaluate({ config: { ...CFG, enabled: false } });
  assert.equal(r.code, "disabled");
  assert.match(r.message, /désactivée/);
});

test("autorisation : un modérateur passe sans rôle, module désactivé, sans cooldown", () => {
  const r = evaluate({ config: { enabled: false, allowedRoleIds: [], cooldownSec: 300 }, executor: member({ id: "mod", isModerator: true, highestPosition: 5 }) });
  assert.deepEqual(r, { ok: true, bypassCooldown: true, via: "moderator", roleId: null });
});

test("hiérarchie : cible de rôle égal ou supérieur refusée, sauf pour le propriétaire", () => {
  assert.equal(evaluate({ tgt: target({ highestPosition: 5 }) }).code, "hierarchy");
  assert.equal(evaluate({ tgt: target({ highestPosition: 9 }) }).code, "hierarchy");
  const owner = member({ id: "own", isOwner: true, isModerator: true, isAdmin: true, highestPosition: 0 });
  assert.equal(evaluate({ executor: owner, tgt: target({ highestPosition: 9 }) }).ok, true);
});

test("cible : soi-même refusé, y compris pour un modérateur", () => {
  assert.equal(evaluate({ tgt: target({ id: "exec" }) }).code, "self");
  const mod = member({ id: "mod", isModerator: true, highestPosition: 5 });
  assert.equal(evaluate({ executor: mod, tgt: mod }).code, "self");
});

test("cible : le bot lui-même et les autres bots refusés", () => {
  const self = evaluate({ tgt: target({ id: "bot", isBot: true }) });
  assert.equal(self.code, "self-bot");
  assert.match(self.message, /m'exclure moi-même/);
  assert.equal(evaluate({ tgt: target({ id: "autrebot", isBot: true }) }).code, "bot");
});

test("cible : administrateur, modérateur et propriétaire refusés", () => {
  assert.equal(evaluate({ tgt: target({ isAdmin: true }) }).code, "staff");
  assert.equal(evaluate({ tgt: target({ isModerator: true }) }).code, "staff");
  assert.equal(evaluate({ tgt: target({ isOwner: true }) }).code, "owner");
});

test("cible : membre non modérable par le bot refusé", () => {
  const r = evaluate({ tgt: target({ moderatable: false }) });
  assert.equal(r.code, "unmoderatable");
  assert.match(r.message, /Exclure temporairement des membres/);
});

test("cible : déjà exclue refusée, exclusion expirée acceptée", () => {
  const until = NOW + 10 * MIN;
  const r = evaluate({ tgt: target({ timedOutUntil: until }) });
  assert.equal(r.code, "already");
  assert.ok(r.message.includes(`<t:${Math.floor(until / 1000)}:f>`));
  assert.equal(evaluate({ tgt: target({ timedOutUntil: NOW - 1000 }) }).ok, true);
});
