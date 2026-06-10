import { Client, GatewayIntentBits, Events, MessageFlags, ChannelType, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { installLogCapture } from "./logBuffer.js";
import { initHealth, notifyAdmin } from "./health.js";

installLogCapture(); // capture les logs console pour la page "Logs" du dashboard

// Filets de sécurité process : on log (et on tente d'alerter) sans faire planter le bot.
process.on("unhandledRejection", (reason) => {
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
import { setSetting } from "./settings.js";
import { warmProfiles, syncLeaderboard, getIndexStats, retryPending } from "./brawlhalla.js";
import { addMessageXp, addVoiceXp, getLevelConfig, setLevelConfig, setReward, rewardRolePlan, buildLevelUpAnnounce, getUserStats, computeXpMultiplier } from "./levels.js";
import { pollGuild as pollTikTok, getTikTokConfig } from "./tiktok.js";
import { handleClipMessage, handleClipReaction } from "./clips.js";
import { handleGuessRankMessage, getGuessRankConfig, reactionStoredKey } from "./guessrank.js";
import { startWebServer } from "./web/server.js";
import { getWelcomeConfig, buildWelcomePayload, buildGoodbyePayload } from "./welcome.js";
import { runWeeklyRecap } from "./progression.js";
import { grantAndAnnounce } from "./achievements.js";
import {
  getTournament,
  matchesNeedingChannels,
  setMatchChannel,
  setMatchMessage,
  liveMatchesWithChannel,
  doneMatchesWithChannel,
  clearMatchChannel,
  markAlerted,
  resolveMatch,
} from "./tournament.js";
import { buildMatchPayload, buildModAlert, tournamentAnnounce } from "./tournamentUI.js";
import {
  getTempConfig,
  getHub,
  addTempChannel,
  removeTempChannel,
  isTempChannel,
  getTempChannelIds,
} from "./tempvoice.js";

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

async function refreshAllMembers(guild) {
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
  setInterval(() => refreshAllMembers(guild).catch(console.error), intervalMs);

  // Rechauffe les profils en cache (pour /stats, /rank...) toutes les 15 min, en tache de fond.
  const warm = () =>
    warmProfiles()
      .then((r) => r.total && console.log(`Warm profils : ${r.ok}/${r.total} rafraichis.`))
      .catch(() => {});
  setInterval(warm, 15 * 60 * 1000);
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
  setInterval(syncLb, syncIntervalMs);
  syncLb();

  // Recuperation en arriere-plan des profils/recherches qui ont echoue (API capricieuse) :
  // reessaie regulierement jusqu'a reussir, pour que la commande relancee marche a coup sur.
  // Garde anti-chevauchement : un cycle peut durer jusqu'a ~25 s (budget de retry).
  let retrying = false;
  setInterval(async () => {
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
  setInterval(() => tickVoiceXp(guild).catch(() => {}), VOICE_TICK_MS);

  // Nettoie les salons vocaux temporaires laisses vides apres un redemarrage.
  await cleanupTempChannels(guild);

  // Automatisation des matchs de tournoi (salons, timers AFK/forfait) chaque minute.
  setInterval(() => tournamentTick(guild).catch(() => {}), 60 * 1000);

  // Récap hebdo de progression : vérifié toutes les heures, posté une fois par semaine.
  const recapTick = () =>
    runWeeklyRecap(client, guild.id)
      .then((r) => r.posted && console.log(`Récap hebdo posté (${r.count} progression(s)).`))
      .catch(() => {});
  setInterval(recapTick, 60 * 60 * 1000);
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
  setInterval(async () => {
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
        // Interaction deja differee (deferReply/deferUpdate) : on edite pour ne pas laisser "thinking..."
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* dernier recours : on ignore */
    }
  }
});

// ---------- Systeme de niveaux : XP gagnee en discutant ----------

async function applyRewardRoles(member, level) {
  try {
    const { desired, all } = await rewardRolePlan(member.guild.id, level);
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((id) => id && !member.roles.cache.has(id));
    // Retire uniquement les roles de recompense que le membre ne devrait plus avoir
    // (ne touche jamais aux autres roles du membre).
    const toRemove = all.filter((id) => id && !desiredSet.has(id) && member.roles.cache.has(id));
    if (toAdd.length) await member.roles.add(toAdd, "Recompense de niveau").catch(() => {});
    if (toRemove.length) await member.roles.remove(toRemove, "Mise a jour recompense de niveau").catch(() => {});
  } catch {
    /* best-effort */
  }
}

// Gere une montee de niveau : roles de recompense + annonce.
// fallbackChannel = salon ou annoncer si aucun salon d'annonce n'est configure (peut etre null).
async function handleLevelUp(guild, member, level, oldLevel, fallbackChannel) {
  if (!member) return; // pas de membre = on ne peut ni donner de role ni mentionner proprement
  await applyRewardRoles(member, level);

  // Achievements liés au niveau (best-effort) — annoncés dans le salon dédié "succès" (sans ping).
  grantAndAnnounce(guild, member.id, { level }).catch(() => {});

  const cfg = await getLevelConfig(guild.id);
  if (cfg.announceMode === "off") return;

  const stats = await getUserStats(guild.id, member.id).catch(() => null);
  const { embed, tierCrossed } = buildLevelUpAnnounce(guild, member, level, oldLevel, stats);

  if (cfg.announceMode === "dm") {
    // Mode DM : embed prive, sans mention (la personne est deja la destinataire).
    await member.send({ embeds: [embed] }).catch(() => {});
    return;
  }

  // Ping UNIQUEMENT au passage d'un palier. Sinon, la mention dans l'embed n'alerte pas.
  const payload = tierCrossed
    ? { content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } }
    : { embeds: [embed], allowedMentions: { parse: [] } };
  try {
    if (cfg.announceChannelId) {
      const ch = await guild.channels.fetch(cfg.announceChannelId).catch(() => null);
      if (ch?.isTextBased?.()) await ch.send(payload);
    } else if (fallbackChannel?.isTextBased?.()) {
      await fallbackChannel.send(payload);
    }
  } catch {
    /* annonce best-effort */
  }
}

client.on(Events.MessageCreate, async (message) => {
  // Ignore les bots, MP et messages systeme.
  if (message.author?.bot || !message.guild) return;

  // Reactions auto + moderation des clips (best-effort, n'empeche pas l'XP).
  handleClipMessage(message).catch(() => {});
  handleGuessRankMessage(message).catch(() => {});

  try {
    const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    const mult = await computeXpMultiplier(message.guild.id, { channelId: message.channel.id, roleIds });
    const result = await addMessageXp(message.guild.id, message.author.id, mult);
    if (!result || !result.leveledUp) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    await handleLevelUp(message.guild, member, result.level, result.oldLevel, message.channel);
  } catch (err) {
    console.warn("Erreur XP message :", err.message);
  }
});

// ---------- XP vocal : balaye les salons vocaux a intervalle regulier ----------

const VOICE_TICK_MS = 60 * 1000; // 1 minute

async function tickVoiceXp(guild) {
  let cfg;
  try {
    cfg = await getLevelConfig(guild.id);
  } catch {
    return;
  }
  if (!cfg.enabled || !cfg.voiceEnabled) return;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    if (channel.id === guild.afkChannelId) continue; // pas d'XP dans le salon AFK

    const humans = channel.members.filter((m) => !m.user.bot);
    if (cfg.voiceRequireOthers && humans.size < 2) continue; // seul = pas d'XP

    for (const member of humans.values()) {
      const vs = member.voice;
      if (cfg.voiceIgnoreMuted && (vs?.selfMute || vs?.selfDeaf || vs?.mute || vs?.deaf)) continue;

      try {
        const roleIds = [...member.roles.cache.keys()];
        const mult = await computeXpMultiplier(guild.id, { channelId: channel.id, roleIds });
        const result = await addVoiceXp(guild.id, member.id, cfg.voiceXpPerMin, mult);
        if (result?.leveledUp) await handleLevelUp(guild, member, result.level, result.oldLevel, null);
      } catch {
        /* best-effort */
      }
    }
  }
}

// ---------- Salons vocaux temporaires ("rejoindre pour creer") ----------

// Panneau de controle poste dans le chat du salon vocal (composants en JSON brut).
function voiceControlPanel(ownerId) {
  const embed = {
    title: "🎛️ Panneau de contrôle du salon",
    description:
      `Salon de <@${ownerId}>. Le créateur peut :\n` +
      "🔒 **Verrouiller** (personne ne rejoint) · 🔓 **Ouvrir**\n" +
      "👥 **Limite** de membres · ✏️ **Renommer**\n" +
      "⛔ **Bloquer** un membre · ✅ **Autoriser** un membre\n" +
      "👑 **Réclamer** le salon (si le créateur est parti)",
    color: 0x1abc9c,
  };
  const row1 = {
    type: 1,
    components: [
      { type: 2, style: 2, emoji: { name: "🔒" }, label: "Verrouiller", custom_id: "vc_lock" },
      { type: 2, style: 2, emoji: { name: "🔓" }, label: "Ouvrir", custom_id: "vc_unlock" },
      { type: 2, style: 2, emoji: { name: "👥" }, label: "Limite", custom_id: "vc_limit" },
      { type: 2, style: 2, emoji: { name: "✏️" }, label: "Renommer", custom_id: "vc_rename" },
    ],
  };
  const row2 = {
    type: 1,
    components: [
      { type: 2, style: 4, emoji: { name: "⛔" }, label: "Bloquer", custom_id: "vc_block" },
      { type: 2, style: 3, emoji: { name: "✅" }, label: "Autoriser", custom_id: "vc_permit" },
      { type: 2, style: 1, emoji: { name: "👑" }, label: "Réclamer", custom_id: "vc_claim" },
    ],
  };
  return {
    content: `<@${ownerId}> personnalise ta room 🎛️`,
    embeds: [embed],
    components: [row1, row2],
    allowedMentions: { users: [ownerId] },
  };
}

async function createTempChannel(member, cfg, hubChannel, hub) {
  const guild = member.guild;
  const template = hub?.nameTemplate || "🎮 {user}";
  const name = template.replace(/\{user\}/gi, member.displayName).slice(0, 100);
  const parent = cfg.categoryId || hubChannel.parentId || null;
  try {
    // Creation simple (ne demande que "Gerer les salons"). Pas d'overwrite ici :
    // Discord refuse qu'un bot accorde une permission qu'il n'a pas -> echec total sinon.
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: Math.min(99, Math.max(0, hub?.userLimit || 0)),
      reason: "Salon vocal temporaire",
    });
    await addTempChannel(guild.id, channel.id, member.id);
    await member.voice.setChannel(channel).catch(() => {});

    // Donne au createur le controle de son salon (best-effort : n'echoue pas la creation).
    channel.permissionOverwrites
      .edit(member.id, {
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
      })
      .catch(() => {});

    // Poste le panneau de controle dans le chat integre du salon vocal (best-effort).
    channel.send(voiceControlPanel(member.id)).catch(() => {});
    return channel;
  } catch (err) {
    console.warn("Creation salon temporaire echouee :", err.message);
    return null;
  }
}

async function handleTempVoice(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  // Un membre rejoint un hub -> on lui cree un salon selon le modele de CE hub.
  const cfg = await getTempConfig(guild.id);
  if (cfg.enabled && newState.channelId && newState.member) {
    const hub = await getHub(guild.id, newState.channelId);
    if (hub) {
      const hubChannel =
        guild.channels.cache.get(newState.channelId) ||
        (await guild.channels.fetch(newState.channelId).catch(() => null));
      if (hubChannel) await createTempChannel(newState.member, cfg, hubChannel, hub);
    }
  }

  // Un membre quitte un salon temporaire -> on le supprime s'il est vide.
  const left = oldState.channelId;
  if (left && left !== newState.channelId && (await isTempChannel(guild.id, left))) {
    const ch = guild.channels.cache.get(left) || (await guild.channels.fetch(left).catch(() => null));
    if (!ch) {
      await removeTempChannel(guild.id, left);
    } else if (ch.members.size === 0) {
      await ch.delete("Salon vocal temporaire vide").catch(() => {});
      await removeTempChannel(guild.id, left);
    }
  }
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  handleTempVoice(oldState, newState).catch((e) => console.warn("Erreur tempvoice :", e.message));
});

// Nettoyage au demarrage : supprime les salons temporaires vides/orphelins.
async function cleanupTempChannels(guild) {
  try {
    const ids = await getTempChannelIds(guild.id);
    for (const id of ids) {
      const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
      if (!ch || ch.members?.size === 0) {
        if (ch) await ch.delete("Nettoyage salon temporaire").catch(() => {});
        await removeTempChannel(guild.id, id);
      }
    }
  } catch {
    /* best-effort */
  }
}

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

function slug(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "x";
}
function entrantNameById(t, id) {
  return t.participants.find((p) => p.id === id)?.name || "?";
}

async function sendModAlert(guild, t, matchId, reason) {
  if (!t.modAlertChannelId) return;
  const ch = await guild.channels.fetch(t.modAlertChannelId).catch(() => null);
  if (ch?.isTextBased?.()) await ch.send(buildModAlert(t, matchId, reason)).catch(() => {});
}

async function ensureMatchChannels(guild) {
  const t = await getTournament(guild.id);
  if (!t || t.status !== "running") return;
  for (const m of matchesNeedingChannels(t)) {
    const A = t.participants.find((p) => p.id === m.aId);
    const B = t.participants.find((p) => p.id === m.bId);
    if (!A || !B) continue;
    const players = [...A.members, ...B.members];
    const ow = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    for (const uid of players) ow.push({ id: uid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    if (t.modRoleId) ow.push({ id: t.modRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

    let channel;
    try {
      channel = await guild.channels.create({
        name: `match-${m.id}-${slug(A.name)}-vs-${slug(B.name)}`.slice(0, 95),
        type: ChannelType.GuildText,
        parent: t.matchCategoryId || null,
        permissionOverwrites: ow,
        reason: "Salon de match (tournoi)",
      });
    } catch (e) {
      console.warn("Salon de match échoué :", e.message);
      continue;
    }
    let voiceId = "";
    if (t.createVoice) {
      try {
        const vow = ow.map((o) => (o.deny ? o : { ...o, allow: [...o.allow, PermissionFlagsBits.Connect] }));
        const vc = await guild.channels.create({
          name: `🔊 ${slug(A.name)} vs ${slug(B.name)}`.slice(0, 95),
          type: ChannelType.GuildVoice,
          parent: t.matchCategoryId || null,
          userLimit: t.format === "2v2" ? 4 : 2,
          permissionOverwrites: vow,
          reason: "Vocal de match (tournoi)",
        });
        voiceId = vc.id;
      } catch {
        /* vocal optionnel */
      }
    }
    await setMatchChannel(guild.id, m.id, channel.id, voiceId);
    const fresh = await getTournament(guild.id);
    const sent = await channel.send(buildMatchPayload(fresh, m.id)).catch(() => null);
    if (sent) await setMatchMessage(guild.id, m.id, sent.id);
  }
}

async function tickMatchTimers(guild) {
  const t = await getTournament(guild.id);
  if (!t || t.status !== "running") return;
  const now = Date.now();
  for (const m of liveMatchesWithChannel(t)) {
    const elapsed = (now - (m.startedAt || now)) / 60000;
    const gamesPlayed = (m.scoreA || 0) + (m.scoreB || 0);

    if (m.status === "dispute") {
      if (!m.alerted) {
        await sendModAlert(guild, t, m.id, "Litige en cours");
        await markAlerted(guild.id, m.id);
      }
      continue;
    }
    // Aucune manche jouée après le délai → joueurs probablement inactifs : alerte staff.
    if (gamesPlayed === 0 && elapsed >= t.alertMinutes && !m.alerted) {
      await sendModAlert(guild, t, m.id, `Aucune manche jouée après ${Math.round(elapsed)} min — joueurs peut-être inactifs`);
      await markAlerted(guild.id, m.id);
    }
  }
}

async function cleanupMatchChannels(guild) {
  const t = await getTournament(guild.id);
  if (!t) return;
  for (const m of doneMatchesWithChannel(t)) {
    for (const id of [m.channelId, m.voiceChannelId]) {
      if (!id) continue;
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (ch) await ch.delete("Match terminé").catch(() => {});
    }
    await clearMatchChannel(guild.id, m.id);
  }
}

async function tournamentTick(guild) {
  try {
    await ensureMatchChannels(guild);
    await tickMatchTimers(guild);
    await cleanupMatchChannels(guild);
  } catch (err) {
    console.warn("Tournoi tick :", err.message);
  }
}

client.login(config.token);
