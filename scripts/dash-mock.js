// Serveur de développement du dashboard, SANS Discord ni base de données.
//
// Sert src/web/public avec les mêmes en-têtes de sécurité (CSP) que le vrai
// serveur, et simule toute l'API /api/* avec des données fictives en mémoire.
// Aucun module du bot n'est importé : rien n'est publié sur Discord et
// data/bot.db n'est jamais ouvert.
//
//   node scripts/dash-mock.js            → http://127.0.0.1:4173
//   MOCK_PORT=5000 node scripts/dash-mock.js
//
// Scénarios (états vide, chargement, erreur…) : ouvrir
//   /__mock/scenario/<nom>   nom ∈ full | empty | errors | slow | loggedout | notadmin | bootfail | expired
// puis recharger le dashboard. /__mock affiche le scénario courant.
//
// Combo Lab (page publique) : http://127.0.0.1:4173/lab/ — mêmes routes que la prod
// (src/web/comboLab.js), dataset réel data/combos.json, vidéos récupérées sur BrawlDatabase
// (réseau requis pour la lecture). Scénarios pris en compte : empty, errors, slow.

import express from "express";
import { readFileSync } from "node:fs";
// Moteur de filtre réel (module pur, sans Discord ni base) : le testeur du dashboard
// donne ici exactement les mêmes verdicts qu'en production.
import { compileFilter, findMatches, maskText, matchedTerms, STARTER_TERMS } from "../src/wordfilterEngine.js";
// Routes du Combo Lab (module pur, sans Discord ni base) : identiques à la prod.
import { mountComboLab } from "../src/web/comboLab.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "src", "web", "public");
const PORT = Number(process.env.MOCK_PORT) || 4173;
const SCENARIOS = ["full", "empty", "errors", "slow", "loggedout", "notadmin", "bootfail", "expired"];

let scenario = SCENARIOS.includes(process.env.MOCK_SCENARIO) ? process.env.MOCK_SCENARIO : "full";
let loggedOut = false;

// ─────────────────────────── Données fictives ───────────────────────────
const TIERS = ["Tin", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Valhallan"];
let idSeq = 1000;
const nextId = () => String(++idSeq);
const ch = (name) => ({ id: nextId(), name });

const text = ["général", "annonces", "lier-mon-compte", "clips", "devine-ton-rang", "validation", "audit", "alertes", "succès", "inscriptions-tournoi", "tournoi-annonces", "tiktok", "bienvenue", "au-revoir", "lol-discussion", "support", "hall-of-fame", "rappels", "combos"].map(ch);
const voice = ["Créer un vocal", "Général", "Tournoi", "Chill"].map(ch);
const category = ["Communauté", "Vocaux", "Tickets", "Tournoi", "Vocaux rank"].map(ch);
const announcement = ["news"].map(ch);
// Fils : cas réel du serveur, le salon de validation est un fil du salon « lier-mon-compte ».
const thread = [
  { id: nextId(), name: "Validation", parentId: text.find((c) => c.name === "lier-mon-compte").id, parentName: "lier-mon-compte", archived: false },
  { id: nextId(), name: "Annonces tournoi", parentId: text.find((c) => c.name === "général").id, parentName: "général", archived: false },
];
const byName = (list, n) => list.find((c) => c.name === n).id;
const roles = [
  ["Admin", "#e5534b"],
  ["Staff", "#d6a13b"],
  ["Valideur de Rank", "#4ea1ff"],
  ["Tournoi", "#9b6bd6"],
  ["Participant", "#46b97a"],
  ["League of Legends", "#c8aa6e"],
  ["Booster", "#f47fff"],
  ["Niveau 10+", "#6fb3ff"],
  ["Niveau 50+", "#ffb86b"],
  ["Membre", "#000000"],
].map(([name, color]) => ({ id: nextId(), name, color }));
const roleId = (n) => roles.find((r) => r.name === n).id;

const guild = {
  name: "Xray Kaya",
  id: "900000000000000000",
  icon: "/favicon-192.png",
  memberCount: 12480,
  tiers: TIERS,
  channels: { text, voice, category, announcement, thread },
  roles,
  emojis: [
    { id: "1", name: "xk", animated: false, token: "<:xk:1>", url: "/favicon-32.png" },
    { id: "2", name: "kaya", animated: false, token: "<:kaya:2>", url: "/favicon-192.png" },
  ],
};

function baseConfig() {
  return {
    settings: {
      reviewChannelId: thread[0].id,
      reviewerRoleId: roleId("Valideur de Rank"),
      auditChannelId: byName(text, "audit"),
      announceChannelId: byName(text, "annonces"),
      alertChannelId: "",
      achievementsChannelId: byName(text, "succès"),
      autoApproveTier: "Platinum",
      requireProofScreenshot: true,
      proofTier: "Valhallan",
      proofChannelId: "",
      startggToken: "",
    },
    levels: {
      enabled: true,
      announceMode: "channel",
      announceChannelId: "",
      cooldownSec: 60,
      minXp: 15,
      maxXp: 25,
      voiceEnabled: true,
      voiceXpPerMin: 10,
      weekendBonus: 1.5,
      boosterRoleId: roleId("Booster"),
      boosterMultiplier: 1.5,
      dailyXpCap: 0,
      noXpChannels: [byName(text, "audit")],
      stackRewards: false,
      rewards: { 10: roleId("Niveau 10+"), 50: roleId("Niveau 50+") },
    },
    tiktok:
      scenario === "empty"
        ? { enabled: false, account: "", feedUrl: "", username: "", avatarUrl: "", pollIntervalMin: 2, channelId: "", roleId: "", showDate: true, message: "" }
        : { enabled: true, account: "kayagoldforged", feedUrl: "https://example.com/rss/kayagoldforged.xml", username: "", avatarUrl: "", pollIntervalMin: 2, channelId: byName(text, "tiktok"), roleId: roleId("Membre"), showDate: true, message: "" },
    wordfilter: {
      enabled: scenario !== "empty",
      words: scenario === "empty" ? [] : ["connard", "encul*", "fils de pute", "fdp", "*merde*", "con"],
      allowed: scenario === "empty" ? [] : ["concombre"],
      evasion: true,
      ignoreLinks: true,
      checkEdits: true,
      action: "delete",
      warnMode: "channel",
      warnMessage: "{user}, ton message a été retiré : il contient un terme interdit sur ce serveur.",
      warnDeleteSec: 8,
      ignoreStaff: true,
      exemptRoleIds: [],
      exemptChannelIds: [],
      logChannelId: byName(text, "audit"),
      timeoutEnabled: false,
      timeoutAfter: 3,
      timeoutWindowMin: 10,
      timeoutMinutes: 10,
    },
    clips: { enabled: true, channelIds: [byName(text, "clips")], reactions: ["🔥", "👍", "<:xk:1>"], requireVideo: true, deleteNonVideo: false, ignoreBots: true, ignoreReplies: true, pinThreshold: 10, extraDomains: ["catbox.moe"] },
    guessrank: { enabled: false, channelIds: [], reactions: [], ignoreBots: true, ignoreReplies: true, requireVideo: true, deleteNonVideo: false, extraDomains: [], singleVote: true },
    tempvoice: { enabled: true, categoryId: "", hubs: { [byName(voice, "Créer un vocal")]: { nameTemplate: "{user}", userLimit: 0 } } },
    reminders: { enabled: false, channelId: byName(text, "rappels"), intervalMinutes: 120, mode: "rotate", messages: ["Vocaux privés : rejoins « Créer un vocal ».", "Lie ton compte Brawlhalla avec /lier pour obtenir tes rôles de rank."] },
    linkpanel: {
      enabled: false,
      channelId: "",
      title: "🔗 Lier ton compte Brawlhalla",
      description: "Relie ton compte en 10 secondes et reçois automatiquement tes rôles selon ton rang.",
      benefitsTitle: "✨ Pourquoi lier ton compte ?",
      benefits: "🎖️ **Rôles de rank automatiques** en 1v1 & 2v2\n🔄 **Mise à jour auto** de tes rôles\n📊 Tes stats via `/stats` et `/rank`",
      footerText: "💡 Le plus fiable : ton **Brawlhalla ID**.",
      color: "#4ea1ff",
      buttonLabel: "Lier mon compte",
      thumbnailUrl: "",
      bannerUrl: "",
    },
    tickets: {
      enabled: true,
      categoryId: byName(category, "Tickets"),
      staffRoleId: roleId("Staff"),
      logChannelId: "",
      panelTitle: "🎫 Support & Tickets",
      panelDescription: "Besoin d'aide ? Choisis un motif dans le menu ci-dessous pour ouvrir un ticket privé.",
      panelColor: "#5865f2",
      bannerUrl: "",
      thumbnailUrl: "",
      rulesText: "• Explique ton problème directement\n• Reste respectueux et patient",
      tosUrl: "",
      selectPlaceholder: "Choisis un motif pour ouvrir un ticket",
      rulesTitle: "📋 Étapes à suivre",
      optionsTitle: "🎫 Options de ticket",
      footerText: "🚀 Choisis un motif dans le menu ci-dessous.",
      ticketTitle: "🎫 Support Ticket",
      ticketWelcome: "Merci de patienter, un membre du staff va prendre en charge ton ticket.",
      ticketInfo: "",
      topics: [
        { id: "t1", label: "Support", emoji: "🛟", description: "Une question, un souci", message: "" },
        { id: "t2", label: "Signalement", emoji: "🚨", description: "Signaler un membre", message: "Joins une capture si possible." },
      ],
      counter: 42,
    },
    giveaway: {
      enabled: true,
      defaultChannelId: byName(text, "annonces"),
      pingRoleId: "",
      requiredRoleId: "",
      embedTitle: "GIVEAWAY",
      embedColor: "#f1c40f",
      bannerUrl: "",
      buttonLabel: "Participer",
      buttonEmoji: "🎉",
      footerText: "Bonne chance à toutes et à tous !",
      dmWinners: true,
      winnerAnnounce: "🎉 Félicitations {winners} ! Vous remportez **{prize}** 🏆",
      winnerDm: "🎉 Tu as gagné **{prize}** !",
      noWinnerMessage: "😢 Le giveaway **{prize}** se termine sans participant.",
      defaultDuration: "24h",
      defaultWinners: 1,
    },
    welcome: {
      enabled: true,
      channelId: byName(text, "bienvenue"),
      mode: "both",
      pingUser: true,
      text: "Bienvenue {user} sur **{server}** !",
      embed: { color: "#3b6de6", title: "Bienvenue {username} !", description: "Tu es le membre n°{membercount}. Passe lire les règles et lie ton compte avec /lier.", thumbnailUser: true, image: "", footer: "{server}", footerIcon: true },
      autoRoleEnabled: true,
      autoRoleIds: [roleId("Membre")],
      goodbyeEnabled: false,
      goodbyeChannelId: "",
      goodbyeText: "{username} a quitté le serveur.",
    },
    lol: { enabled: false, roleId: roleId("League of Legends"), channelId: byName(text, "lol-discussion"), oncePerMember: true, mode: "embed", pingUser: true, text: "", embed: { color: "#c8aa6e", title: "Bienvenue sur la section LoL, {username} !", description: "Présente-toi et trouve des duos ici.", thumbnailUser: true, image: "", footer: "{server} · Section LoL", footerIcon: true } },
  };
}

const PLAYERS = ["Kaya", "Nox", "Zephyr", "Lumen", "Vex", "Orion", "Mira", "Sable", "Juno", "Rift", "Echo", "Onyx"];

function makeTournament(status = "running") {
  const participants = PLAYERS.slice(0, 8).map((name, i) => ({ id: "e" + i, name, members: [String(5000 + i)], checkedIn: i !== 5, eliminated: false }));
  const t = {
    name: "Tournoi du samedi",
    format: "1v1",
    region: "EU",
    maxParticipants: 16,
    bestOf: 3,
    finalsBestOf: 5,
    rulesText: "Stock · 3 vies · 8 min",
    prizeText: "Nitro",
    mapPool: "",
    checkInEnabled: true,
    status: "draft",
    signupChannelId: byName(text, "inscriptions-tournoi"),
    signupMessageId: "",
    announceChannelId: byName(text, "tournoi-annonces"),
    participantRoleId: roleId("Participant"),
    pingRoleId: roleId("Tournoi"),
    startTime: "Sam. 21 h",
    matchCategoryId: byName(category, "Tournoi"),
    modRoleId: roleId("Staff"),
    modAlertChannelId: byName(text, "alertes"),
    createVoice: false,
    alertMinutes: 7,
    forfeitMinutes: 10,
    castFromTopN: 4,
    hallOfFameChannelId: byName(text, "hall-of-fame"),
    participants,
    matches: {},
    rounds: 0,
    createdAt: Date.now(),
  };
  if (status === "running") {
    generate(t);
    t.signupMessageId = "m1";
    report(t, "r0m0", 2, 0);
    report(t, "r0m1", 1, 2);
    t.matches.r0m2.status = "dispute";
    t.matches.r0m2.reports = { [t.matches.r0m2.aId]: { a: 2, b: 1 }, [t.matches.r0m2.bId]: { a: 1, b: 2 } };
    t.matches.r0m2.channelId = nextId();
    t.matches.r0m3.status = "live";
    t.matches.r0m3.scoreA = 1;
  } else t.status = status;
  return t;
}

function generate(t) {
  const n = t.participants.length;
  let size = 2;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const matches = {};
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1);
    for (let i = 0; i < count; i++) matches[`r${r}m${i}`] = { round: r, index: i, aId: null, bId: null, scoreA: 0, scoreB: 0, winnerId: null, status: "pending" };
  }
  for (let i = 0; i < size / 2; i++) {
    const a = t.participants[i];
    const b = t.participants[size - 1 - i];
    const m = matches[`r0m${i}`];
    m.aId = a ? a.id : null;
    m.bId = b ? b.id : null;
  }
  t.matches = matches;
  t.rounds = rounds;
  t.status = "running";
  for (const m of Object.values(matches)) if (m.round >= rounds - Math.log2(t.castFromTopN || 1) && t.castFromTopN) m.locked = true;
  for (const [id, m] of Object.entries(matches)) if (m.round === 0 && m.aId && !m.bId) advance(t, id, m.aId);
}

function advance(t, id, winnerId) {
  const m = t.matches[id];
  m.winnerId = winnerId;
  m.status = "done";
  const loser = m.aId === winnerId ? m.bId : m.aId;
  const lp = t.participants.find((p) => p.id === loser);
  if (lp) lp.eliminated = true;
  if (m.round < t.rounds - 1) {
    const next = t.matches[`r${m.round + 1}m${Math.floor(m.index / 2)}`];
    if (m.index % 2 === 0) next.aId = winnerId;
    else next.bId = winnerId;
  } else t.status = "completed";
}

function report(t, id, a, b) {
  const m = t.matches[id];
  if (!m || !m.aId || !m.bId) throw new Error("Match introuvable.");
  m.scoreA = a;
  m.scoreB = b;
  advance(t, id, a > b ? m.aId : m.bId);
}

function makeState() {
  const now = Date.now();
  const empty = scenario === "empty";
  const giveaway = (id, prize, status, extra = {}) => ({
    id,
    prize,
    description: "",
    channelId: byName(text, "annonces"),
    messageId: "m" + id,
    winnersCount: 1,
    requiredRoleId: null,
    hostId: "1",
    endsTs: now + 3 * 3600 * 1000,
    createdTs: now - 3600 * 1000,
    status,
    winnerIds: [],
    entries: 37,
    ...extra,
  });
  return {
    config: baseConfig(),
    tournament: empty ? null : makeTournament("running"),
    history: empty
      ? []
      : [
          { id: "h1", name: "Tournoi de la rentrée", format: "1v1", bestOf: 3, participants: 16, winner: "Nox", archivedAt: now - 20 * 86400000, snapshot: (() => { const t = makeTournament("draft"); generate(t); for (const id of Object.keys(t.matches).sort()) { const m = t.matches[id]; if (m.aId && m.bId && m.status !== "done") report(t, id, 2, 1); } return t; })() },
          { id: "h2", name: "Coupe 2v2", format: "2v2", bestOf: 3, participants: 8, winner: null, archivedAt: now - 60 * 86400000, snapshot: null },
        ],
    giveaways: empty
      ? []
      : [
          giveaway(1, "Nitro classique 1 mois", "active", { description: "Réservé aux membres liés.", endsTs: now + 2 * 3600 * 1000 }),
          giveaway(2, "Skin Brawlhalla", "active", { endsTs: now + 3 * 86400000, entries: 112, winnersCount: 3 }),
          giveaway(3, "Mammoth Coins", "ended", { endsTs: now - 2 * 86400000, winnerIds: ["5001"], entries: 88 }),
          giveaway(4, "Carte cadeau", "cancelled", { endsTs: now - 9 * 86400000, entries: 12 }),
        ],
    logs: empty ? [] : Array.from({ length: 60 }, (_, i) => fakeLog(now - (60 - i) * 45000, i)),
    greeted: 14,
    wordfilterLog: empty ? [] : fakeFilterLog(now),
    tiktok: empty ? emptyTikTokState() : fakeTikTokState(now),
  };
}

const LOG_MSGS = [
  ["log", "Sync rank : Kaya → 1v1 Diamond (2021)"],
  ["log", "Liaison validée : Nox (Platinum) — auto-validation"],
  ["log", "XP : Zephyr passe niveau 12"],
  ["warn", "API Brawlhalla : 429, cooldown 30 s"],
  ["log", "Tournoi : score reporté r0m1 (1-2)"],
  ["error", "Échec d'envoi dans #tiktok : Missing Permissions"],
  ["log", "Vocal temporaire créé pour Lumen"],
  ["log", "Index du classement : 40 123 joueurs synchronisés"],
];

// Historique du filtre de mots (extraits déjà masqués, comme en production).
function fakeFilterLog(now) {
  const rows = [
    [3, "Nox", "général", ["connard"], "delete", "t'es vraiment un *******", false, false],
    [40, "Vex", "clips", ["encul*"], "delete", "espèce d'****** va", true, false],
    [180, "Vex", "général", ["fdp"], "delete", "*** sérieux", false, true],
    [600, "Zephyr", "général", ["*merde*"], "flag", "quelle ****** ce patch", false, false],
    [1500, "Onyx", "lol-discussion", ["connard"], "failed", "gros *******", false, false],
    [4000, "Mira", "général", ["fils de pute"], "mask", "le ************", false, false],
  ];
  return rows.map(([minAgo, userName, chan, terms, action, excerpt, edited, timeout], i) => ({
    ts: now - minAgo * 60000,
    userId: String(6000 + i),
    userName,
    channelId: byName(text, chan),
    terms,
    action,
    edited,
    timeout,
    excerpt,
  }));
}

const emptySource = () => ({ ok: null, at: "", error: "", count: 0, failures: 0, failingSince: 0, retryAt: 0, alerted: false });

function emptyTikTokState() {
  return { ready: { embed: false, rss: false }, sources: { embed: emptySource(), rss: emptySource() }, profile: { nickname: "", avatarUrl: "" }, lastCheckAt: "", lastCheckError: "", lastSource: "", lastOkAt: "", lastPostAt: "", lastPostError: "", lastNote: "", seenCount: 0, nextPollAt: "" };
}

// Source directe OK, flux RSS en échec et en pause : montre un état « dégradé » réaliste.
function fakeTikTokState(now) {
  const iso = (ms) => new Date(ms).toISOString();
  return {
    ready: { embed: true, rss: true },
    sources: {
      embed: { ok: true, at: iso(now - 70000), error: "", count: 11, failures: 0, failingSince: 0, retryAt: 0, alerted: false },
      rss: { ok: false, at: iso(now - 5 * 60000), error: "HTTP 404 sur le flux", count: 0, failures: 4, failingSince: now - 3 * 3600000, retryAt: now + 12 * 60000, alerted: true },
    },
    profile: { nickname: "Kaya GF", avatarUrl: "" },
    lastCheckAt: iso(now - 70000),
    lastCheckError: "",
    lastSource: "embed",
    lastOkAt: iso(now - 70000),
    lastPostAt: iso(now - 5 * 3600000),
    lastPostError: "",
    lastNote: `${iso(now - 2 * 86400000)} — 7 vidéos inconnues d'un coup : resynchronisation sans publier`,
    seenCount: 42,
    nextPollAt: iso(now + 50000),
  };
}

function fakeLog(ts, i) {
  const [level, msg] = LOG_MSGS[i % LOG_MSGS.length];
  return { ts, level, msg };
}

let state = makeState();

// ─────────────────────────── Serveur ───────────────────────────
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  // Même politique que src/web/server.js : un écart ici masquerait une violation CSP.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://nekos.best",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "12mb" }));

app.get("/__mock", (req, res) => res.json({ scenario, scenarios: SCENARIOS }));
app.get("/__mock/scenario/:name", (req, res) => {
  if (!SCENARIOS.includes(req.params.name)) return res.status(404).json({ error: "scénario inconnu", scenarios: SCENARIOS });
  scenario = req.params.name;
  loggedOut = false;
  state = makeState();
  res.redirect("/");
});

app.get("/login", (req, res) => {
  loggedOut = false;
  res.redirect("/");
});
app.get("/logout", (req, res) => {
  loggedOut = true;
  res.redirect("/");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptimeSec: 3 * 86400 + 4 * 3600, discord: { connected: true, pingMs: 42 }, brawlhallaApi: { reachable: true, lastCheckTs: Date.now() } });
});

// ---- Combo Lab (public, sans connexion : ni loggedout ni expired ne s'appliquent) ----
const COMBOS_FILE = resolve(__dirname, "..", "data", "combos.json");
let labCombos = null;
function readLabCombos() {
  if (!labCombos) {
    try {
      labCombos = JSON.parse(readFileSync(COMBOS_FILE, "utf8")).combos || [];
    } catch {
      labCombos = [];
    }
  }
  return labCombos;
}
const labVideos = new Map(); // id -> Buffer (petit cache, évite de re-télécharger)
app.use("/lab/api", async (req, res, next) => {
  if (scenario === "slow") await new Promise((r) => setTimeout(r, 1500));
  if (scenario === "errors") return fail(res, "Erreur interne simulée", 500);
  next();
});
mountComboLab(app, {
  catalogCacheControl: "no-store",
  getCombos: async () => (scenario === "empty" ? [] : readLabCombos()),
  getVideo: async (c) => {
    if (labVideos.has(c.id)) return labVideos.get(c.id);
    try {
      const r = await fetch(c.video, { headers: { "User-Agent": "Mozilla/5.0 (combo-fetcher)" } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (labVideos.size >= 40) labVideos.delete(labVideos.keys().next().value);
      labVideos.set(c.id, buf);
      return buf;
    } catch {
      return null;
    }
  },
});

// Délai et erreurs simulés selon le scénario.
app.use("/api", async (req, res, next) => {
  if (scenario === "slow") await new Promise((r) => setTimeout(r, 1500));
  if (req.path === "/me") return next();
  if (loggedOut || scenario === "loggedout" || scenario === "expired") return res.status(401).json({ error: "non authentifié" });
  if (scenario === "bootfail" && req.path === "/guild") return res.status(500).json({ error: "Discord API: Service Unavailable" });
  if (scenario === "errors" && ["/stats", "/metrics", "/logs", "/giveaway/list", "/tournament/history", "/combos", "/wordfilter/status", "/tiktok/status", "/tiktok/diagnose"].includes(req.path)) {
    return res.status(500).json({ error: "Erreur interne simulée" });
  }
  next();
});

const ok = (res, extra = {}) => res.json({ ok: true, ...extra });
const fail = (res, error, status = 400) => res.status(status).json({ error });

app.get("/api/me", (req, res) => {
  if (loggedOut || scenario === "loggedout") return fail(res, "non connecté", 401);
  res.json({ id: "1", username: "Sasou", avatar: null, isAdmin: scenario !== "notadmin" });
});
app.get("/api/guild", (req, res) => res.json(guild));
app.get("/api/config", (req, res) => res.json(state.config));
app.put("/api/config/:section", (req, res) => {
  const cur = state.config[req.params.section];
  if (!cur) return fail(res, "section inconnue", 404);
  for (const [k, v] of Object.entries(req.body || {})) if (k in cur) cur[k] = v;
  if (req.params.section === "tickets") cur.topics = (cur.topics || []).map((t, i) => ({ ...t, id: t.id || `t${Date.now().toString(36)}${i}` }));
  res.json(cur);
});

app.get("/api/stats", (req, res) => {
  const empty = scenario === "empty";
  res.json({
    linkedCount: empty ? 0 : 312,
    tierCounts: empty ? {} : { Tin: 8, Bronze: 31, Silver: 64, Gold: 88, Platinum: 71, Diamond: 38, Valhallan: 5, "Non classé": 7 },
    xp: { members: empty ? 0 : 1204, totalXp: empty ? 0 : 3456789, topLevel: empty ? 0 : 87 },
    memberCount: guild.memberCount,
  });
});

app.get("/api/metrics", (req, res) => {
  const now = Date.now();
  const m = { requests: 1204, ok: 1150, notFound: 40, rateLimited: 8, serverErrors: 3, otherClient: 1, networkErrors: 2, retries: 12, cooldowns: 1, lastSuccessTs: now - 4000, lastError: { ts: now - 25 * 60000, status: 429, message: "Too Many Requests" } };
  const meaningful = m.ok + m.rateLimited + m.serverErrors + m.otherClient + m.networkErrors;
  res.json({ ...m, meaningful, successRate: m.ok / meaningful, uptimeMs: 3 * 86400000 + 4 * 3600000, cooldownActiveMs: 0, pendingProfiles: 0, pendingSearches: 2, index: { count: 40123, syncedAt: now - 4 * 60000, ageMs: 4 * 60000 } });
});

app.get("/api/logs", (req, res) => {
  if (state.logs.length && Math.random() < 0.5) state.logs.push(fakeLog(Date.now(), state.logs.length));
  const limit = Math.min(Number(req.query.limit) || 200, 400);
  res.json({ lines: state.logs.slice(-limit) });
});

// ---- Tests / publications (aucun effet : simulation) ----
for (const p of ["/api/welcome/test", "/api/lol/test", "/api/tiktok/test", "/api/reminders/test", "/api/levels/test", "/api/linkpanel/publish", "/api/tickets/publish", "/api/combos/publish"]) {
  app.post(p, (req, res) => ok(res));
}
// ---- Filtre de mots ----
app.get("/api/wordfilter/status", (req, res) => {
  const now = Date.now();
  const log = state.wordfilterLog;
  const since = (ms) => log.filter((e) => now - e.ts < ms).length;
  res.json({
    total: log.length ? log.length + 131 : 0,
    last24h: since(86400000),
    last7d: since(7 * 86400000),
    lastTs: log.length ? Math.max(...log.map((e) => e.ts)) : 0,
    recent: [...log].sort((a, b) => b.ts - a.ts),
    // Webhooks absents : fait apparaître l'alerte du mode « Masquer ».
    permissions: { manageMessages: true, manageWebhooks: false, moderateMembers: true },
    starterTerms: STARTER_TERMS,
  });
});
app.post("/api/wordfilter/check", (req, res) => {
  const b = req.body || {};
  const filter = compileFilter({ words: b.words || [], allowed: b.allowed || [], evasion: b.evasion !== false, ignoreLinks: b.ignoreLinks !== false });
  const src = String(b.text || "").slice(0, 2000);
  const matches = findMatches(src, filter);
  res.json({ matches, terms: matchedTerms(matches), masked: maskText(src, matches) });
});
app.post("/api/wordfilter/clear-history", (req, res) => {
  const n = state.wordfilterLog.length;
  state.wordfilterLog = [];
  ok(res, { cleared: n });
});

// ---- TikTok : état et diagnostic ----
app.get("/api/tiktok/status", (req, res) => res.json({ ...state.tiktok, defaultMessage: "Nouvelle vidéo de {pseudo} va la voir tout de suite ! <:xk:1>" }));
app.post("/api/tiktok/diagnose", (req, res) => {
  const account = String(req.body?.account || "").trim().replace(/^@+/, "").toLowerCase();
  if (!account) return fail(res, "Indique un compte TikTok.");
  if (!/^[a-z0-9._]{2,24}$/.test(account)) return fail(res, "Compte TikTok invalide (ex : kayagoldforged, sans @).");
  const results = [];
  if (account === "introuvable") {
    results.push({ source: "embed", ok: false, count: 0, latest: null, profile: null, ms: 240, error: "compte introuvable ou privé", fatal: true });
  } else {
    results.push({
      source: "embed",
      ok: true,
      count: 11,
      ms: 612,
      error: "",
      profile: { handle: account, nickname: account === "kayagoldforged" ? "Kaya GF" : account, avatarUrl: "" },
      latest: {
        videoId: "7430000000000000000",
        url: `https://www.tiktok.com/@${account}/video/7430000000000000000`,
        title: "Nouveau combo au marteau, dites-moi si vous l'aviez vu venir #brawlhalla #combo #hammer",
        image: "/icon-512.png",
        date: "",
      },
    });
  }
  if (req.body?.feedUrl) results.push({ source: "rss", ok: false, count: 0, latest: null, profile: null, ms: 180, error: "HTTP 404 sur le flux" });
  setTimeout(() => res.json({ account, results }), 500);
});

app.get("/api/lol/greeted", (req, res) => res.json({ count: state.greeted }));
app.post("/api/lol/reset-greeted", (req, res) => {
  const n = state.greeted;
  state.greeted = 0;
  ok(res, { cleared: n, message: `Historique réinitialisé (${n} membre(s)).` });
});
app.post("/api/setup-vocaux-rank", (req, res) => {
  if (!req.body.categoryId) return fail(res, "Catégorie requise.");
  ok(res, { message: "Vocaux prêts dans « Vocaux rank » : 6 créé(s), 0 mis à jour." });
});
app.post("/api/refresh-roles", (req, res) => res.status(202).json({ ok: true, started: true, total: 312, message: "Actualisation lancée." }));

// ---- Combos ----
app.get("/api/combos", (req, res) =>
  res.json(scenario === "empty" ? { count: 0, scrapedAt: null, byWeapon: {} } : { count: 412, scrapedAt: new Date(Date.now() - 12 * 86400000).toISOString(), byWeapon: { sword: 48, hammer: 41, katars: 39, spear: 37, axe: 35, rocketlance: 33, blasters: 31, bow: 30, gauntlets: 29, scythe: 27, cannon: 22, orb: 20, greatsword: 20 } }),
);
app.post("/api/combos/refresh", (req, res) => setTimeout(() => ok(res, { count: 412 }), 800));

// ---- Tournoi ----
const T = () => state.tournament;
const needT = (res) => (T() ? false : (fail(res, "Aucun tournoi."), true));
app.get("/api/tournament", (req, res) => res.json(T()));
app.post("/api/tournament", (req, res) => {
  state.tournament = { ...makeTournament("draft"), ...req.body, participants: [], matches: {}, rounds: 0, status: "draft", signupMessageId: "" };
  res.json(T());
});
app.put("/api/tournament", (req, res) => {
  if (needT(res)) return;
  const { participants, matches, rounds, ...safe } = req.body || {};
  Object.assign(T(), safe);
  res.json(T());
});
app.delete("/api/tournament", (req, res) => {
  state.tournament = null;
  ok(res);
});
app.post("/api/tournament/status", (req, res) => {
  if (needT(res)) return;
  const t = T();
  t.status = req.body.status;
  if (t.status === "registration" && !t.participants.length) t.participants = PLAYERS.slice(0, 6).map((name, i) => ({ id: "e" + i, name, members: [String(5000 + i)], checkedIn: false, eliminated: false }));
  if (t.status === "registration" && t.rounds) {
    t.matches = {};
    t.rounds = 0;
  }
  if (t.status === "checkin") t.participants.forEach((p, i) => (p.checkedIn = i % 3 !== 0));
  res.json(t);
});
app.post("/api/tournament/shuffle", (req, res) => {
  if (needT(res)) return;
  T().participants.sort(() => Math.random() - 0.5);
  res.json(T());
});
app.post("/api/tournament/seed-elo", (req, res) => {
  if (needT(res)) return;
  T().participants.sort((a, b) => a.name.localeCompare(b.name));
  res.json(T());
});
app.post("/api/tournament/seed-startgg", (req, res) => {
  if (needT(res)) return;
  if (!/start\.gg\/tournament\/[^/]+\/event\//.test(req.body.url || "")) return fail(res, "Lien d'événement start.gg invalide.");
  res.json({ tournament: T(), matched: 5, total: T().participants.length, message: `Seeding start.gg appliqué : 5/${T().participants.length} participant(s) associé(s).` });
});
app.post("/api/tournament/remove", (req, res) => {
  if (needT(res)) return;
  T().participants = T().participants.filter((p) => p.id !== req.body.entrantId);
  res.json(T());
});
app.post("/api/tournament/generate", (req, res) => {
  if (needT(res)) return;
  if (T().participants.length < 2) return fail(res, "Il faut au moins 2 participants.");
  generate(T());
  res.json(T());
});
app.post("/api/tournament/result", (req, res) => {
  if (needT(res)) return;
  try {
    report(T(), req.body.matchId, Number(req.body.scoreA), Number(req.body.scoreB));
    res.json(T());
  } catch (e) {
    fail(res, e.message);
  }
});
app.post("/api/tournament/resolve", (req, res) => {
  if (needT(res)) return;
  const m = T().matches[req.body.matchId];
  if (!m) return fail(res, "Match introuvable.");
  advance(T(), req.body.matchId, req.body.winnerId);
  res.json(T());
});
app.post("/api/tournament/publish", (req, res) => {
  if (needT(res)) return;
  if (!T().signupChannelId) return fail(res, "Définis d'abord le salon d'inscription.");
  T().signupMessageId = "m" + nextId();
  ok(res);
});
app.post("/api/tournament/archive", (req, res) => {
  if (needT(res)) return;
  const t = T();
  const final = t.rounds ? t.matches[`r${t.rounds - 1}m0`] : null;
  const winner = final && final.winnerId ? t.participants.find((p) => p.id === final.winnerId).name : null;
  state.history.unshift({ id: "h" + nextId(), name: t.name, format: t.format, bestOf: t.bestOf, participants: t.participants.length, winner, archivedAt: Date.now(), snapshot: t });
  state.tournament = null;
  ok(res);
});
app.get("/api/tournament/history", (req, res) => res.json(state.history.map(({ snapshot, ...h }) => h)));
app.get("/api/tournament/history/:id", (req, res) => {
  const e = state.history.find((h) => h.id === req.params.id);
  if (!e) return fail(res, "introuvable", 404);
  res.json(e);
});
app.delete("/api/tournament/history/:id", (req, res) => {
  state.history = state.history.filter((h) => h.id !== req.params.id);
  ok(res);
});

// ---- start.gg ----
app.post("/api/startgg/preview", (req, res) => {
  if (!/start\.gg\/tournament\/[^/]+\/event\//.test(req.body.url || "")) return fail(res, "Lien d'événement start.gg invalide (…/tournament/<nom>/event/<event>).");
  const phases = [
    { id: "p1", name: "Bracket principal" },
    { id: "p2", name: "Top 8" },
  ];
  const phaseId = phases.some((p) => p.id === req.body.phaseId) ? req.body.phaseId : "p1";
  const sources = ["membre lié", "leaderboard", "inconnu"];
  const rows = PLAYERS.map((name, i) => ({ seedId: "s" + i, currentSeed: i + 1, name, rating: i % 4 === 3 ? 0 : 2100 - ((i * 137) % 700), source: i % 4 === 3 ? "inconnu" : sources[i % 2] }));
  rows.sort((a, b) => b.rating - a.rating || a.currentSeed - b.currentSeed);
  rows.forEach((r, i) => (r.proposedSeed = i + 1));
  res.json({ eventName: "XK Weekly #12 — 1v1", phaseId, phaseName: phases.find((p) => p.id === phaseId).name, phases, rows });
});
app.post("/api/startgg/apply", (req, res) => ok(res, { updated: (req.body.mapping || []).length, message: `Seeding appliqué sur start.gg pour ${(req.body.mapping || []).length} joueur(s).` }));

// ---- Giveaways ----
app.get("/api/giveaway/list", (req, res) => res.json({ active: state.giveaways.filter((g) => g.status === "active"), recent: state.giveaways.slice().reverse() }));
app.post("/api/giveaway/create", (req, res) => {
  if (!state.config.giveaway.enabled) return fail(res, "Active d'abord le système de giveaways.");
  const { prize, description, duration, winnersCount, channelId } = req.body || {};
  if (!prize) return fail(res, "Précise une récompense.");
  const m = /^(\d+)\s*(m|h|d|w)$/i.exec(String(duration || "").trim());
  const ms = m ? Number(m[1]) * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2].toLowerCase()] : 86400000;
  const id = Number(nextId());
  state.giveaways.push({ id, prize, description: description || "", channelId: channelId || state.config.giveaway.defaultChannelId, messageId: "m" + id, winnersCount: winnersCount || 1, requiredRoleId: null, hostId: "1", endsTs: Date.now() + ms, createdTs: Date.now(), status: "active", winnerIds: [], entries: 0 });
  ok(res, { id });
});
const findG = (req) => state.giveaways.find((g) => g.id === Number(req.body && req.body.id));
app.post("/api/giveaway/end", (req, res) => {
  const g = findG(req);
  if (!g) return fail(res, "Giveaway introuvable.", 404);
  g.status = "ended";
  g.endsTs = Date.now();
  g.winnerIds = g.entries ? ["5002"] : [];
  ok(res, { winners: g.winnerIds });
});
app.post("/api/giveaway/cancel", (req, res) => {
  const g = findG(req);
  if (!g) return fail(res, "Giveaway introuvable.", 404);
  g.status = "cancelled";
  ok(res);
});
app.post("/api/giveaway/reroll", (req, res) => {
  const g = findG(req);
  if (!g) return fail(res, "Giveaway introuvable.", 404);
  g.winnerIds = ["5003"];
  ok(res, { winners: g.winnerIds });
});

// ---- Annonces ----
app.post("/api/announce/send", (req, res) => {
  const b = req.body || {};
  if (!b.channelId) return fail(res, "Choisis un salon.");
  if (b.messageId) return ok(res, { edited: true, messageId: b.messageId });
  ok(res, { messageId: nextId() + "000000000000" });
});

app.use("/api", (req, res) => fail(res, "route inconnue", 404));
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => res.sendFile(resolve(PUBLIC_DIR, "index.html")));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard (mock, sans Discord) : http://127.0.0.1:${PORT}  ·  scénario « ${scenario} »`);
  console.log(`Changer de scénario : http://127.0.0.1:${PORT}/__mock/scenario/<${SCENARIOS.join("|")}>`);
});
