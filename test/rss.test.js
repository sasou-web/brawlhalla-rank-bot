import test from "node:test";
import assert from "node:assert/strict";
import { saveDoc } from "../src/db.js";
import {
  parseFeedXml,
  planPost,
  buildMessagePayload,
  getTikTokConfig,
  setTikTokConfig,
  getTikTokStatus,
} from "../src/tiktok.js";
import { parseEmbedHtml, videoIdTime, normalizeHandle, handleFromFeedUrl, SourceError } from "../src/tiktokSource.js";

const RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Vieille vidéo</title>
    <link>https://www.tiktok.com/@kaya/video/1</link>
    <guid>1</guid>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <description><![CDATA[<img src="https://img/old.jpg"/> texte]]></description>
  </item>
  <item>
    <title>Nouvelle vidéo</title>
    <link>https://www.tiktok.com/@kaya/video/2</link>
    <guid>2</guid>
    <pubDate>Wed, 01 May 2024 10:00:00 GMT</pubDate>
    <description><![CDATA[<img src="https://img/new.jpg"/> #brawlhalla]]></description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed>
  <entry>
    <title>Atom A</title>
    <link href="https://example.com/a"/>
    <id>a</id>
    <updated>2024-03-01T10:00:00Z</updated>
    <summary>desc</summary>
  </entry>
</feed>`;

test("parseFeedXml trie du plus récent au plus ancien", () => {
  const items = parseFeedXml(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "2"); // la plus récente en premier
  assert.equal(items[0].title, "Nouvelle vidéo");
  assert.equal(items[0].image, "https://img/new.jpg");
});

test("parseFeedXml gère le format Atom (link href + id)", () => {
  const items = parseFeedXml(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/a");
  assert.equal(items[0].id, "a");
});

test("parseFeedXml ignore les items sans lien et tolère un xml vide", () => {
  assert.deepEqual(parseFeedXml(""), []);
  assert.deepEqual(parseFeedXml("<rss><channel><item><title>x</title></item></channel></rss>"), []);
});

test("parseFeedXml décode les entités HTML du titre", () => {
  const xml = `<rss><channel><item><title>A &amp; B</title><link>https://x/1</link><guid>1</guid></item></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items[0].title, "A & B");
});

// ---------- Source directe (embed) et identifiants ----------

// Fabrique un ID TikTok réaliste mis en ligne à `ms` (32 bits de poids fort = secondes Unix).
const idAt = (ms, n = 1) => ((BigInt(Math.floor(ms / 1000)) << 32n) | BigInt(n)).toString();
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function embedHtml(page) {
  const state = { source: { data: { "/embed/@kaya": page } } };
  return `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script></html>`;
}

test("videoIdTime lit l'heure d'upload encodée dans un vrai ID TikTok", () => {
  assert.equal(new Date(videoIdTime("7669716517881187606")).toISOString(), "2026-08-03T08:17:13.000Z");
  assert.equal(videoIdTime("abc"), 0);
  assert.equal(videoIdTime("12"), 0);
});

test("normalizeHandle accepte pseudo, @pseudo et lien de profil", () => {
  assert.equal(normalizeHandle("@KayaGoldForged"), "kayagoldforged");
  assert.equal(normalizeHandle("https://www.tiktok.com/@kaya.gf/video/123"), "kaya.gf");
  assert.equal(normalizeHandle("pas un pseudo !"), "");
  assert.equal(handleFromFeedUrl("https://raw.githubusercontent.com/x/y/main/rss/kayagoldforged.xml"), "kayagoldforged");
});

test("parseEmbedHtml : vidéos du compte, triées, sans les privées ni celles d'un autre compte", () => {
  const old = idAt(NOW - 400 * DAY);
  const a = idAt(NOW - 2 * DAY);
  const b = idAt(NOW - DAY);
  const html = embedHtml({
    userInfo: { uniqueId: "kaya", nickname: "Kaya GF", privateAccount: false },
    videoList: [
      { id: old, desc: "épinglée", authorUniqueId: "kaya", coverUrl: "https://c/old-34.png", originCoverUrl: "https://c/old.jpg" },
      { id: a, desc: "A #lol", authorUniqueId: "kaya", coverUrl: "https://c/a-34.png" },
      { id: b, desc: "B", authorUniqueId: "kaya", originCoverUrl: "https://c/b.jpg" },
      { id: idAt(NOW, 7), desc: "privée", authorUniqueId: "kaya", privateItem: true },
      { id: idAt(NOW, 8), desc: "autre", authorUniqueId: "quelquun" },
    ],
  });
  const { profile, items } = parseEmbedHtml(html, "kaya");
  assert.equal(profile.nickname, "Kaya GF");
  assert.deepEqual(items.map((i) => i.videoId), [b, a, old]);
  assert.equal(items[0].url, `https://www.tiktok.com/@kaya/video/${b}`);
  assert.equal(items[0].image, "https://c/b.jpg"); // miniature 9:16 préférée
  assert.equal(items[1].image, "https://c/a-34.png"); // repli
  assert.equal(items[1].title, "A #lol");
});

test("parseEmbedHtml : compte inexistant = erreur de config, page sans données = erreur passagère", () => {
  const notFound = embedHtml({ isError: true, errorCode: 10221, errorStatus: 400, userInfo: { uniqueId: "kaya" } });
  assert.throws(() => parseEmbedHtml(notFound, "kaya"), (e) => e instanceof SourceError && e.fatal === true);
  assert.throws(() => parseEmbedHtml("<html>captcha</html>", "kaya"), (e) => e instanceof SourceError && e.fatal === false);
});

// ---------- Décision de publication (régression : rafales et doublons) ----------

const item = (ms, n = 1) => {
  const videoId = idAt(ms, n);
  return { videoId, url: `https://www.tiktok.com/@kaya/video/${videoId}`, title: `v${n}`, uploadTs: videoIdTime(videoId, NOW) };
};

test("planPost : première lecture d'une source = amorçage silencieux, rien n'est publié", () => {
  const items = [item(NOW - DAY, 1), item(NOW - 2 * DAY, 2)];
  const p = planPost(items, { seen: [], ready: false, now: NOW });
  assert.equal(p.seed, true);
  assert.equal(p.toPost.length, 0);
  assert.deepEqual(p.markSeen, items.map((i) => i.videoId));
});

test("planPost : une vidéo déjà vue n'est jamais republiée, quel que soit l'ordre du flux", () => {
  const a = item(NOW - DAY, 1);
  const b = item(NOW - 2 * DAY, 2);
  const seen = [a.videoId, b.videoId];
  assert.equal(planPost([b, a], { seen, ready: true, now: NOW }).toPost.length, 0);
  assert.equal(planPost([a, b], { seen, ready: true, now: NOW }).toPost.length, 0);
});

test("planPost : une nouveauté est publiée, une vieille vidéo épinglée inconnue est ignorée", () => {
  const known = item(NOW - DAY, 1);
  const fresh = item(NOW - 60_000, 2);
  const pinned = item(NOW - 90 * DAY, 3);
  const p = planPost([pinned, fresh, known], { seen: [known.videoId], ready: true, now: NOW });
  assert.deepEqual(p.toPost.map((i) => i.videoId), [fresh.videoId]);
  assert.deepEqual(p.markSeen, [pinned.videoId]);
});

test("planPost : vidéo programmée (uploadée il y a des jours, publiée maintenant) bien publiée", () => {
  const scheduled = item(NOW - 8 * DAY, 4);
  const p = planPost([scheduled], { seen: [], ready: true, now: NOW });
  assert.deepEqual(p.toPost.map((i) => i.videoId), [scheduled.videoId]);
});

test("planPost : plusieurs nouveautés triées de la plus ancienne à la plus récente", () => {
  const v1 = item(NOW - 3 * 3600_000, 1);
  const v2 = item(NOW - 2 * 3600_000, 2);
  const v3 = item(NOW - 3600_000, 3);
  const p = planPost([v3, v1, v2], { seen: [], ready: true, now: NOW });
  assert.deepEqual(p.toPost.map((i) => i.videoId), [v1.videoId, v2.videoId, v3.videoId]);
});

test("planPost : trop de nouveautés d'un coup = anomalie, resynchronisation sans rien publier", () => {
  const items = Array.from({ length: 8 }, (_, n) => item(NOW - n * 3600_000, n + 1));
  const p = planPost(items, { seen: [], ready: true, now: NOW });
  assert.equal(p.toPost.length, 0);
  assert.match(p.anomaly, /8 vidéos/);
  assert.equal(p.markSeen.length, 8);
});

test("buildMessagePayload : plusieurs vidéos = un seul message, les autres en liens", () => {
  const main = { ...item(NOW, 2), title: "Principale #brawlhalla", date: new Date(NOW).toISOString() };
  const other = { ...item(NOW - 60_000, 1), title: "Autre [crochets]" };
  const payload = buildMessagePayload({ roleId: "123456789012345678", username: "", account: "kaya" }, main, {
    others: [other],
    displayName: "Kaya GF",
    imageUrl: "attachment://tiktok-1.jpg",
  });
  const json = JSON.stringify(payload.components.map((c) => c.toJSON()));
  assert.match(json, /Kaya GF/);
  assert.match(json, /Aussi publiée : \[Autre crochets\]/);
  assert.match(json, /attachment:\/\/tiktok-1\.jpg/);
  assert.deepEqual(payload.allowedMentions, { roles: ["123456789012345678"] });
});

// ---------- Config vs état (régression : le dashboard écrasait l'état) ----------
// ⚠️ Ce test de migration doit rester le PREMIER à lire la config TikTok du fichier :
// le module garde ensuite le document en cache.

test("migration : ancien format repris (compte déduit du flux, intervalle 10 -> 2, dernier vu conservé)", async () => {
  const lastId = idAt(NOW - DAY, 9);
  saveDoc("tiktok", {
    guilds: {
      g_migr: {
        enabled: true,
        feedUrl: "https://raw.githubusercontent.com/x/y/main/rss/kayagoldforged.xml",
        username: "KayaGF",
        channelId: "123456789012345678",
        pollIntervalMin: 10,
        lastItemId: `https://tiktok.com/@kayagoldforged/video/${lastId}`,
      },
    },
  });
  const cfg = await getTikTokConfig("g_migr");
  assert.equal(cfg.account, "kayagoldforged");
  assert.equal(cfg.pollIntervalMin, 2);
  assert.equal(cfg.username, "KayaGF");
  assert.equal("lastItemId" in cfg, false);
  const st = await getTikTokStatus("g_migr");
  assert.equal(st.seenCount, 1);
});

test("setTikTokConfig ignore les champs d'état renvoyés par un dashboard périmé", async () => {
  await setTikTokConfig("g_cfg", { account: "@Kaya", channelId: "123456789012345678" });
  const cfg = await setTikTokConfig("g_cfg", {
    ...(await getTikTokConfig("g_cfg")),
    lastItemId: "vieux",
    seen: [],
    ready: { embed: true },
    pollIntervalMin: 0,
  });
  assert.equal(cfg.account, "kaya");
  assert.equal(cfg.pollIntervalMin, 1); // borné au minimum
  assert.equal("seen" in cfg, false);
  assert.equal("lastItemId" in cfg, false);
  await assert.rejects(() => setTikTokConfig("g_cfg", { account: "pas valide !" }), /Compte TikTok invalide/);
});
