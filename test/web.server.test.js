import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import jwt from "jsonwebtoken";

// Dashboard actif sur un port éphémère local. Valeurs forcées (et non `||=`) : un .env de
// développement ne doit pas changer l'adresse d'écoute ni le secret des sessions du test.
const SECRET = "test-session-secret";
Object.assign(process.env, {
  CLIENT_SECRET: "test-client-secret",
  PUBLIC_URL: "http://127.0.0.1",
  SESSION_SECRET: SECRET,
  WEB_PORT: "0",
  WEB_HOST: "127.0.0.1",
  NODE_ENV: "test", // Express n'imprime pas la pile des erreurs attendues (413)
});
process.env.DISCORD_TOKEN ||= "test";
process.env.CLIENT_ID ||= "0";
process.env.GUILD_ID ||= "0";

const { startWebServer } = await import("../src/web/server.js");
const { setSetting, getSettings } = await import("../src/settings.js");
const { parseTrustProxy } = await import("../src/config.js");

// Faux client Discord : « admin » a « Gérer le serveur », « banni » n'est plus membre (10007).
const guild = {
  id: process.env.GUILD_ID,
  ownerId: "owner",
  members: {
    fetch: async (id) => {
      if (id === "admin") return { permissions: { has: () => true } };
      throw Object.assign(new Error("Unknown Member"), { code: 10007 });
    },
  },
};
const client = { guilds: { fetch: async () => guild } };

const log = console.log;
const warn = console.warn;
console.log = console.warn = () => {}; // bannière de démarrage du dashboard
const server = startWebServer(client);
await once(server, "listening");
console.log = log;
console.warn = warn;
const base = `http://127.0.0.1:${server.address().port}`;

after(() => {
  server.closeAllConnections?.();
  server.close();
});

const cookieFor = (id) => `bh_session=${jwt.sign({ id, username: id, avatar: null, isAdmin: true }, SECRET, { expiresIn: "1h" })}`;
const bigJson = (mb) => JSON.stringify({ text: "x".repeat(mb * 1024 * 1024) });

function call(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  return fetch(base + path, { method, headers, body });
}

// ---------- Ordre des middlewares (C2) ----------

test("non authentifié : un corps de 13 Mo sur /api/announce/send est refusé en 401 sans être parsé", async () => {
  const res = await call("/api/announce/send", { method: "POST", body: bigJson(13) });
  assert.equal(res.status, 401, "un 413 signifierait que le corps a été lu avant l'authentification");
});

test("non authentifié : un corps de 2 Mo sur une autre route /api → 401 (pas 413)", async () => {
  const res = await call("/api/config/settings", { method: "PUT", body: bigJson(2) });
  assert.equal(res.status, 401);
});

test("/api/me reste accessible sans session (état de connexion)", async () => {
  const res = await call("/api/me");
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "non connecté" });
});

test("admin : le parser 12 Mo s'applique à /api/announce/send, le parser 1 Mo partout ailleurs", async () => {
  const cookie = cookieFor("admin");
  const announce = await call("/api/announce/send", { method: "POST", body: bigJson(2), cookie });
  assert.equal(announce.status, 400);
  assert.equal((await announce.json()).error, "Choisis un salon.");
  const other = await call("/api/config/settings", { method: "PUT", body: bigJson(2), cookie });
  assert.equal(other.status, 413);
});

// ---------- Admin exclu du serveur (C1) ----------

test("session admin d'un membre banni (10007) → 403 accès révoqué", async () => {
  const res = await call("/api/config", { cookie: cookieFor("banni") });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "accès révoqué");
});

// ---------- TRUST_PROXY (I3) ----------

test("TRUST_PROXY : non défini = 1 (prod actuelle inchangée), 0/false = désactivé, entier ou texte Express", () => {
  assert.equal(parseTrustProxy(undefined), 1);
  assert.equal(parseTrustProxy("  "), 1);
  assert.equal(parseTrustProxy("0"), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("2"), 2);
  assert.equal(parseTrustProxy("loopback"), "loopback");
});

// ---------- Token start.gg (I1) ----------

test("/api/config n'expose jamais le token start.gg, seulement sa présence ; DELETE l'efface", async () => {
  const cookie = cookieFor("admin");
  await setSetting("startggToken", "pat-tres-secret");
  const res = await call("/api/config", { cookie });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.doesNotMatch(raw, /pat-tres-secret/);
  const { settings } = JSON.parse(raw);
  assert.equal(settings.hasStartggToken, true);
  assert.equal("startggToken" in settings, false);

  const del = await call("/api/startgg/token", { method: "DELETE", cookie });
  assert.equal(del.status, 200);
  assert.equal((await getSettings()).startggToken, "");
  const cleared = await (await call("/api/config", { cookie })).json();
  assert.equal(cleared.settings.hasStartggToken, false);
});
