import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import {
  tierOfReaction,
  scoreGuess,
  tallyVotes,
  truthTierFromLink,
  revealText,
  getGuessRankConfig,
  setGuessRankConfig,
  handleGuessRankMessage,
  tickGuessReveals,
  listPendingReveals,
  guessStats,
  REVEAL_MAX_ATTEMPTS,
} from "../src/guessrank.js";
import { evaluateAchievements, topCounters, listUnlocked } from "../src/achievements.js";
import { setLink } from "../src/store.js";

/**
 * « Devine ton rang » noté : conversion emoji → tier, barème, dépouillement des votes, et
 * révélation de bout en bout (fakes Discord). Base SQLite temporaire de scripts/run-tests.js.
 */

const CFG = {
  reactions: ["⚫", "<:bronze:111>", "<:silver:222>", "<a:gold:333>", "🟦", "<:diamond:555>", "🟣"],
  pointsExact: 3,
  pointsNear: 1,
};

// ---------- tierOfReaction ----------

test("tierOfReaction : emoji custom par ID, forme <:nom:id> et emoji animé", () => {
  assert.equal(tierOfReaction("111", CFG), "Bronze");
  assert.equal(tierOfReaction("<:silver:222>", CFG), "Silver");
  assert.equal(tierOfReaction("333", CFG), "Gold");
  assert.equal(tierOfReaction("555", CFG), "Diamond");
});

test("tierOfReaction : emoji unicode, avec ou sans sélecteur de variante", () => {
  assert.equal(tierOfReaction("⚫", CFG), "Tin");
  assert.equal(tierOfReaction("⚫️", CFG), "Tin");
  assert.equal(tierOfReaction("🟣", CFG), "Valhallan");
});

test("tierOfReaction : emoji hors liste, vide ou au-delà des 7 tiers → null", () => {
  assert.equal(tierOfReaction("🔥", CFG), null);
  assert.equal(tierOfReaction("999", CFG), null);
  assert.equal(tierOfReaction("", CFG), null);
  assert.equal(tierOfReaction("🎉", { reactions: [...CFG.reactions, "🎉"] }), null);
});

// ---------- scoreGuess ----------

test("scoreGuess : exact, à un tier près, à deux tiers, tier inconnu", () => {
  assert.equal(scoreGuess("Diamond", "Diamond", CFG), 3);
  assert.equal(scoreGuess("Diamond", "Platinum", CFG), 1);
  assert.equal(scoreGuess("Diamond", "Valhallan", CFG), 1);
  assert.equal(scoreGuess("Diamond", "Gold", CFG), 0);
  assert.equal(scoreGuess("Diamond", "Mithril", CFG), 0);
  assert.equal(scoreGuess(null, "Gold", CFG), 0);
});

test("scoreGuess : barème configurable, 0 point à un tier près possible", () => {
  assert.equal(scoreGuess("Gold", "Gold", { pointsExact: 5, pointsNear: 0 }), 5);
  assert.equal(scoreGuess("Gold", "Silver", { pointsExact: 5, pointsNear: 0 }), 0);
});

// ---------- tallyVotes ----------

test("tallyVotes : auteur et bots exclus", () => {
  const votes = [
    { userId: "author", tier: "Gold" },
    { userId: "bot", tier: "Gold", bot: true },
    { userId: "a", tier: "Gold" },
    { userId: "b", tier: "Silver" },
    { userId: "c", tier: "Tin" },
  ];
  const t = tallyVotes(votes, "Gold", CFG, { authorId: "author" });
  assert.equal(t.total, 3);
  assert.deepEqual(t.winners.map((r) => r.userId), ["a"]);
  assert.deepEqual(t.nearly.map((r) => r.userId), ["b"]);
  assert.equal(t.results.find((r) => r.userId === "c").points, 0);
});

test("tallyVotes : un seul vote par membre (plusieurs rangs différents = vote annulé)", () => {
  const votes = [
    { userId: "a", tier: "Gold" },
    { userId: "a", tier: "Silver" },
    { userId: "b", tier: "Gold" },
    { userId: "b", tier: "Gold" },
    { userId: "c", tier: "Mithril" },
  ];
  const t = tallyVotes(votes, "Gold", CFG);
  assert.equal(t.total, 1);
  assert.deepEqual(t.results, [{ userId: "b", tier: "Gold", points: 3, exact: true }]);
});

test("tallyVotes : aucun vote", () => {
  const t = tallyVotes([], "Gold", CFG);
  assert.deepEqual(t, { results: [], winners: [], nearly: [], total: 0 });
});

// ---------- vérité et texte ----------

test("truthTierFromLink : modes 1v1, peak et highest", () => {
  const link = { tiers: { "1v1": "Gold", "2v2": "Diamond" }, peakTiers: { "1v1": "Platinum" } };
  assert.equal(truthTierFromLink(link, "1v1"), "Gold");
  assert.equal(truthTierFromLink(link, "peak"), "Platinum");
  assert.equal(truthTierFromLink(link, "highest"), "Diamond");
  assert.equal(truthTierFromLink({ tiers: { "1v1": "Gold" } }, "peak"), "Gold");
  assert.equal(truthTierFromLink({ tiers: {} }, "1v1"), null);
  assert.equal(truthTierFromLink(null, "1v1"), null);
});

test("revealText : gagnants, au plus près, personne", () => {
  const t = tallyVotes([{ userId: "a", tier: "Gold" }, { userId: "b", tier: "Gold" }, { userId: "c", tier: "Tin" }], "Gold", CFG);
  const txt = revealText("Gold", t);
  assert.match(txt, /\*\*Gold\*\*/);
  assert.match(txt, /2 devins sur 3 ont trouvé/);
  assert.match(txt, /<@a> \(\+3\), <@b> \(\+3\)/);
  const near = revealText("Gold", tallyVotes([{ userId: "x", tier: "Silver" }], "Gold", CFG));
  assert.match(near, /0 devin sur 1 a trouvé\. Au plus près : <@x> \(\+1\)/);
  assert.match(revealText("Gold", tallyVotes([], "Gold", CFG)), /personne n'a voté/);
});

// ---------- config ----------

test("config : valeurs du score bornées et mode inconnu remplacé", async () => {
  const cfg = await setGuessRankConfig("g_clamp", { revealDelayHours: 9999, pointsExact: -4, pointsNear: "abc", truthMode: "3v3" });
  assert.equal(cfg.revealDelayHours, 168);
  assert.equal(cfg.pointsExact, 1);
  assert.equal(cfg.pointsNear, 1);
  assert.equal(cfg.truthMode, "1v1");
  assert.equal(cfg.scoringEnabled, false);
  assert.equal((await getGuessRankConfig("g_clamp")).revealDelayHours, 168);
});

// ---------- succès ----------

test("succès guess10 / guess50 / guessmaster", () => {
  assert.ok(evaluateAchievements({ guessGames: 10 }).includes("guess10"));
  assert.ok(!evaluateAchievements({ guessGames: 10 }).includes("guess50"));
  assert.ok(evaluateAchievements({ guessGames: 50 }).includes("guess50"));
  assert.ok(evaluateAchievements({ guessPoints: 100 }).includes("guessmaster"));
  assert.ok(!evaluateAchievements({ guessPoints: 99 }).includes("guessmaster"));
});

// ---------- bout en bout : post du clip → révélation ----------

const G = "g_guess_score";
const CH = "guess_ch";
const HOUR = 3600_000;

// Réaction factice : `voters` = [{ id, bot }], paginée par 100 comme l'API.
function fakeReaction(emoji, voters) {
  return {
    emoji,
    users: {
      fetch: async ({ limit = 100, after } = {}) => {
        const start = after ? voters.findIndex((v) => v.id === after) + 1 : 0;
        const col = new Collection();
        for (const v of voters.slice(start, start + limit)) col.set(v.id, { id: v.id, bot: Boolean(v.bot) });
        return col;
      },
    },
  };
}

function clipMessage(id, authorId) {
  return {
    id,
    guild: { id: G },
    channel: { id: CH },
    author: { id: authorId, bot: false },
    content: "https://youtu.be/xyz",
    attachments: new Collection(),
    embeds: [],
    reference: null,
    react: async () => {},
  };
}

// Client factice : `messages` = Map id -> { reactions, error } ; `replies` collecte les révélations.
function fakeClient(messages, replies) {
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: async ({ message }) => {
        const m = messages.get(message);
        if (!m || m.error) throw m?.error ?? Object.assign(new Error("Unknown Message"), { code: 10008 });
        const reactions = new Collection(m.reactions.map((r, i) => [String(i), r]));
        return { id: message, reactions: { cache: reactions }, reply: async (p) => replies.push({ id: message, ...p }) };
      },
    },
  };
  const guild = { id: G, channels: { fetch: async () => channel } };
  return { guilds: { cache: new Map([[G, guild]]) } };
}

test.before(async () => {
  await setGuessRankConfig(G, {
    enabled: true,
    channelIds: [CH],
    reactions: CFG.reactions,
    scoringEnabled: true,
    revealDelayHours: 24,
  });
  await setLink("auteur_gold", 1, "Auteur", { tiers: { "1v1": "Gold" } });
  await setLink("auteur_sans_rang", 2, "Nouveau", { tiers: {} });
});

test("clip d'un auteur lié : révélation planifiée avec le rang figé ; sinon rien", async () => {
  assert.equal(await handleGuessRankMessage(clipMessage("m_gold", "auteur_gold")), true);
  assert.equal(await handleGuessRankMessage(clipMessage("m_unlinked", "inconnu")), true);
  assert.equal(await handleGuessRankMessage(clipMessage("m_norank", "auteur_sans_rang")), true);
  const rows = listPendingReveals().filter((r) => r.guild_id === G);
  assert.deepEqual(rows.map((r) => r.message_id), ["m_gold"]);
  assert.equal(rows[0].truth_tier, "Gold");
  assert.equal(rows[0].author_id, "auteur_gold");
});

test("révélation : rien avant l'échéance, puis points, réponse sans ping et ligne supprimée", async () => {
  const pending = listPendingReveals().find((r) => r.message_id === "m_gold");
  const replies = [];
  // 150 votants sur Gold (pagination), un bot, l'auteur, un voisin Silver, un Tin.
  const goldVoters = Array.from({ length: 150 }, (_, i) => ({ id: `v${String(i).padStart(3, "0")}` }));
  goldVoters.push({ id: "un_bot", bot: true }, { id: "auteur_gold" });
  const messages = new Map([
    [
      "m_gold",
      {
        reactions: [
          fakeReaction({ id: "333", name: "gold" }, goldVoters),
          fakeReaction({ id: "222", name: "silver" }, [{ id: "voisin" }]),
          fakeReaction({ id: null, name: "⚫" }, [{ id: "loin" }]),
          fakeReaction({ id: null, name: "🔥" }, [{ id: "hors_jeu" }]),
        ],
      },
    ],
  ]);
  const client = fakeClient(messages, replies);

  assert.equal(await tickGuessReveals(client, pending.reveal_at - 1), 0);
  assert.equal(replies.length, 0);

  assert.equal(await tickGuessReveals(client, pending.reveal_at), 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /150 devins sur 152 ont trouvé/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(listPendingReveals().some((r) => r.message_id === "m_gold"), false);

  assert.deepEqual(guessStats(G, "v000"), { points: 3, games: 1, exact: 1, precision: 100, place: 1 });
  assert.deepEqual(guessStats(G, "voisin"), { points: 1, games: 1, exact: 0, precision: 0, place: 151 });
  assert.equal(guessStats(G, "loin").games, 1);
  assert.equal(guessStats(G, "loin").points, 0);
  assert.equal(guessStats(G, "un_bot").games, 0);
  assert.equal(guessStats(G, "auteur_gold").games, 0);
  assert.equal(guessStats(G, "hors_jeu").games, 0);

  const top = topCounters(G, "guess_points", 200);
  assert.equal(top.length, 151);
  assert.equal(top.at(-1).userId, "voisin");

  // Déjà révélé : un second passage ne recompte rien.
  assert.equal(await tickGuessReveals(client, pending.reveal_at + HOUR), 0);
  assert.equal(guessStats(G, "v000").points, 3);
});

test("révélation : message supprimé → ligne retirée, rien posté", async () => {
  await handleGuessRankMessage(clipMessage("m_deleted", "auteur_gold"));
  const replies = [];
  const at = listPendingReveals().find((r) => r.message_id === "m_deleted").reveal_at;
  assert.equal(await tickGuessReveals(fakeClient(new Map(), replies), at), 0);
  assert.equal(replies.length, 0);
  assert.equal(listPendingReveals().some((r) => r.message_id === "m_deleted"), false);
});

test("révélation : erreur temporaire → réessai plus tard, abandon après plusieurs échecs", async () => {
  await handleGuessRankMessage(clipMessage("m_flaky", "auteur_gold"));
  const replies = [];
  const messages = new Map([["m_flaky", { error: Object.assign(new Error("Service Unavailable"), { status: 503 }) }]]);
  const client = fakeClient(messages, replies);
  let row = listPendingReveals().find((r) => r.message_id === "m_flaky");
  for (let i = 1; i < REVEAL_MAX_ATTEMPTS; i++) {
    await tickGuessReveals(client, row.reveal_at);
    row = listPendingReveals().find((r) => r.message_id === "m_flaky");
    assert.equal(row.attempts, i);
  }
  await tickGuessReveals(client, row.reveal_at);
  assert.equal(listPendingReveals().some((r) => r.message_id === "m_flaky"), false);
  assert.equal(replies.length, 0);
});

test("révélation : score coupé entre-temps → abandon sans rien poster ni compter", async () => {
  await handleGuessRankMessage(clipMessage("m_off", "auteur_gold"));
  const at = listPendingReveals().find((r) => r.message_id === "m_off").reveal_at;
  await setGuessRankConfig(G, { scoringEnabled: false });
  const replies = [];
  const messages = new Map([["m_off", { reactions: [fakeReaction({ id: "333", name: "gold" }, [{ id: "late" }])] }]]);
  await tickGuessReveals(fakeClient(messages, replies), at);
  await setGuessRankConfig(G, { scoringEnabled: true });
  assert.equal(replies.length, 0);
  assert.equal(guessStats(G, "late").games, 0);
  assert.equal(listPendingReveals().some((r) => r.message_id === "m_off"), false);
});

test("succès débloqués à la révélation (10 parties)", async () => {
  for (let i = 0; i < 10; i++) {
    const id = `m_ach_${i}`;
    await handleGuessRankMessage(clipMessage(id, "auteur_gold"));
    const at = listPendingReveals().find((r) => r.message_id === id).reveal_at;
    const messages = new Map([[id, { reactions: [fakeReaction({ id: "333", name: "gold" }, [{ id: "assidu" }])] }]]);
    await tickGuessReveals(fakeClient(messages, []), at);
  }
  assert.equal(guessStats(G, "assidu").games, 10);
  assert.equal(guessStats(G, "assidu").points, 30);
  assert.ok(listUnlocked(G, "assidu").has("guess10"));
  assert.ok(!listUnlocked(G, "assidu").has("guessmaster"));
});
