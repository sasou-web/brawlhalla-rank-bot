import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, fetchFeedItems, SourceError } from "../src/tiktokSource.js";

// fetch simulé : aucune requête réseau réelle. Chaque appel est journalisé.
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

const RSS = `<rss><channel><item><title>A</title><link>https://www.tiktok.com/@kaya/video/7430000000000000000</link><guid>1</guid></item></channel></rss>`;
const PUBLIC_FEED = "https://93.184.216.34/rss/kaya.xml"; // IP littérale publique : pas de DNS

// ---------- Adresses ----------

test("isPublicAddress : IPv4 publiques acceptées, local / privé / link-local / réservé refusés", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "140.82.112.3", "172.32.0.1", "100.128.0.1"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ["127.0.0.1", "127.255.0.9", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("isPublicAddress : IPv6 (boucle locale, ULA, link-local, IPv4 mappée sous toutes ses formes)", () => {
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4007:80e::200e", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a00:5"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("pas-une-ip"), false);
});

// ---------- Lecture du flux ----------

test("flux : http:// refusé avant toute requête", async () => {
  stubFetch(() => new Response(RSS));
  await assert.rejects(fetchFeedItems("http://93.184.216.34/rss/kaya.xml"), (err) => err instanceof SourceError && err.fatal && /https/.test(err.message));
  assert.equal(calls.length, 0);
});

test("flux : boucle locale, réseau privé et métadonnées cloud refusés avant toute requête", async () => {
  stubFetch(() => new Response(RSS));
  for (const url of ["https://127.0.0.1:3000/health", "https://[::1]/", "https://169.254.169.254/latest/meta-data/", "https://10.0.0.5:8080/", "https://localhost/feed.xml", "https://0x7f.1/"]) {
    await assert.rejects(fetchFeedItems(url), /refusée/, url);
  }
  assert.equal(calls.length, 0);
});

test("flux : une redirection vers une adresse privée est refusée (vérifiée à chaque saut)", async () => {
  stubFetch(() => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }));
  await assert.rejects(fetchFeedItems(PUBLIC_FEED), /refusée/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.redirect, "manual");
});

test("flux : redirection publique suivie, puis items lus", async () => {
  stubFetch((url) => (url === PUBLIC_FEED ? new Response(null, { status: 301, headers: { location: "/rss/kaya2.xml" } }) : new Response(RSS)));
  const items = await fetchFeedItems(PUBLIC_FEED);
  assert.equal(items.length, 1);
  assert.deepEqual(calls.map((c) => c.url), [PUBLIC_FEED, "https://93.184.216.34/rss/kaya2.xml"]);
});

test("flux : erreur réseau → message générique, sans le code réseau brut", async () => {
  stubFetch(() => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  });
  await assert.rejects(fetchFeedItems(PUBLIC_FEED), (err) => err instanceof SourceError && /injoignable/.test(err.message) && !/ECONNREFUSED/.test(err.message));
});
