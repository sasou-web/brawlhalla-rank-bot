import { PermissionFlagsBits } from "discord.js";
import {
  LFG_MODES,
  LFG_COOLDOWN_MS,
  LFG_TEXT_MAX,
  getLfgConfig,
  getPost,
  findOpenPostByAuthor,
  reservePost,
  deletePost,
  saveLfg,
  canJoin,
  canPublish,
  modeFromRoleMentions,
  lfgChannelFor,
  isLfgChannelFor,
  noteFromMessage,
  joinPost,
  leavePost,
  closePost,
  toggleVoice,
  lfgCapacity,
  pingRoleFor,
  pingDecision,
  pingCooldownLeft,
  markPinged,
  unmarkPinged,
  memberTier,
  memberRating,
  renderLfgCard,
} from "../lfg.js";
import { getLink } from "../store.js";
import { getWordFilterConfig, checkWordFilterText } from "../wordfilter.js";
import { createTempChannelFor } from "../voiceManager.js";
import { checkCooldown, peekCooldown } from "./cooldowns.js";
import { EPHEMERAL, logAudit } from "./shared.js";

const postUrl = (guildId, post) => `https://discord.com/channels/${guildId}/${post.channelId}/${post.messageId}`;

export const JOIN_REFUSALS = {
  closed: "Cette annonce n'est plus ouverte.",
  author: "C'est ton annonce : attends qu'on te rejoigne.",
  already: "Tu fais déjà partie de cette équipe.",
  full: "L'équipe est déjà complète.",
  not_linked: "Lie d'abord ton compte Brawlhalla avec `/lier` : en 2v2 et 3v3, le LFG vérifie le rank de chacun. Le 1v1 entraînement est ouvert à tous.",
  tier_gap: "L'écart de rank avec l'auteur est trop grand pour cette annonce.",
};

// ---------- /lfg ----------

export async function handleLfg(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const cfg = await getLfgConfig(guildId);
  const mode = interaction.options.getString("mode", true);
  const channelId = lfgChannelFor(cfg, mode);
  if (!cfg.enabled || !channelId) {
    return interaction.reply({ content: "Le LFG n'est pas activé sur ce serveur.", flags: EPHEMERAL });
  }
  const wait = peekCooldown("lfg", userId, LFG_COOLDOWN_MS);
  if (wait > 0) {
    return interaction.reply({ content: `⏳ Doucement ! Tu pourras republier dans **${Math.ceil(wait / 1000)}s**.`, flags: EPHEMERAL });
  }
  const existing = findOpenPostByAuthor(guildId, userId, mode);
  if (existing) return interaction.reply({ content: alreadyActive(guildId, existing), flags: EPHEMERAL });
  const link = await getLink(userId);
  const allowed = canPublish(mode, link, cfg);
  if (!allowed.ok) {
    const content = allowed.reason === "not_linked" ? JOIN_REFUSALS.not_linked : "Mode inconnu.";
    return interaction.reply({ content, flags: EPHEMERAL });
  }
  const region = interaction.options.getString("region") ?? link?.region ?? "";
  const text = (interaction.options.getString("message") ?? "").replace(/\s+/g, " ").trim().slice(0, LFG_TEXT_MAX);
  if (text) {
    const wf = await getWordFilterConfig(guildId);
    if (wf.enabled && checkWordFilterText(text, wf).matches.length) {
      return interaction.reply({ content: "Ton message contient un terme interdit sur ce serveur. Reformule-le.", flags: EPHEMERAL });
    }
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return interaction.editReply("Le salon LFG est introuvable : préviens le staff.");

  const pingCooldownMs = cfg.pingCooldownMinutes * 60 * 1000;
  const pingRoleId = pingRoleFor(cfg, mode);
  const ping = pingDecision(pingRoleId, {
    role: pingRoleId ? interaction.guild.roles.cache.get(pingRoleId) ?? null : null,
    botCanMentionAll: channel.permissionsFor?.(interaction.guild.members.me)?.has(PermissionFlagsBits.MentionEveryone) ?? false,
    cooldownLeftMs: pingCooldownLeft(guildId, userId, pingCooldownMs),
  });
  if (ping.reason === "missing" || ping.reason === "not_mentionable") {
    console.warn(`LFG : rôle de recherche ${pingRoleId} (${mode}) ${ping.reason === "missing" ? "introuvable" : "non mentionnable par le bot"}, annonce publiée sans ping.`);
  }

  const res = reservePost(guildId, {
    authorId: userId,
    mode,
    region,
    text,
    tier: memberTier(link, mode),
    rating: memberRating(link, mode),
    channelId: channel.id,
    ttlMinutes: cfg.ttlMinutes,
    pingRoleId: ping.roleId,
    voice: interaction.options.getBoolean?.("vocal") ?? true,
  });
  if (res.error) return interaction.editReply(alreadyActive(guildId, res.post));

  const post = res.post;
  let message;
  try {
    message = await channel.send(await renderLfgCard(guildId, post, { ping: true }));
  } catch (err) {
    await deletePost(guildId, post.id);
    return interaction.editReply(`Impossible de publier dans <#${channel.id}> (${err.message}). Préviens le staff.`);
  }
  post.messageId = message.id;
  if (ping.roleId) markPinged(guildId, userId);
  await saveLfg();
  checkCooldown("lfg", userId, LFG_COOLDOWN_MS);
  return interaction.editReply(`✅ Annonce publiée : ${message.url}\nElle expire dans ${cfg.ttlMinutes} min.${pingNote(ping, guildId, userId, pingCooldownMs)}`);
}

function alreadyActive(guildId, post) {
  const where = post.messageId ? ` : ${postUrl(guildId, post)}` : ".";
  return `Tu as déjà une annonce ${LFG_MODES[post.mode]?.label ?? post.mode} active${where}\nFerme-la avant d'en publier une autre.`;
}

function pingNote(ping, guildId, userId, pingCooldownMs) {
  if (ping.roleId) return `\n🔔 Le rôle <@&${ping.roleId}> a été pingé.`;
  if (ping.reason === "cooldown") {
    const min = Math.ceil(pingCooldownLeft(guildId, userId, pingCooldownMs) / 60000);
    return `\n🔕 Pas de ping cette fois : tu as déjà pingé le rôle récemment (prochain ping possible dans ${min} min).`;
  }
  if (ping.reason) return "\n🔕 Le rôle de recherche n'a pas pu être pingé : préviens le staff.";
  return "";
}

// ---------- Annonce par ping du rôle de recherche ----------

const REFUSAL_REPLY_MS = 60_000;

// Réponse courte au message d'origine, retirée au bout de 20 s, au plus une par membre et par
// minute : un membre qui spamme le ping ne fait pas spammer le bot à son tour.
async function replyBriefly(message, content) {
  if (!checkCooldown("lfg_ping_refusal", message.author.id, REFUSAL_REPLY_MS).ok) return;
  const r = await message.reply({ content, allowedMentions: { repliedUser: true, parse: [] } }).catch(() => null);
  if (r) setTimeout(() => r.delete().catch(() => {}), 20_000).unref?.();
}

/**
 * Un membre pingue « 🔍 Recherche 1v1/2v2 » (ou le rôle 3v3) dans le salon LFG : la carte
 * est créée en réponse à son message, avec les valeurs par défaut (vocal oui, durée du
 * dashboard) et son texte comme note. Le rôle n'est pas repingé (il vient de l'être).
 * Mêmes règles que /lfg (compte lié en 2v2/3v3, une annonce active par mode) et, en plus,
 * le délai anti-spam du ping : un membre qui a pingé le rôle il y a moins de
 * `pingCooldownMinutes` n'obtient pas de carte. Appelé après le filtre de mots (un message
 * retiré ne crée rien) et seulement à la création du message (pas à l'édition).
 */
export async function handleLfgMention(message) {
  const guildId = message.guild?.id;
  if (!guildId || message.author?.bot || message.webhookId || message.system) return false;
  // Un message qui pingue @everyone/@here (annonce du staff) n'est pas une recherche.
  if (message.mentions?.everyone) return false;
  const cfg = await getLfgConfig(guildId);
  if (!cfg.enabled) return false;
  const mode = modeFromRoleMentions(cfg, [...(message.mentions?.roles?.keys?.() ?? [])]);
  // Salon de ce mode ou salon par défaut uniquement : un fil a son propre identifiant de
  // salon, il est donc ignoré, comme le salon d'un autre mode.
  if (!mode || !isLfgChannelFor(cfg, mode, message.channelId)) return false;

  const userId = message.author.id;
  const link = await getLink(userId);
  const allowed = canPublish(mode, link, cfg);
  if (!allowed.ok) {
    await replyBriefly(message, JOIN_REFUSALS.not_linked);
    return false;
  }

  // Vérifications et réservation sans `await` entre elles : deux messages envoyés en rafale
  // (même mode ou deux modes différents) ne créent qu'une carte.
  const existing = findOpenPostByAuthor(guildId, userId, mode);
  if (existing) {
    await replyBriefly(message, alreadyActive(guildId, existing));
    return false;
  }
  const pingCooldownMs = cfg.pingCooldownMinutes * 60 * 1000;
  const wait = pingCooldownLeft(guildId, userId, pingCooldownMs);
  if (wait > 0) {
    await replyBriefly(
      message,
      `⏳ Tu as déjà pingé un rôle de recherche il y a peu : pas de nouvelle annonce avant **${Math.ceil(wait / 60000)} min**. Évite de repinguer le rôle d'ici là.`,
    );
    return false;
  }
  const res = reservePost(guildId, {
    authorId: userId,
    mode,
    region: link?.region ?? "",
    text: noteFromMessage(message.content),
    tier: memberTier(link, mode),
    rating: memberRating(link, mode),
    channelId: message.channelId,
    ttlMinutes: cfg.ttlMinutes,
  });
  if (res.error) return false; // impossible ici (vérifié juste avant), gardé par sécurité
  const post = res.post;
  const previousPing = markPinged(guildId, userId);
  try {
    const card = await renderLfgCard(guildId, post);
    // failIfNotExists : si le message a été supprimé entre-temps, l'envoi échoue et rien n'est créé.
    const sent = await message.channel.send({
      ...card,
      reply: { messageReference: message.id, failIfNotExists: true },
      allowedMentions: { parse: [], repliedUser: false },
    });
    post.messageId = sent.id;
  } catch (err) {
    unmarkPinged(guildId, userId, previousPing);
    await deletePost(guildId, post.id);
    console.warn("LFG : annonce par ping impossible :", err.message);
    return false;
  }
  await saveLfg();
  return true;
}

// ---------- Boutons lfg_join / lfg_leave / lfg_close / lfg_voice ----------

export async function handleLfgButton(interaction) {
  const [action, id] = interaction.customId.split(":");
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const post = getPost(guildId, id);
  if (!post) return interaction.reply({ content: "Cette annonce n'existe plus.", flags: EPHEMERAL });

  if (action === "lfg_join") {
    const [cfg, link] = await Promise.all([getLfgConfig(guildId), getLink(userId)]);
    // Vérification et ajout sans `await` entre les deux : deux clics simultanés ne dépassent pas la capacité.
    const check = canJoin(post, link, userId, cfg);
    if (!check.ok) return interaction.reply({ content: JOIN_REFUSALS[check.reason], flags: EPHEMERAL });
    joinPost(post, userId);
    await saveLfg();
    await interaction.update(await renderLfgCard(guildId, post));
    if (post.status === "full") await onTeamFull(interaction, post, cfg);
    return;
  }

  if (action === "lfg_leave") {
    if (post.status !== "open") return interaction.reply({ content: JOIN_REFUSALS.closed, flags: EPHEMERAL });
    if (userId === post.authorId) return interaction.reply({ content: "Tu es l'auteur : utilise « Fermer » pour retirer l'annonce.", flags: EPHEMERAL });
    if (!leavePost(post, userId)) return interaction.reply({ content: "Tu ne fais pas partie de cette équipe.", flags: EPHEMERAL });
    await saveLfg();
    return interaction.update(await renderLfgCard(guildId, post));
  }

  if (action === "lfg_voice") {
    if (userId !== post.authorId) return interaction.reply({ content: "Seul l'auteur de l'annonce peut changer le vocal.", flags: EPHEMERAL });
    if (!toggleVoice(post)) return interaction.reply({ content: JOIN_REFUSALS.closed, flags: EPHEMERAL });
    await saveLfg();
    // Édition de la carte : allowedMentions vide, personne n'est notifié.
    return interaction.update(await renderLfgCard(guildId, post));
  }

  if (action === "lfg_close") {
    const staff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
    if (userId !== post.authorId && !staff) {
      return interaction.reply({ content: "Seul l'auteur de l'annonce ou le staff peut la fermer.", flags: EPHEMERAL });
    }
    if (!closePost(post, "closed")) return interaction.reply({ content: "Cette annonce est déjà terminée.", flags: EPHEMERAL });
    await saveLfg();
    await interaction.update(await renderLfgCard(guildId, post));
    if (userId !== post.authorId) await logAudit(interaction.guild, `🔒 <@${userId}> a fermé l'annonce LFG de <@${post.authorId}>.`);
  }
}

// Équipe complète : vocal d'équipe (option, sauf annonce « sans voc ») puis ping des membres
// dans un message à part (l'édition de la carte ne notifie personne).
async function onTeamFull(interaction, post, cfg) {
  if (cfg.createVoice && post.voice !== false) {
    const author = interaction.guild.members.cache.get(post.authorId);
    try {
      const voice = await createTempChannelFor(interaction.guild, {
        ownerId: post.authorId,
        name: `🎮 ${LFG_MODES[post.mode]?.label ?? post.mode} · ${author?.displayName ?? "équipe"}`,
        userLimit: lfgCapacity(post.mode),
        categoryId: cfg.voiceCategoryId || interaction.channel?.parentId || null,
        reason: "Équipe LFG complète",
      });
      post.voiceChannelId = voice.id;
      await saveLfg();
      await interaction.editReply(await renderLfgCard(interaction.guildId, post)).catch(() => {});
    } catch (err) {
      console.warn("LFG : création du vocal d'équipe échouée :", err.message);
    }
  }
  const mentions = post.members.map((id) => `<@${id}>`).join(" ");
  await interaction
    .followUp({
      content: `✅ Équipe complète : ${mentions}${post.voiceChannelId ? `\n🎙️ Rendez-vous dans <#${post.voiceChannelId}>.` : ""}`,
      allowedMentions: { users: post.members },
    })
    .catch(() => {});
}
