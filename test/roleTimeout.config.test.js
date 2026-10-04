import test from "node:test";
import assert from "node:assert/strict";
import {
  getRoleTimeoutConfig,
  setRoleTimeoutConfig,
  roleTimeoutSection,
  getTimeoutCooldownRemaining,
  recordTimeoutUse,
} from "../src/roleTimeout.js";
import { configPutHandler } from "../src/web/configApi.js";

// Base SQLite temporaire (scripts/run-tests.js) : un id de serveur différent par test.
let seq = 0;
const gid = () => `rt-config-${process.pid}-${++seq}`;

// Rôles du serveur simulés (comme buildSections : Set des ids + @everyone = id du serveur).
function rolesOf(guildId, ids = ["r1", "r2", "r3"]) {
  const calls = { n: 0 };
  const resolve = async () => {
    calls.n++;
    return { roleIds: new Set([guildId, ...ids]), everyoneRoleId: guildId };
  };
  return { resolve, calls };
}

function fakeRes() {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

async function put(sections, section, body) {
  const res = fakeRes();
  await configPutHandler(sections)({ params: { section }, body }, res);
  return res;
}

const DEFAULTS = { enabled: false, allowedRoleIds: [], cooldownSec: 300 };

// ---------- Stockage ----------

test("config : valeurs par défaut pour un serveur inconnu", async () => {
  assert.deepEqual(await getRoleTimeoutConfig(gid()), DEFAULTS);
});

test("config : un patch valide est persisté ; les rôles ne sont vérifiés que s'ils changent", async () => {
  const g = gid();
  const { resolve, calls } = rolesOf(g);
  const out = await setRoleTimeoutConfig(g, { enabled: true, cooldownSec: 120 }, { resolveRoles: resolve });
  assert.deepEqual(out, { enabled: true, allowedRoleIds: [], cooldownSec: 120 });
  assert.equal(calls.n, 0, "resolveRoles ne doit pas être appelé sans allowedRoleIds");
  await setRoleTimeoutConfig(g, { allowedRoleIds: ["r2"] }, { resolveRoles: resolve });
  assert.equal(calls.n, 1);
  assert.deepEqual(await getRoleTimeoutConfig(g), { enabled: true, allowedRoleIds: ["r2"], cooldownSec: 120 });
});

test("cooldown : armé après usage, propre au membre et au serveur, 0 si désactivé", () => {
  const g = gid();
  const other = gid();
  const now = Date.now();
  recordTimeoutUse(g, "exec", now);
  assert.ok(getTimeoutCooldownRemaining(g, "exec", 300, now + 1000) > 0);
  assert.equal(getTimeoutCooldownRemaining(g, "autre", 300, now + 1000), 0);
  assert.equal(getTimeoutCooldownRemaining(other, "exec", 300, now + 1000), 0);
  assert.equal(getTimeoutCooldownRemaining(g, "exec", 0, now + 1000), 0);
  assert.equal(getTimeoutCooldownRemaining(g, "exec", 300, now + 301_000), 0);
});

// ---------- Route PUT /api/config/:section ----------

test("PUT : cooldown hors bornes → 400 en français, config inchangée", async () => {
  const g = gid();
  const sections = { roletimeout: roleTimeoutSection(g, rolesOf(g).resolve) };
  for (const v of [-1, 86_401]) {
    const res = await put(sections, "roletimeout", { cooldownSec: v });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /cooldown doit être un nombre entier/);
  }
  assert.deepEqual(await getRoleTimeoutConfig(g), DEFAULTS);
});

test("PUT : cooldown non entier → 400", async () => {
  const g = gid();
  const res = await put({ roletimeout: roleTimeoutSection(g, rolesOf(g).resolve) }, "roletimeout", { cooldownSec: 2.5 });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(await getRoleTimeoutConfig(g), DEFAULTS);
});

test("PUT : rôle inexistant ou @everyone → 400, config inchangée", async () => {
  const g = gid();
  const sections = { roletimeout: roleTimeoutSection(g, rolesOf(g).resolve) };
  const unknown = await put(sections, "roletimeout", { allowedRoleIds: ["r1", "fantome"] });
  assert.equal(unknown.statusCode, 400);
  assert.match(unknown.body.error, /Rôle introuvable/);
  const everyone = await put(sections, "roletimeout", { allowedRoleIds: [g] });
  assert.equal(everyone.statusCode, 400);
  assert.match(everyone.body.error, /everyone/);
  assert.deepEqual(await getRoleTimeoutConfig(g), DEFAULTS);
});

test("PUT : patch valide → 200 avec la config ; clés inconnues non persistées", async () => {
  const g = gid();
  const sections = { roletimeout: roleTimeoutSection(g, rolesOf(g).resolve) };
  const res = await put(sections, "roletimeout", { enabled: true, allowedRoleIds: ["r1", "r3"], cooldownSec: 600, foo: 1, isAdmin: true });
  assert.equal(res.statusCode, 200);
  const expected = { enabled: true, allowedRoleIds: ["r1", "r3"], cooldownSec: 600 };
  assert.deepEqual(res.body, expected);
  assert.deepEqual(await getRoleTimeoutConfig(g), expected);
});

test("PUT : section inconnue → 404", async () => {
  const res = await put({}, "inexistante", { enabled: true });
  assert.equal(res.statusCode, 404);
});

test("PUT : rôles invérifiables (Discord injoignable) → 503, config inchangée", async () => {
  const g = gid();
  const failing = async () => {
    throw new Error("Discord down");
  };
  const res = await put({ roletimeout: roleTimeoutSection(g, failing) }, "roletimeout", { allowedRoleIds: ["r1"] });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /Réessaie/);
  assert.deepEqual(await getRoleTimeoutConfig(g), DEFAULTS);
});

test("PUT : une erreur sans httpStatus reste un 500 (comportement historique)", async () => {
  const sections = {
    autre: {
      get: async () => ({ a: 1 }),
      set: async () => {
        throw new Error("boom");
      },
    },
  };
  const res = await put(sections, "autre", { a: 2 });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "boom");
});
