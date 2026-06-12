import { Client, GatewayIntentBits, Events, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { installLogCapture } from "./logBuffer.js";
import { initHealth, notifyAdmin } from "./health.js";

installLogCapture(); // capture les logs console pour la page "Logs" du dashboard

// Filets de sécurité process : on log (et on tente d'alerter) sans faire planter le bot.
process.on("unhandledRejection", (reason) => {
  // "Joueur introuvable / API momentanément vide" (404) est un cas ATTENDU, déjà géré par
  // les replis (cache, index local, file de récupération). On ne pollue pas error.log avec.
  if (reason && (reason.empty === true || reason.status === 404)) return;
  console.error("unhandledRejection :", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException :", err?.message || err);
  notifyAdmin(`🛑 **Erreur non gérée** : ${err?.message || err}. Le process va probablement redémarrer (pm2).`);
});
import { ensureRoles, ensureValidatorRole, ensureServerLevelRoles, updateTopServerRole } from "./roles.js";
import { handleChatInput, handleButton, handleSelect, handleModal } from "./commands.js";
import { syncMember } from "./sync.js";
import { getAllLinks } from "./store.js";
import { closeDb } from "./db.js";
import { setSetting } from "./settings.js";
import { warmProfiles, syncLeaderboard, getIndexStats, retryPending } from "./brawlhalla.js";
import { getLevelConfig, setLevelConfig, setReward } from "./levels.js";
import { pollGuild as pollTikTok, getTikTokConfig } from "./tiktok.js";
import { handleClipMessage, handleClipReaction } from "./clips.js";
import { handleGuessRankMessage, getGuessRankConfig, reactionStoredKey } from "./guessrank.js";
import { startWebServer } from "./web/server.js";
import { getWelcomeConfig, buildWelcomePayload, buildGoodbyePayload } from "./welcome.js";
import { runWeeklyRecap } from "./progression.js";
import { tournamentTick } from "./tournamentAutomation.js";
import { handleTempVoice, cleanupTempChannels } from "./voiceManager.js";
import { handleMessageXp, tickVoiceXp, VOICE_TICK_MS } from "./xpEvents.js";
import { endDueGiveaways } from "./giveaway.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// Etat partage : map nom_de_role -> Role, rafraichie au demarrage.
const ctx = { rolesByName: new Map() };

// Suivi des boucles périodiques pour pouvoir les arrêter proprement à l'extinction.
const intervals = [];
function every(fn, ms) {
  const h = setInterval(fn, ms);
  intervals.push(h);
  return h;
}

// Garde anti-chevauchement : un refresh est séquentiel (await par membre) et peut, sur
// beaucoup de liaisons, dépasser l'intervalle. On évite qu'un second cycle se superpose.
let refreshing = false;

async function refreshAllMembers(guild) {
  if (refreshing) {
    console.log("Refresh auto ignoré : un cycle est déjà en cours.");
    return;
  }
  refreshing = true;
  try {
    const links = await getAllLinks();
    const entries = Object.entries(links);
    if (entries.length === 0) return;

    console.log(`Refresh auto : ${entries.length} membre(s) lie(s)...`);
    let ok = 0;
    for (const [discordId, { brawlhallaId }] of entries) {
      try {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;
        await syncMember(member, brawlhallaId, ctx.rolesByName);
        ok++;
      } catch (err) {
        console.warn(`  refresh echoue pour ${discordId} : ${err.message}`);
      }
    }
    console.log(`Refresh auto termine : ${ok}/${entries.length} mis a jour.`);

    // Met a jour le role "n°1 du serveur" (plus haut rating 1v1 parmi les membres lies).
    try {
      const top = await updateTopServerRole(guild);
      if (top) console.log(`Role n°1 du serveur : <@${top.topId}> (${top.rating}).`);
    } catch (err) {
      console.warn("Maj role n°1 du serveur echouee :", err.message);
    }
  } finally {
    refreshing = false;
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Connecte en tant que ${c.user.tag}`);

  // Surveillance : écouteurs de connexion Discord + boucle healthcheck API + alerte de démarrage.
  initHealth(client);
  notifyAdmin(`🟢 **Bot démarré/redémarré** — connecté en tant que ${c.user.tag}.`);

  const guild = await client.guilds.fetch(config.guildId);
  ctx.rolesByName = await ensureRoles(guild);
  console.log(`${ctx.rolesByName.size} role(s) de rank prets.`);

  // Cree le role validateur s'il manque et le memorise comme validateur par defaut.
  try {
    const validatorRoleId = await ensureValidatorRole(guild);
    await setSetting("validatorRoleId", validatorRoleId);
    console.log("Role validateur pret.");
  } catch (err) {
    console.warn("Impossible de creer le role validateur :", err.message);
  }

  // Cree les roles de niveau de serveur (couleurs Brawlhalla) et les cable comme recompenses.
  try {
    const levelRoles = await ensureServerLevelRoles(guild);
    const cfg = await getLevelConfig(guild.id);
    const firstRun = Object.keys(cfg.rewards || {}).length === 0;
    // Cable (ou recable) chaque palier sur son role actuel : idempotent, et corrige
    // automatiquement un eventuel renommage des roles.
    for (const [level, roleId] of levelRoles) await setReward(guild.id, level, roleId);
    // Au tout premier demarrage seulement : "plus haut seulement" (rendu type rank).
    if (firstRun) await setLevelConfig(guild.id, { stackRewards: false });
    console.log(`${levelRoles.size} role(s) de niveau prets et cables comme recompenses.`);
  } catch (err) {
    console.warn("Impossible de preparer les roles de niveau :", err.message);
  }

  // Premier refresh, puis a intervalle regulier.
  await refreshAllMembers(guild);
  const intervalMs = Math.max(5, config.refreshIntervalMinutes) * 60 * 1000;
  every(() => refreshAllMembers(guild).catch(console.error), intervalMs);

  // Rechauffe les profils en cache (pour /stats, /rank...) toutes les 15 min, en tache de fond.
  const warm = () =>
    warmProfiles()
      .then((r) => r.total && console.log(`Warm profils : ${r.ok}/${r.total} rafraichis.`))
      .catch(() => {});
  every(warm, 15 * 60 * 1000);
  warm();

  // Synchro de l'index local du leaderboard (recherche /lier /stats instantanee, sans API live).
  const syncLb = () =>
    syncLeaderboard()
      .then(async (r) => {
        const { count } = await getIndexStats();
        if (r.players) console.log(`Index leaderboard : ${r.players} joueur(s) synchronises (${count} au total).`);
      })
      .catch((e) => console.warn("Sync leaderboard echouee :", e.message));
  const syncIntervalMs = Math.max(15, config.leaderboardSyncIntervalMinutes) * 60 * 1000;
  every(syncLb, syncIntervalMs);
  syncLb();

  // Recuperation en arriere-plan des profils/recherches qui ont echoue (API capricieuse) :
  // reessaie regulierement jusqu'a reussir, pour que la commande relancee marche a coup sur.
  // Garde anti-chevauchement : un cycle peut durer jusqu'a ~25 s (budget de retry).
  let retrying = false;
  every(async () => {
    if (retrying) return;
    retrying = true;
    try {
      const r = await retryPending();
      if (r.recovered) console.log(`Récupération API : ${r.recovered} élément(s) chargé(s) en base.`);
    } catch {
      /* best-effort */
    } finally {
      retrying = false;
    }
  }, 30 * 1000);

  // XP vocal : balaye les salons vocaux chaque minute.
  every(() => tickVoiceXp(guild).catch(() => {}), VOICE_TICK_MS);

  // Nettoie les salons vocaux temporaires laisses vides apres un redemarrage.
  await cleanupTempChannels(guild);

  // Automatisation des matchs de tournoi (salons, timers AFK/forfait) chaque minute.
  every(() => tournamentTick(client, guild).catch(() => {}), 60 * 1000);

  // Clôture des giveaways arrivés à échéance (tirage des gagnants) chaque minute.
  every(
    () =>
      endDueGiveaways(client)
        .then((r) => r.ended && console.log(`Giveaways clôturés : ${r.ended}.`))
        .catch(() => {}),
    60 * 1000,
  );

  // Récap hebdo de progression : vérifié toutes les heures, posté une fois par semaine.
  const recapTick = () =>
    runWeeklyRecap(client, guild.id)
      .then((r) => r.posted && console.log(`Récap hebdo posté (${r.count} progression(s)).`))
      .catch(() => {});
  every(recapTick, 60 * 60 * 1000);
  recapTick();

  // Démarre le dashboard web (si configuré).
  try {
    startWebServer(client);
  } catch (err) {
    console.warn("Dashboard web non démarré :", err.message);
  }

  // Notifications TikTok : verifie les nouvelles videos a intervalle regulier.
  const pollTikTokGuild = async () => {
    try {
      const cfg = await getTikTokConfig(guild.id);
      if (!cfg.enabled) return;
      const r = await pollTikTok(client, guild.id);
      if (r.posted) console.log(`TikTok : ${r.posted} nouvelle(s) video(s) postee(s).`);
    } catch (err) {
      console.warn("Poll TikTok echoue :", err.message);
    }
  };
  // Tick toutes les minutes, mais ne sonde reellement qu'a l'intervalle configure.
  let tiktokTick = 0;
  every(async () => {
    const cfg = await getTikTokConfig(guild.id).catch(() => null);
    if (!cfg?.enabled) return;
    tiktokTick++;
    if (tiktokTick >= Math.max(1, cfg.pollIntervalMin)) {
      tiktokTick = 0;
      await pollTikTokGuild();
    }
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatInput(interaction, ctx);
    } else if (interaction.isButton()) {
      await handleButton(interaction, ctx);
    } else if (interaction.isAnySelectMenu()) {
      await handleSelect(interaction, ctx);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, ctx);
    }
  } catch (err) {
    console.error("Erreur d'interaction :", err);
    if (!interaction.isRepliable()) return;
    const msg = `Erreur : ${err.message}`;
    try {
      if (interaction.deferred || interaction.replied) {
        // Interaction deja differee : on edite pour ne pas laisser "thinking...".
        // V2-safe : un message peut etre en Components V2 (le champ `content` y est interdit) ;
        // si l'edition texte echoue, on retombe sur un Text Display (composant V2).
        await interaction.editReply(msg).catch(() =>
          interaction.editReply({ components: [{ type: 10, content: msg }], flags: MessageFlags.IsComponentsV2 }),
        );
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* dernier recours : on ignore */
    }
  }
});

// ---------- Systeme de niveaux : XP gagnee en discutant ----------
// Logique extraite dans ./xpEvents.js (handleMessageXp, tickVoiceXp, handleLevelUp).

client.on(Events.MessageCreate, async (message) => {
  // Ignore les bots, MP et messages systeme.
  if (message.author?.bot || !message.guild) return;

  // Reactions auto + moderation des clips (best-effort, n'empeche pas l'XP).
  handleClipMessage(message).catch(() => {});
  handleGuessRankMessage(message).catch(() => {});

  // Gain d'XP + montee de niveau.
  await handleMessageXp(message);
});

// ---------- Salons vocaux temporaires ("rejoindre pour creer") ----------
// Logique extraite dans ./voiceManager.js (handleTempVoice, cleanupTempChannels).

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  handleTempVoice(oldState, newState).catch((e) => console.warn("Erreur tempvoice :", e.message));
});

// ---------- Bienvenue / Au revoir / Auto-role ----------

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const cfg = await getWelcomeConfig(member.guild.id);
    // Auto-role
    if (cfg.autoRoleEnabled && cfg.autoRoleIds.length) {
      const roles = cfg.autoRoleIds.filter((id) => member.guild.roles.cache.has(id));
      if (roles.length) await member.roles.add(roles, "Auto-role à l'arrivée").catch(() => {});
    }
    // Message de bienvenue
    if (cfg.enabled && cfg.channelId) {
      const ch = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
      if (ch?.isTextBased?.()) await ch.send(buildWelcomePayload(member, member.guild, cfg)).catch(() => {});
    }
  } catch (err) {
    console.warn("Erreur bienvenue :", err.message);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const cfg = await getWelcomeConfig(member.guild.id);
    if (cfg.goodbyeEnabled && cfg.goodbyeChannelId) {
      const ch = await member.guild.channels.fetch(cfg.goodbyeChannelId).catch(() => null);
      if (ch?.isTextBased?.()) await ch.send(buildGoodbyePayload(member, member.guild, cfg)).catch(() => {});
    }
  } catch (err) {
    console.warn("Erreur au revoir :", err.message);
  }
});

// ---------- Devine ton rang : un seul vote (emoji de rank) par membre ----------

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;

    // Épinglage auto du meilleur clip (seuil de réactions), indépendant du Guess Rank.
    try {
      if (message.partial) await message.fetch().catch(() => {});
      await handleClipReaction(message);
    } catch {
      /* best-effort */
    }

    const cfg = await getGuessRankConfig(guild.id);
    if (!cfg.enabled || !cfg.singleVote) return;
    if (!cfg.channelIds.includes(message.channelId)) return;

    const rankKeys = new Set(cfg.reactions.map(reactionStoredKey));
    const addedKey = reaction.emoji.id || reaction.emoji.name;
    if (!rankKeys.has(addedKey)) return; // pas un emoji de rank : on ignore

    // Retire les autres votes de rank de ce membre sur ce message.
    if (message.partial) await message.fetch().catch(() => {});
    for (const r of message.reactions.cache.values()) {
      const key = r.emoji.id || r.emoji.name;
      if (!rankKeys.has(key) || key === addedKey) continue;
      try {
        await r.users.fetch();
        if (r.users.cache.has(user.id)) await r.users.remove(user.id);
      } catch {
        /* best-effort */
      }
    }
  } catch (err) {
    console.warn("Erreur vote rank :", err.message);
  }
});

// ---------- Automatisation des matchs de tournoi ----------
// Extraite dans ./tournamentAutomation.js (tournamentTick).

client.login(config.token);

// ---------- Arrêt propre (SIGINT/SIGTERM, ex. `pm2 restart`) ----------
// Stoppe les boucles périodiques, déconnecte le client Discord, puis ferme la base
// (checkpoint WAL). Évite qu'un tick écrive dans une base fermée et limite les fuites.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Arrêt en cours (${signal})...`);

  // Filet de sécurité : si la fermeture traîne, on quitte quand même.
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();

  for (const h of intervals) clearInterval(h);
  try {
    await client.destroy(); // yield aussi aux écritures en attente (chaînes de saveDoc)
  } catch {
    /* best-effort */
  }
  closeDb();
  console.log("Arrêt propre terminé.");
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
