import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LFG_CONFIG,
  lfgCapacity,
  canJoin,
  joinPost,
  leavePost,
  closePost,
  expirePosts,
  purgePosts,
  buildLfgCard,
  reservePost,
  findOpenPostByAuthor,
  getLfgConfig,
  setLfgConfig,
  tickLfg,
} from "../src/lfg.js";

const cfg = { ...DEFAULT_LFG_CONFIG, enabled: true, channelId: "111111", requireLink: true, maxTierGap: 2 };
const link = (tier, rating = 1500, mode = "2v2") => ({ brawlhallaId: 1, tiers: { [mode]: tier }, [`rating${mode}`]: rating });
const post = (extra = {}) => ({
  id: "p1",
  authorId: "a",
  mode: "2v2",
  region: "EU",
  text: "",
  tier: "Gold",
  rating: 1500,
  members: ["a"],
  channelId: "111111",
  messageId: "m1",
  createdAt: 0,
  expiresAt: 60_000,
  status: "open",
  ...extra,
});

// Contenu texte d'une carte Components V2 (concaténation des TextDisplay).
function cardText(payload) {
  const out = [];
  const walk = (c) => {
    if (c?.type === 10) out.push(c.content);
    for (const child of c?.components ?? []) walk(child);
  };
  for (const comp of payload.components) walk(comp.toJSON());
  return out.join("\n");
}
const buttonIds = (payload) =>
  payload.components[0]
    .toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((row) => row.components.map((b) => b.custom_id));

test("lfgCapacity : 2v2 → 2, 3v3 → 3, 1v1 entraînement → 2", () => {
  assert.equal(lfgCapacity("2v2"), 2);
  assert.equal(lfgCapacity("3v3"), 3);
  assert.equal(lfgCapacity("1v1"), 2);
});

test("canJoin : accepte un membre lié dans l'écart de rank", () => {
  assert.deepEqual(canJoin(post(), link("Platinum"), "b", cfg), { ok: true });
  assert.deepEqual(canJoin(post(), link("Bronze"), "b", cfg), { ok: true });
});

test("canJoin : chaque refus", () => {
  assert.equal(canJoin(post({ status: "full" }), link("Gold"), "b", cfg).reason, "closed");
  assert.equal(canJoin(post({ status: "expired" }), link("Gold"), "b", cfg).reason, "closed");
  assert.equal(canJoin(post(), link("Gold"), "a", cfg).reason, "author");
  assert.equal(canJoin(post({ mode: "3v3", members: ["a", "b"] }), link("Gold", 1500, "3v3"), "b", cfg).reason, "already");
  assert.equal(canJoin(post({ members: ["a", "c"] }), link("Gold"), "b", cfg).reason, "full");
  assert.equal(canJoin(post(), null, "b", cfg).reason, "not_linked");
  assert.equal(canJoin(post(), link("Valhallan"), "b", cfg).reason, "tier_gap");
  assert.deepEqual(canJoin(post(), link("Diamond"), "b", cfg), { ok: true }, "écart de 2 paliers accepté");
  assert.equal(canJoin(post(), link("Tin"), "b", cfg).reason, "tier_gap");
  assert.equal(canJoin(post(), { brawlhallaId: 1, tiers: { "2v2": null } }, "b", cfg).reason, "unranked");
});

test("canJoin : le rank comparé est celui du mode de l'annonce", () => {
  const p = post({ mode: "3v3", tier: "Gold" });
  // Diamond en 2v2 mais Silver en 3v3 : c'est le 3v3 qui compte.
  const l = { brawlhallaId: 1, tiers: { "2v2": "Diamond", "3v3": "Silver" } };
  assert.deepEqual(canJoin(p, l, "b", cfg), { ok: true });
});

test("canJoin : requireLink désactivé → non lié ou non classé accepté, écart ignoré pour lui", () => {
  const open = { ...cfg, requireLink: false };
  assert.deepEqual(canJoin(post(), null, "b", open), { ok: true });
  assert.deepEqual(canJoin(post(), { brawlhallaId: 1, tiers: {} }, "b", open), { ok: true });
  assert.equal(canJoin(post(), link("Valhallan"), "b", open).reason, "tier_gap");
});

test("canJoin : auteur non classé → pas de contrôle d'écart", () => {
  assert.deepEqual(canJoin(post({ tier: null }), link("Valhallan"), "b", cfg), { ok: true });
});

test("joinPost / leavePost / closePost : transitions", () => {
  const p = post({ mode: "3v3", tier: null });
  joinPost(p, "b", 10);
  assert.equal(p.status, "open");
  assert.equal(leavePost(p, "a"), false, "l'auteur ne quitte pas, il ferme");
  assert.equal(leavePost(p, "b"), true);
  assert.deepEqual(p.members, ["a"]);
  joinPost(p, "b", 20);
  joinPost(p, "c", 30);
  assert.equal(p.status, "full");
  assert.equal(p.fullAt, 30);
  assert.equal(closePost(p), false, "une équipe complète ne se ferme plus");
  const q = post();
  assert.equal(closePost(q, "author_left", 5), true);
  assert.equal(q.status, "closed");
  assert.equal(q.closedReason, "author_left");
});

test("expirePosts : expire les annonces ouvertes échues, ne touche pas aux complètes", () => {
  const posts = {
    due: post({ id: "due", expiresAt: 100 }),
    later: post({ id: "later", expiresAt: 10_000 }),
    full: post({ id: "full", expiresAt: 100, status: "full", members: ["a", "b"] }),
    closed: post({ id: "closed", expiresAt: 100, status: "closed" }),
  };
  assert.deepEqual(expirePosts(posts, 1000), ["due"]);
  assert.equal(posts.due.status, "expired");
  assert.equal(posts.due.endedAt, 1000);
  assert.equal(posts.later.status, "open");
  assert.equal(posts.full.status, "full");
  assert.equal(posts.closed.status, "closed");
});

test("purgePosts : oublie les annonces terminées depuis plus de 7 jours", () => {
  const week = 7 * 24 * 3600 * 1000;
  const posts = {
    old: post({ id: "old", status: "expired", endedAt: 0 }),
    recent: post({ id: "recent", status: "closed", endedAt: week }),
    open: post({ id: "open", createdAt: 0 }),
  };
  assert.equal(purgePosts(posts, week + 1), 1);
  assert.deepEqual(Object.keys(posts).sort(), ["open", "recent"]);
});

test("buildLfgCard : contient le tier, le rating, la région et l'expiration", () => {
  const p = post({ expiresAt: 1_700_000_000_000, text: "**go** ranked ce soir" });
  const payload = buildLfgCard(p, { a: link("Gold", 1650) });
  const txt = cardText(payload);
  assert.match(txt, /Gold/);
  assert.match(txt, /1[\s ]650/);
  assert.match(txt, /Europe/);
  assert.match(txt, /<t:1700000000:R>/);
  assert.match(txt, /\\\*\\\*go\\\*\\\*/, "message libre échappé");
  assert.match(txt, /Équipe 1\/2/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.deepEqual(buttonIds(payload), ["lfg_join:p1", "lfg_leave:p1", "lfg_close:p1"]);
});

test("buildLfgCard : membre sans rank → « non classé », compte non lié → affiché", () => {
  const p = post({ tier: null, rating: 0, members: ["a", "b"], status: "full" });
  const txt = cardText(buildLfgCard(p, { a: { brawlhallaId: 1, tiers: {} } }));
  assert.match(txt, /non classé/);
  assert.match(txt, /compte non lié/);
  assert.match(txt, /Équipe complète/);
});

test("buildLfgCard : expirée → sans boutons", () => {
  const payload = buildLfgCard(post({ status: "expired" }), {});
  assert.match(cardText(payload), /Expirée/);
  assert.deepEqual(buttonIds(payload), []);
});

test("reservePost : une seule annonce active par membre", () => {
  const G = "g_lfg_reserve";
  const first = reservePost(G, { authorId: "u1", mode: "2v2", channelId: "c", ttlMinutes: 60 }, 1000);
  assert.ok(first.post);
  assert.equal(first.post.expiresAt, 1000 + 60 * 60 * 1000);
  const second = reservePost(G, { authorId: "u1", mode: "3v3", channelId: "c", ttlMinutes: 60 }, 2000);
  assert.equal(second.error, "already");
  assert.equal(findOpenPostByAuthor(G, "u1").id, first.post.id);
  closePost(first.post);
  assert.ok(reservePost(G, { authorId: "u1", mode: "3v3", channelId: "c", ttlMinutes: 60 }, 3000).post);
});

test("setLfgConfig : bornes et validation", async () => {
  const G = "g_lfg_cfg";
  const c = await setLfgConfig(G, { enabled: 1, ttlMinutes: 5, maxTierGap: 99, channelId: " 123456789 " });
  assert.equal(c.enabled, true);
  assert.equal(c.ttlMinutes, 10);
  assert.equal(c.maxTierGap, 6);
  assert.equal(c.channelId, "123456789");
  await assert.rejects(setLfgConfig(G, { voiceCategoryId: "abc" }), (e) => e.httpStatus === 400);
  assert.deepEqual(Object.keys(await getLfgConfig(G)).sort(), Object.keys(DEFAULT_LFG_CONFIG).sort());
});

// ---------- Tick ----------

function discordError(code) {
  const e = new Error(`Discord ${code}`);
  e.code = code;
  return e;
}

function fakeGuild(id, { channels = {}, members = [] } = {}) {
  const edits = [];
  const deletes = [];
  const makeChannel = (cid) => ({
    id: cid,
    isTextBased: () => true,
    send: async () => ({}),
    messages: {
      edit: async (mid, payload) => edits.push({ mid, payload }),
      delete: async (mid) => deletes.push(mid),
    },
  });
  const chMap = new Map(Object.entries(channels).map(([cid, v]) => [cid, v === true ? makeChannel(cid) : v]));
  return {
    id,
    edits,
    deletes,
    channels: {
      cache: new Map(),
      fetch: async (cid) => {
        if (chMap.has(cid)) return chMap.get(cid);
        throw discordError(10003);
      },
    },
    members: {
      cache: new Map(members.map((m) => [m, { id: m }])),
      fetch: async () => {
        throw discordError(10007);
      },
    },
  };
}

test("tickLfg : expire, ferme si l'auteur est parti, retire les cartes après 24 h", async () => {
  const G = "g_lfg_tick";
  await setLfgConfig(G, { enabled: true, channelId: "111111" });
  const now = 10 * 24 * 3600 * 1000;
  const due = reservePost(G, { authorId: "here", mode: "2v2", channelId: "111111", ttlMinutes: 10 }, now - 20 * 60_000).post;
  due.messageId = "m_due";
  const gone = reservePost(G, { authorId: "left", mode: "2v2", channelId: "111111", ttlMinutes: 60 }, now).post;
  gone.messageId = "m_gone";
  const old = reservePost(G, { authorId: "old", mode: "2v2", channelId: "111111", ttlMinutes: 10 }, now - 2 * 24 * 3600 * 1000).post;
  old.messageId = "m_old";
  old.status = "expired";
  old.endedAt = now - 25 * 3600 * 1000;

  const guild = fakeGuild(G, { channels: { "111111": true }, members: ["here", "old"] });
  await tickLfg(null, guild, now);

  assert.equal(due.status, "expired");
  assert.equal(gone.status, "closed");
  assert.equal(gone.closedReason, "author_left");
  assert.deepEqual(guild.edits.map((e) => e.mid).sort(), ["m_due", "m_gone"]);
  assert.deepEqual(guild.deletes, ["m_old"]);
  assert.equal(old.messageGone, true);
});

test("tickLfg : salon LFG supprimé → module désactivé", async () => {
  const G = "g_lfg_gone";
  await setLfgConfig(G, { enabled: true, channelId: "222222" });
  await tickLfg(null, fakeGuild(G), Date.now());
  assert.equal((await getLfgConfig(G)).enabled, false);
});

test("tickLfg : erreur réseau sur le salon → module laissé actif", async () => {
  const G = "g_lfg_flaky";
  await setLfgConfig(G, { enabled: true, channelId: "333333" });
  const guild = fakeGuild(G);
  guild.channels.fetch = async () => {
    throw new Error("ECONNRESET");
  };
  await tickLfg(null, guild, Date.now());
  assert.equal((await getLfgConfig(G)).enabled, true);
});
