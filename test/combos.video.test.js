import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { getComboVideo, refreshRejection, pickDataset } from "../src/combos.js";
import { sendVideoBuffer } from "../src/web/comboLab.js";

// fetch simulé : aucune requête vers BrawlDatabase. Chaque appel est journalisé.
const realFetch = globalThis.fetch;
let calls = [];
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

const MB = 1024 * 1024;
let seq = 0;
const combo = () => ({ id: 90_000 + ++seq, weapon: "test", video: `https://brawldb.invalid/${seq}.mp4` });

// Flux de `chunks` morceaux de 1 Mo, sans Content-Length.
function streamOf(chunks) {
  let sent = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (sent++ < chunks) ctrl.enqueue(new Uint8Array(MB));
      else ctrl.close();
    },
  });
}

// ---------- Téléchargement (I5) ----------

test("vidéo : le téléchargement a un délai (signal) et une vidéo de 13 Mo est mise en cache", async () => {
  stubFetch(() => new Response(streamOf(13)));
  const c = combo();
  const buf = await getComboVideo(c);
  assert.equal(buf.length, 13 * MB);
  assert.ok(calls[0].opts.signal instanceof AbortSignal, "fetch sans délai");
  // Requêtes Range suivantes du navigateur : servies depuis le cache, sans re-télécharger.
  assert.equal(await getComboVideo(c), buf);
  assert.equal(calls.length, 1);
});

test("vidéo : Content-Length au-delà du plafond → abandon immédiat, rien en cache", async () => {
  stubFetch(() => new Response(streamOf(1), { headers: { "content-length": String(40 * MB) } }));
  const c = combo();
  assert.equal(await getComboVideo(c), null);
  assert.equal(await getComboVideo(c), null);
  assert.equal(calls.length, 2, "un échec n'est pas mis en cache");
});

test("vidéo : corps sans Content-Length qui dépasse le plafond → null", async () => {
  stubFetch(() => new Response(streamOf(31)));
  assert.equal(await getComboVideo(combo()), null);
});

test("vidéo : BrawlDB en erreur ou délai dépassé → null (pas de promesse pendante)", async () => {
  stubFetch(() => new Response("non", { status: 503 }));
  assert.equal(await getComboVideo(combo()), null);
  stubFetch(() => {
    throw new DOMException("délai", "TimeoutError");
  });
  assert.equal(await getComboVideo(combo()), null);
});

// ---------- ETag / If-Range (Combo Lab) ----------

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => (r.headers[k.toLowerCase()] = v);
  r.status = (c) => ((r.statusCode = c), r);
  r.end = (b) => ((r.body = b ?? null), r);
  return r;
}

test("sendVideoBuffer : ETag stable ; If-Range identique → 206, différent → 200 complet", () => {
  const buf = Buffer.from("0123456789");
  const first = fakeRes();
  sendVideoBuffer({ method: "GET", headers: {} }, first, buf);
  const etag = first.headers.etag;
  assert.match(etag, /^"[\w-]+"$/);

  const same = fakeRes();
  sendVideoBuffer({ method: "GET", headers: { range: "bytes=2-4", "if-range": etag } }, same, buf);
  assert.equal(same.statusCode, 206);
  assert.equal(same.body.toString(), "234");
  assert.equal(same.headers.etag, etag);

  const changed = fakeRes();
  sendVideoBuffer({ method: "GET", headers: { range: "bytes=2-4", "if-range": '"autre"' } }, changed, buf);
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.length, 10);
});

// ---------- Garde-fou du rafraîchissement (I6) ----------

test("refreshRejection : refuse un jeu vide ou amputé de plus de 20 %, accepte le reste", () => {
  assert.match(refreshRejection(214, 0), /aucun combo/);
  assert.match(refreshRejection(0, 0), /aucun combo/);
  assert.match(refreshRejection(214, 150), /150 combos récupérés contre 214/);
  assert.equal(refreshRejection(214, 172), "");
  assert.equal(refreshRejection(214, 230), "");
  assert.equal(refreshRejection(0, 12), "", "première récupération : pas de référence");
});

// ---------- Choix du jeu de données : dashboard (live) vs graine versionnée ----------

test("pickDataset : la version du dashboard prime, sauf graine scrapée plus récemment", () => {
  const seed = { combos: [1], scrapedAt: "2026-06-10T04:11:00Z" };
  const liveNewer = { combos: [1, 2], scrapedAt: "2026-07-01T10:00:00Z" };
  const liveOlder = { combos: [3], scrapedAt: "2026-05-01T10:00:00Z" };
  assert.equal(pickDataset(liveNewer, seed), liveNewer); // update.sh ne l'écrase plus
  assert.equal(pickDataset(liveOlder, seed), seed); // graine re-scrapée et poussée depuis
  assert.equal(pickDataset({ combos: [4], scrapedAt: seed.scrapedAt }, seed).combos[0], 4); // égalité : live
  assert.equal(pickDataset({ combos: [5], scrapedAt: null }, { combos: [6], scrapedAt: null }).combos[0], 5);
  assert.equal(pickDataset(null, seed), seed); // pas de version dashboard
  assert.equal(pickDataset(liveNewer, null), liveNewer);
  assert.equal(pickDataset(null, null), null);
});
