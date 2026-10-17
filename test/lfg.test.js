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
  toggleVoice,
  lfgChannelFor,
  isLfgChannelFor,
  getLfgConfig,
  setLfgConfig,
  tickLfg,
  pingRoleFor,
  pingDecision,
  pingCooldownLeft,
  markPinged,
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
});

test("canJoin : non classé libre, même avec requireLink (mais compte lié exigé)", () => {
  assert.deepEqual(canJoin(post({ tier: "Valhallan" }), { brawlhallaId: 1, tiers: { "2v2": null } }, "b", cfg), { ok: true });
  assert.deepEqual(canJoin(post({ tier: "Tin" }), { brawlhallaId: 1, tiers: {} }, "b", cfg), { ok: true });
  assert.equal(canJoin(post(), null, "b", cfg).reason, "not_linked");
});

test("canJoin : annonce 1v1 entraînement ouverte à tous", () => {
  const p = post({ mode: "1v1", tier: "Valhallan" });
  assert.deepEqual(canJoin(p, null, "b", cfg), { ok: true }, "pas de compte lié exigé");
  assert.deepEqual(canJoin(p, link("Tin", 800, "1v1"), "b", cfg), { ok: true }, "pas de contrôle d'écart");
  assert.equal(canJoin(p, null, "a", cfg).reason, "author");
  assert.equal(canJoin({ ...p, members: ["a", "c"] }, null, "b", cfg).reason, "full");
  assert.match(cardText(buildLfgCard(p, {})), /ouvert à tous/);
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
  assert.deepEqual(buttonIds(payload), ["lfg_join:p1", "lfg_leave:p1", "lfg_close:p1", "lfg_voice:p1"]);
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

test("reservePost : une seule annonce active par membre et par mode", () => {
  const G = "g_lfg_reserve";
  const first = reservePost(G, { authorId: "u1", mode: "2v2", channelId: "c", ttlMinutes: 60 }, 1000);
  assert.ok(first.post);
  assert.equal(first.post.expiresAt, 1000 + 60 * 60 * 1000);
  const second = reservePost(G, { authorId: "u1", mode: "2v2", channelId: "c", ttlMinutes: 60 }, 2000);
  assert.equal(second.error, "already");
  assert.equal(second.post.id, first.post.id);
  const other = reservePost(G, { authorId: "u1", mode: "3v3", channelId: "c", ttlMinutes: 60 }, 2500);
  assert.ok(other.post, "un autre mode reste possible");
  assert.equal(findOpenPostByAuthor(G, "u1", "2v2").id, first.post.id);
  assert.equal(findOpenPostByAuthor(G, "u1", "3v3").id, other.post.id);
  closePost(first.post);
  assert.ok(reservePost(G, { authorId: "u1", mode: "2v2", channelId: "c", ttlMinutes: 60 }, 3000).post);
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

test("buildLfgCard : en 2v2/3v3, le rank 1v1 s'affiche à côté du rank du mode", () => {
  const both = { brawlhallaId: 1, tiers: { "2v2": "Gold", "1v1": "Diamond" }, rating2v2: 1500, rating1v1: 2010 };
  const txt = cardText(buildLfgCard(post({ members: ["a", "b"] }), { a: both, b: { brawlhallaId: 2, tiers: { "2v2": "Silver" } } }));
  assert.match(txt, /2v2 .*Gold.*· 1v1 .*Diamond.*2[\s\u202f]010/);
  assert.match(txt, /<@b> · 2v2 .*Silver.*· 1v1 \*non classé\*/, "membre qui rejoint aussi");
  const solo = cardText(buildLfgCard(post({ mode: "1v1" }), { a: both }));
  assert.doesNotMatch(solo, /· 1v1/, "en 1v1, pas de doublon");
});

test("buildLfgCard : non classé → Elo de ladder s'il en a un", () => {
  const unranked = { brawlhallaId: 1, tiers: {} };
  const p = post({ tier: null, rating: 0, members: ["a", "b"] });
  const txt = cardText(buildLfgCard(p, { a: unranked, b: unranked }, { ladder: { b: 1042 } }));
  assert.match(txt, /<@b> · 2v2 \*non classé\* · ladder 1[\s\u202f]042/);
  assert.doesNotMatch(txt, /<@a> · 2v2 \*non classé\* · ladder/, "pas d'Elo inventé");
  const ranked = cardText(buildLfgCard(post(), { a: link("Gold") }, { ladder: { a: 1200 } }));
  assert.doesNotMatch(ranked, /ladder/, "joueur classé : le rank suffit");
});

test("buildLfgCard : affiche si l'on joue en vocal (oui par défaut)", () => {
  assert.match(cardText(buildLfgCard(post({ voice: true }), {})), /🎙️ Voc/);
  assert.match(cardText(buildLfgCard(post({ voice: false }), {})), /🔇 Sans voc/);
  assert.match(cardText(buildLfgCard(post(), {})), /🎙️ Voc/, "annonce sans le champ : en vocal");
});

// ---------- Ping du rôle de recherche ----------

test("pingRoleFor : rôle du mode, vide si non configuré ou mode inconnu", () => {
  const c = { ...DEFAULT_LFG_CONFIG, pingRole1v1: "900001", pingRole2v2: "900002" };
  assert.equal(pingRoleFor(c, "1v1"), "900001");
  assert.equal(pingRoleFor(c, "2v2"), "900002");
  assert.equal(pingRoleFor(c, "3v3"), "");
  assert.equal(pingRoleFor(c, "4v4"), "");
});

test("pingDecision : ping si le rôle existe, est mentionnable et hors délai anti-spam", () => {
  const role = { id: "900001", mentionable: true };
  assert.deepEqual(pingDecision("900001", { role }), { roleId: "900001", reason: null });
  assert.deepEqual(pingDecision("", { role }), { roleId: "", reason: null });
  assert.equal(pingDecision("900001", { role: null }).reason, "missing");
  assert.equal(pingDecision("900001", { role: { mentionable: false } }).reason, "not_mentionable");
  assert.equal(pingDecision("900001", { role: { mentionable: false }, botCanMentionAll: true }).roleId, "900001");
  assert.equal(pingDecision("900001", { role, cooldownLeftMs: 1000 }).reason, "cooldown");
});

test("buildLfgCard : le rôle n'est notifié qu'à l'envoi initial", () => {
  const p = post({ pingRoleId: "900002" });
  const sent = buildLfgCard(p, {}, { ping: true });
  assert.match(cardText(sent), /<@&900002>/);
  assert.deepEqual(sent.allowedMentions, { roles: ["900002"] }, "seul le rôle peut notifier, aucun membre");
  assert.deepEqual(buildLfgCard(p, {}).allowedMentions, { parse: [] }, "une édition ne pingue personne");
  assert.doesNotMatch(cardText(buildLfgCard({ ...p, status: "expired" }, {})), /<@&/);
  assert.deepEqual(buildLfgCard(post(), {}, { ping: true }).allowedMentions, { parse: [] }, "pas de rôle : pas de ping");
});

test("pingCooldownLeft / markPinged : délai anti-spam par membre", () => {
  const G = "g_lfg_ping";
  assert.equal(pingCooldownLeft(G, "u1", 15 * 60_000, 1_000_000), 0);
  markPinged(G, "u1", 1_000_000);
  assert.equal(pingCooldownLeft(G, "u1", 15 * 60_000, 1_000_000 + 60_000), 14 * 60_000);
  assert.equal(pingCooldownLeft(G, "u1", 0, 1_000_000), 0, "délai 0 : ping à chaque annonce");
  assert.equal(pingCooldownLeft(G, "u2", 15 * 60_000, 1_000_000), 0, "délai propre à chaque membre");
});

test("setLfgConfig : rôles de ping et délai validés", async () => {
  const G = "g_lfg_pingcfg";
  const c = await setLfgConfig(G, { pingRole2v2: "900002", pingCooldownMinutes: -5 });
  assert.equal(c.pingRole2v2, "900002");
  assert.equal(c.pingCooldownMinutes, 0);
  await assert.rejects(setLfgConfig(G, { pingRole1v1: "@everyone" }), (e) => e.httpStatus === 400);
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

const buttonLabels = (payload) =>
  payload.components[0]
    .toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((row) => row.components.map((b) => b.label));

test("bouton vocal : libellé explicite selon l'état, absent une fois l'annonce terminée", () => {
  assert.ok(buttonLabels(buildLfgCard(post(), {})).includes("Passer sans vocal"));
  assert.ok(buttonLabels(buildLfgCard(post({ voice: false }), {})).includes("Repasser en vocal"));
  assert.deepEqual(buttonIds(buildLfgCard(post({ status: "full" }), {})), []);
});

test("toggleVoice : bascule une annonce ouverte, refuse une annonce terminée", () => {
  const p = post();
  assert.equal(toggleVoice(p), true);
  assert.equal(p.voice, false);
  assert.match(cardText(buildLfgCard(p, {})), /🔇 Sans voc/);
  assert.equal(toggleVoice(p), true);
  assert.equal(p.voice, true);
  const done = post({ status: "full", voice: true });
  assert.equal(toggleVoice(done), false);
  assert.equal(done.voice, true);
});

test("lfgChannelFor / isLfgChannelFor : salon du mode, sinon salon par défaut", () => {
  const c = { ...DEFAULT_LFG_CONFIG, channelId: "100", channel1v1: "101" };
  assert.equal(lfgChannelFor(c, "1v1"), "101");
  assert.equal(lfgChannelFor(c, "2v2"), "100");
  assert.equal(lfgChannelFor(c, "4v4"), "100");
  assert.equal(lfgChannelFor({ ...DEFAULT_LFG_CONFIG }, "2v2"), "");
  assert.equal(isLfgChannelFor(c, "1v1", "101"), true);
  assert.equal(isLfgChannelFor(c, "1v1", "100"), true, "salon par défaut accepté pour tous les modes");
  assert.equal(isLfgChannelFor(c, "2v2", "101"), false, "salon d'un autre mode refusé");
  assert.equal(isLfgChannelFor({ ...DEFAULT_LFG_CONFIG }, "2v2", ""), false);
});

test("setLfgConfig : salons par mode validés", async () => {
  const G = "g_lfg_cfg_modes";
  const cfg = await setLfgConfig(G, { channel2v2: "123456789012345678" });
  assert.equal(cfg.channel2v2, "123456789012345678");
  await assert.rejects(() => setLfgConfig(G, { channel3v3: "pas-un-id" }), /channel3v3/);
});

test("tickLfg : salon d'un mode supprimé → le mode repasse sur le salon par défaut", async () => {
  const G = "g_lfg_mode_gone";
  await setLfgConfig(G, { enabled: true, channelId: "444001", channel2v2: "444002" });
  await tickLfg(null, fakeGuild(G, { channels: { "444001": true } }), Date.now());
  const cfg = await getLfgConfig(G);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.channel2v2, "");
});
