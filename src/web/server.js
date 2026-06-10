import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PermissionFlagsBits, ChannelType } from "discord.js";

import { config, webConfig, TIERS } from "../config.js";
import { getSettings, setSetting } from "../settings.js";
import { getLevelConfig, setLevelConfig, buildLevelUpAnnounce, xpForLevel, totalXpForLevel } from "../levels.js";
import { getTikTokConfig, setTikTokConfig, postTest as tiktokPostTest } from "../tiktok.js";
import { getClipsConfig, setClipsConfig } from "../clips.js";
import { getGuessRankConfig, setGuessRankConfig } from "../guessrank.js";
import { getTempConfig, setTempConfig } from "../tempvoice.js";
import { getWelcomeConfig, setWelcomeConfig, buildWelcomePayload } from "../welcome.js";
import {
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  shuffleSeeds,
  generateBracket,
  reportResult,
  removeEntrant,
  resolveMatch,
  setParticipantOrder,
  archiveTournament,
  getHistory,
  getHistoryEntry,
  deleteHistoryEntry,
} from "../tournament.js";
import { buildSignupPayload, refreshSignupPanel, tournamentAnnounce, tournamentAnnouncePayload, buildRegistrationAnnounce, buildCheckinAnnounce, buildBracketAnnounce, buildHallOfFamePayload, postNoTournamentPanel } from "../tournamentUI.js";
import { getLink } from "../store.js";
import { getAllLinks } from "../store.js";
import { combosInfo, refreshCombos, buildPanelMessage, weaponsWithCombos } from "../combos.js";
import { getLeaderboard } from "../levels.js";
import { getRecentLogs } from "../logBuffer.js";
import { getPlayerProfile, getApiMetrics } from "../brawlhalla.js";
import { setupRankVoiceChannels } from "../rankvoice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "public");
const COOKIE = "bh_session";
const DISCORD_API = "https://discord.com/api";

// Sections de config exposees a l'API (lecture/ecriture).
function buildSections(guildId) {
  return {
    settings: {
      get: () => getSettings(),
      set: async (body) => {
        const keys = ["reviewChannelId", "reviewerRoleId", "auditChannelId", "announceChannelId", "alertChannelId", "achievementsChannelId", "autoApproveTier"];
        for (const k of keys) if (k in body) await setSetting(k, body[k]);
        return getSettings();
      },
    },
    levels: { get: () => getLevelConfig(guildId), set: (b) => setLevelConfig(guildId, b) },
    tiktok: { get: () => getTikTokConfig(guildId), set: (b) => setTikTokConfig(guildId, b) },
    clips: { get: () => getClipsConfig(guildId), set: (b) => setClipsConfig(guildId, b) },
    guessrank: { get: () => getGuessRankConfig(guildId), set: (b) => setGuessRankConfig(guildId, b) },
    tempvoice: { get: () => getTempConfig(guildId), set: (b) => setTempConfig(guildId, b) },
    welcome: { get: () => getWelcomeConfig(guildId), set: (b) => setWelcomeConfig(guildId, b) },
  };
}

// Rate-limit en mémoire (fenêtre glissante par IP). Sans dépendance externe.
function rateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> timestamps[]
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || "?";
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    // Nettoyage périodique pour éviter que la map ne grossisse indéfiniment.
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
    if (arr.length > max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: "Trop de requêtes, réessaie dans un instant." });
    }
    next();
  };
}

export function startWebServer(client) {
  if (!webConfig.enabled()) {
    console.log("Dashboard web desactive (CLIENT_SECRET / PUBLIC_URL / SESSION_SECRET manquants).");
    return;
  }

  const app = express();
  // Derrière un reverse proxy (nginx/caddy) : indispensable pour des cookies "secure",
  // la détection HTTPS (x-forwarded-proto) et le rate-limit par IP réelle (x-forwarded-for).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const wantHttps = webConfig.publicUrl.startsWith("https");

  // Force HTTPS (redirige le HTTP vers HTTPS) + en-têtes de sécurité.
  app.use((req, res, next) => {
    if (wantHttps) {
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      if (proto !== "https") return res.redirect(308, webConfig.publicUrl + req.originalUrl);
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    // Politique de sécurité du contenu. Autorise les origines réellement utilisées :
    // Google Fonts (style + police), images Discord/QuickChart/nekos.best + URLs https
    // saisies par l'admin (aperçus d'embed), et les appels fetch vers nekos.best.
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
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Rate-limit léger en mémoire (sans dépendance). Protège l'API et l'auth OAuth.
  app.use("/api", rateLimiter({ windowMs: 60_000, max: 120 }));
  app.use(["/login", "/callback"], rateLimiter({ windowMs: 60_000, max: 20 }));

  const redirectUri = `${webConfig.publicUrl}/callback`;
  const sections = buildSections(config.guildId);

  // ---- Helpers ----
  async function isGuildAdmin(userId) {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      if (guild.ownerId === userId) return true;
      const member = await guild.members.fetch(userId);
      return member.permissions.has(PermissionFlagsBits.ManageGuild);
    } catch {
      return false;
    }
  }

  function signSession(payload) {
    return jwt.sign(payload, webConfig.sessionSecret, { expiresIn: "1d" });
  }
  function readSession(req) {
    try {
      return jwt.verify(req.cookies[COOKIE], webConfig.sessionSecret);
    } catch {
      return null;
    }
  }
  function requireAdmin(req, res, next) {
    const s = readSession(req);
    if (!s || !s.isAdmin) return res.status(401).json({ error: "non authentifié" });
    req.session = s;
    next();
  }

  // ---- OAuth ----
  app.get("/login", (req, res) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify",
      prompt: "consent",
    });
    res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
  });

  app.get("/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect("/?error=nocode");
    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: webConfig.clientSecret,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) return res.redirect("/?error=token");
      const token = await tokenRes.json();
      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const user = await userRes.json();
      const admin = await isGuildAdmin(user.id);

      const jwtToken = signSession({
        id: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : null,
        isAdmin: admin,
      });
      res.cookie(COOKIE, jwtToken, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
        secure: wantHttps,
        path: "/",
      });
      res.redirect(admin ? "/" : "/?error=notadmin");
    } catch {
      res.redirect("/?error=oauth");
    }
  });

  app.get("/logout", (req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: wantHttps, path: "/" });
    res.redirect("/");
  });

  // ---- API ----
  app.get("/api/me", (req, res) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: "non connecté" });
    res.json({ id: s.id, username: s.username, avatar: s.avatar, isAdmin: s.isAdmin });
  });

  app.get("/api/guild", requireAdmin, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      await guild.channels.fetch();
      await guild.roles.fetch();
      const chan = (type) =>
        [...guild.channels.cache.values()]
          .filter((c) => c.type === type)
          .sort((a, b) => a.rawPosition - b.rawPosition)
          .map((c) => ({ id: c.id, name: c.name }));
      const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
      const emojis = [...guild.emojis.cache.values()].map((e) => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        token: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
        url: e.imageURL(),
      }));
      res.json({
        name: guild.name,
        id: guild.id,
        icon: guild.iconURL() || null,
        memberCount: guild.memberCount,
        tiers: TIERS,
        channels: {
          text: chan(ChannelType.GuildText),
          voice: chan(ChannelType.GuildVoice),
          category: chan(ChannelType.GuildCategory),
          announcement: chan(ChannelType.GuildAnnouncement),
        },
        roles,
        emojis,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/config", requireAdmin, async (req, res) => {
    const out = {};
    for (const [name, s] of Object.entries(sections)) out[name] = await s.get();
    res.json(out);
  });

  app.put("/api/config/:section", requireAdmin, async (req, res) => {
    const s = sections[req.params.section];
    if (!s) return res.status(404).json({ error: "section inconnue" });
    try {
      const updated = await s.set(req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stats globales : membres liés, répartition par tier 1v1, activité XP.
  app.get("/api/stats", requireAdmin, async (req, res) => {
    try {
      const links = await getAllLinks();
      const entries = Object.values(links);
      const tierCounts = {};
      for (const l of entries) {
        const tier = l.tiers?.["1v1"] || "Non classé";
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      }
      const lb = await getLeaderboard(config.guildId, Number.MAX_SAFE_INTEGER);
      const totalXp = lb.reduce((a, e) => a + (e.xp || 0), 0);
      const topLevel = lb.reduce((a, e) => Math.max(a, e.level || 0), 0);
      res.json({
        linkedCount: entries.length,
        tierCounts,
        xp: { members: lb.length, totalXp, topLevel },
        memberCount: (await client.guilds.fetch(config.guildId).catch(() => null))?.memberCount ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Logs en direct (tail des actions du bot).
  app.get("/api/logs", requireAdmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 400);
    res.json({ lines: getRecentLogs(limit) });
  });

  // Métriques de fiabilité de l'API Brawlhalla (taux de succès, erreurs, cooldown, files, index).
  app.get("/api/metrics", requireAdmin, async (req, res) => {
    try {
      res.json(await getApiMetrics());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Envoi d'un message de bienvenue de test (pour l'admin connecte).
  app.post("/api/welcome/test", requireAdmin, async (req, res) => {
    try {
      const cfg = await getWelcomeConfig(config.guildId);
      if (!cfg.channelId) return res.status(400).json({ error: "Aucun salon de bienvenue défini." });
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(req.session.id);
      const ch = await guild.channels.fetch(cfg.channelId);
      await ch.send(buildWelcomePayload(member, guild, cfg));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Poste la derniere video TikTok dans le salon configure (bouton Test du dashboard).
  app.post("/api/tiktok/test", requireAdmin, async (req, res) => {
    try {
      const r = await tiktokPostTest(client, config.guildId);
      if (!r.ok) return res.status(400).json({ error: r.reason || "Test impossible." });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Apercu des annonces de niveau (bouton Test du dashboard) : poste un exemple
  // "niveau simple" (sans ping) et un exemple "passage de palier" (avec ping).
  app.post("/api/levels/test", requireAdmin, async (req, res) => {
    try {
      const cfg = await getLevelConfig(config.guildId);
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(req.session.id);

      // Palier representatif (un du milieu de la liste pour une jolie couleur).
      const examples = [
        { level: 7, oldLevel: 6 }, // niveau simple (pas de palier) -> pas de ping
        { level: 50, oldLevel: 49 }, // passage de palier "Niveau 50" -> ping
      ];

      // Stats synthetiques (~45% de progression) pour un apercu realiste de la barre d'XP.
      const fakeStats = (level) => {
        const into = Math.floor(xpForLevel(level) * 0.45);
        return { rank: 1, totalMembers: 42, xp: totalXpForLevel(level) + into, xpIntoLevel: into, xpForNext: xpForLevel(level) };
      };

      // Mode DM : on envoie les apercus en message prive a l'admin.
      if (cfg.announceMode === "dm") {
        for (const ex of examples) {
          const { embed } = buildLevelUpAnnounce(guild, member, ex.level, ex.oldLevel, fakeStats(ex.level));
          await member.send({ embeds: [embed] }).catch(() => {});
        }
        return res.json({ ok: true, mode: "dm" });
      }

      // Sinon : salon d'annonce configure obligatoire pour le test.
      if (!cfg.announceChannelId) {
        return res.status(400).json({ error: "Définis d'abord un salon d'annonce (ou passe les annonces en Message privé)." });
      }
      const ch = await guild.channels.fetch(cfg.announceChannelId).catch(() => null);
      if (!ch?.isTextBased?.()) return res.status(400).json({ error: "Salon d'annonce introuvable ou non textuel." });

      for (const ex of examples) {
        const { embed, tierCrossed } = buildLevelUpAnnounce(guild, member, ex.level, ex.oldLevel, fakeStats(ex.level));
        const payload = tierCrossed
          ? { content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } }
          : { embeds: [embed], allowedMentions: { parse: [] } };
        await ch.send(payload);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Vocaux par rank ----
  app.post("/api/setup-vocaux-rank", requireAdmin, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const r = await setupRankVoiceChannels(guild, {
        categoryId: req.body.categoryId,
        rangMin: req.body.rangMin,
        limite: req.body.limite,
      });
      res.json({
        ok: true,
        ...r,
        message:
          `Vocaux prêts dans « ${r.categoryName} » : ${r.created.length} créé(s), ${r.updated.length} mis à jour` +
          (r.failed ? `, ${r.failed} en échec (le bot a-t-il « Gérer les salons » ?)` : "") +
          ".",
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Tournoi ----
  const G = config.guildId;
  app.get("/api/tournament", requireAdmin, async (req, res) => res.json((await getTournament(G)) || null));

  app.post("/api/tournament", requireAdmin, async (req, res) => {
    try {
      res.json(await createTournament(G, req.body || {}));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/tournament", requireAdmin, async (req, res) => {
    try {
      const t = await updateTournament(G, req.body || {});
      await refreshSignupPanel(client, G);
      res.json(t);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/tournament", requireAdmin, async (req, res) => {
    const t = await getTournament(G);
    const signupChannelId = t?.signupChannelId || null;
    await deleteTournament(G);
    await postNoTournamentPanel(client, signupChannelId);
    res.json({ ok: true });
  });

  app.post("/api/tournament/status", requireAdmin, async (req, res) => {
    try {
      const t = await updateTournament(G, { status: req.body.status });
      await refreshSignupPanel(client, G);
      if (req.body.status === "registration") await tournamentAnnouncePayload(client, G, buildRegistrationAnnounce(t));
      if (req.body.status === "checkin") await tournamentAnnouncePayload(client, G, buildCheckinAnnounce(t));
      res.json(t);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/shuffle", requireAdmin, async (req, res) => {
    try {
      await shuffleSeeds(G);
      res.json(await getTournament(G));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/remove", requireAdmin, async (req, res) => {
    try {
      await removeEntrant(G, req.body.entrantId);
      await refreshSignupPanel(client, G);
      res.json(await getTournament(G));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/generate", requireAdmin, async (req, res) => {
    try {
      const t = await generateBracket(G);
      await refreshSignupPanel(client, G);
      await tournamentAnnouncePayload(client, G, buildBracketAnnounce(t));
      res.json(t);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/result", requireAdmin, async (req, res) => {
    try {
      const { matchId, scoreA, scoreB } = req.body;
      const t = await reportResult(G, matchId, Number(scoreA), Number(scoreB));
      await refreshSignupPanel(client, G);
      if (t.status === "completed") {
        const win = t.participants.find((p) => p.id === t.matches[`r${t.rounds - 1}m0`].winnerId);
        if (win) await tournamentAnnounce(client, G, `🏆 **${win.name}** remporte **${t.name}** ! Félicitations 🎉`);
      }
      res.json(t);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/resolve", requireAdmin, async (req, res) => {
    try {
      const t = await resolveMatch(G, req.body.matchId, req.body.winnerId);
      await refreshSignupPanel(client, G);
      if (t.status === "completed") {
        const win = t.participants.find((p) => p.id === t.matches[`r${t.rounds - 1}m0`].winnerId);
        if (win) await tournamentAnnounce(client, G, `🏆 **${win.name}** remporte **${t.name}** ! 🎉`);
      } else {
        await tournamentAnnounce(client, G, `🛠️ Décision staff appliquée sur un match.`);
      }
      res.json(t);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/seed-elo", requireAdmin, async (req, res) => {
    try {
      const t = await getTournament(G);
      if (!t) return res.status(400).json({ error: "Aucun tournoi." });
      const scored = [];
      for (const p of t.participants) {
        let rating = 0;
        try {
          const link = await getLink(p.members[0]);
          if (link) {
            const prof = await getPlayerProfile(link.brawlhallaId);
            rating = prof.ratings?.["1v1"] || 0;
          }
        } catch {
          /* pas de compte lié → rating 0 */
        }
        scored.push({ id: p.id, rating });
      }
      scored.sort((a, b) => b.rating - a.rating);
      await setParticipantOrder(G, scored.map((s) => s.id));
      res.json(await getTournament(G));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/tournament/publish", requireAdmin, async (req, res) => {
    try {
      const t = await getTournament(G);
      if (!t) return res.status(400).json({ error: "Aucun tournoi." });
      if (!t.signupChannelId) return res.status(400).json({ error: "Définis d'abord le salon d'inscription." });
      const ch = await client.channels.fetch(t.signupChannelId);
      const msg = await ch.send(buildSignupPayload(t));
      await updateTournament(G, { signupMessageId: msg.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Historique ----
  app.post("/api/tournament/archive", requireAdmin, async (req, res) => {
    try {
      let signupChannelId = null;
      // Recap "Hall of Fame" (podium + MVP) AVANT archivage (l'archivage supprime le tournoi courant).
      try {
        const t = await getTournament(G);
        signupChannelId = t?.signupChannelId || null;
        if (t && t.hallOfFameChannelId) {
          const ch = await client.channels.fetch(t.hallOfFameChannelId).catch(() => null);
          if (ch?.isTextBased?.()) await ch.send(buildHallOfFamePayload(t));
        }
      } catch {
        /* recap best-effort */
      }
      await archiveTournament(G);
      // Le salon d'inscription repasse en "aucun tournoi" pour ne pas perdre les membres.
      await postNoTournamentPanel(client, signupChannelId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get("/api/tournament/history", requireAdmin, async (req, res) => res.json(await getHistory(G)));
  app.get("/api/tournament/history/:id", requireAdmin, async (req, res) => {
    const e = await getHistoryEntry(G, req.params.id);
    if (!e) return res.status(404).json({ error: "introuvable" });
    res.json(e);
  });
  app.delete("/api/tournament/history/:id", requireAdmin, async (req, res) => {
    await deleteHistoryEntry(G, req.params.id);
    res.json({ ok: true });
  });

  // ---- Combos (BrawlDatabase) ----
  app.get("/api/combos", requireAdmin, async (req, res) => {
    try {
      res.json(await combosInfo());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/combos/refresh", requireAdmin, async (req, res) => {
    try {
      const r = await refreshCombos();
      res.json(r);
    } catch (err) {
      res.status(500).json({ error: "Mise à jour impossible : " + err.message });
    }
  });

  app.post("/api/combos/publish", requireAdmin, async (req, res) => {
    try {
      const channelId = req.body?.channelId;
      if (!channelId) return res.status(400).json({ error: "Choisis un salon." });
      const weapons = await weaponsWithCombos();
      if (!weapons.length) return res.status(400).json({ error: "Base de combos vide — mets-la à jour d'abord." });
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch?.isTextBased?.()) return res.status(400).json({ error: "Salon introuvable ou non textuel." });
      await ch.send(await buildPanelMessage());
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Frontend statique ----
  // Toute route /api inconnue renvoie un 404 JSON (et non le HTML du dashboard).
  app.use("/api", (req, res) => res.status(404).json({ error: "route inconnue" }));

  app.use(express.static(PUBLIC_DIR));
  app.get("*", (req, res) => res.sendFile(resolve(PUBLIC_DIR, "index.html")));

  app.listen(webConfig.port, () => {
    console.log(`Dashboard web sur ${webConfig.publicUrl} (port ${webConfig.port}).`);
  });
}
