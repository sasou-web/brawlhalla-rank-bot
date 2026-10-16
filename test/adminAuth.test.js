import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { isGuildAdmin, createAdminVerifier } from "../src/web/adminAuth.js";

const discordError = (code) => Object.assign(new Error(`Discord ${code}`), { code });

// Faux serveur : `members` = { userId: true (Gérer le serveur) | false } ; `fail` = erreur levée.
function fakeGuild({ ownerId = "owner", members = {}, fail = null } = {}) {
  const calls = { n: 0 };
  return {
    calls,
    ownerId,
    members: {
      fetch: async (id) => {
        calls.n++;
        if (fail) throw fail;
        if (!(id in members)) throw discordError(10007);
        return { permissions: { has: (p) => p === PermissionFlagsBits.ManageGuild && members[id] } };
      },
    },
  };
}

// ---------- isGuildAdmin ----------

test("isGuildAdmin : propriétaire, admin, simple membre", async () => {
  const guild = fakeGuild({ members: { admin: true, membre: false } });
  assert.equal(await isGuildAdmin(guild, "owner"), true);
  assert.equal(await isGuildAdmin(guild, "admin"), true);
  assert.equal(await isGuildAdmin(guild, "membre"), false);
});

test("isGuildAdmin : membre exclu/banni (10007) ou utilisateur inconnu (10013) → false, pas une erreur", async () => {
  assert.equal(await isGuildAdmin(fakeGuild(), "parti"), false);
  assert.equal(await isGuildAdmin(fakeGuild({ fail: discordError(10013) }), "inconnu"), false);
});

test("isGuildAdmin : échec transitoire (réseau, 5xx) → l'erreur remonte", async () => {
  await assert.rejects(isGuildAdmin(fakeGuild({ fail: new Error("ECONNRESET") }), "admin"), /ECONNRESET/);
  await assert.rejects(isGuildAdmin(fakeGuild({ fail: discordError(500) }), "admin"));
});

test("isGuildAdmin : id absent → false sans interroger Discord (fetch(undefined) chargerait tout le serveur)", async () => {
  const guild = fakeGuild();
  assert.equal(await isGuildAdmin(guild, undefined), false);
  assert.equal(guild.calls.n, 0);
});

// ---------- createAdminVerifier ----------

function clock(start = 1_000_000_000_000) {
  const c = { t: start };
  c.now = () => c.t;
  return c;
}
const session = (c, extra = {}) => ({ id: "u1", isAdmin: true, iat: Math.floor(c.t / 1000), ...extra });

test("verifier : résultat mis en cache pendant le TTL", async () => {
  const c = clock();
  let n = 0;
  const check = async () => {
    n++;
    return true;
  };
  const verify = createAdminVerifier(check, { ttlMs: 60_000, now: c.now });
  const s = session(c);
  assert.equal(await verify(s), true);
  c.t += 30_000;
  assert.equal(await verify(s), true);
  assert.equal(n, 1);
});

test("verifier : admin exclu du serveur → accès retiré au plus tard à l'expiration du cache (régression C1)", async () => {
  const c = clock();
  const guild = fakeGuild({ ownerId: "x", members: { u1: true } });
  const verify = createAdminVerifier((id) => isGuildAdmin(guild, id), { ttlMs: 60_000, now: c.now });
  const s = session(c);
  assert.equal(await verify(s), true);
  // Le membre est banni : Discord répond désormais « Unknown Member ».
  guild.members.fetch = async () => {
    throw discordError(10007);
  };
  c.t += 61_000;
  assert.equal(await verify(s), false, "un 10007 ne doit pas être pris pour un échec transitoire");
});

test("verifier : échec transitoire → dernière valeur connue pendant la période de grâce, puis rejet", async () => {
  const c = clock();
  let up = true;
  const verify = createAdminVerifier(
    async () => {
      if (!up) throw new Error("Discord down");
      return true;
    },
    { ttlMs: 60_000, graceMs: 5 * 60_000, now: c.now },
  );
  const s = session(c);
  assert.equal(await verify(s), true);
  up = false;
  c.t += 2 * 60_000; // cache expiré, mais vérifié il y a 2 min
  assert.equal(await verify(s), true);
  c.t += 4 * 60_000; // vérifié il y a 6 min : trop vieux
  await assert.rejects(verify(s), /Discord down/);
});

test("verifier : sans cache (redémarrage), repli sur le JWT seulement s'il est récent", async () => {
  const c = clock();
  const down = async () => {
    throw new Error("Discord down");
  };
  const verify = createAdminVerifier(down, { graceMs: 5 * 60_000, now: c.now });
  assert.equal(await verify(session(c, { iat: Math.floor((c.t - 60_000) / 1000) })), true);
  // Login d'il y a 2 h : le flag du JWT ne suffit plus, droits invérifiables.
  await assert.rejects(verify(session(c, { id: "u2", iat: Math.floor((c.t - 2 * 3600_000) / 1000) })));
});
