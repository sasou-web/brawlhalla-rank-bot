import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedXml } from "../src/tiktok.js";

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
