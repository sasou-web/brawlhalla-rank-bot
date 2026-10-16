import { MessageFlags, PermissionFlagsBits } from "discord.js";
import {
  getLadderConfig,
  getSeasonInfo,
  getLadderMatch,
  createChallenge,
  discardChallenge,
  setLadderMessage,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  recordGame,
  undoGame,
  confirmResult,
  disputeLadderMatch,
  setDisputeAlert,
  resolveLadderMatch,
  voidLadderMatch,
  expireLadderMatch,
  dueLadderMatches,
  getLadderRanking,
  ladderStanding,
  currentElo,
  recentLadderMatches,
  nextStatus,
  maybeResetLadderSeason,
  resetLadderSeason,
  CHALLENGE_TTL_MS,
} from "../ladder.js";
import {
  buildLadderCard,
  buildLadderResultAnnounce,
  buildLadderModAlert,
  buildLadderModAlertDone,
  buildLadderTopCard,
  buildLadderPlayerCard,
  buildSeasonPodiumAnnounce,
} from "../ladderUI.js";
import { LADDER_TOP_ROLE_NAME, LADDER_TOP_ROLE_COLOR } from "../config.js";
import { ensureRole } from "../roles.js";
import { getLink } from "../store.js";
import { EPHEMERAL, logAudit } from "./shared.js";
import { enforceCooldown } from "./cooldowns.js";
import { collectProofFiles, isImageFile, readTextField, sendWithFilesFallback, showUploadModal, buildDisputeModal } from "../proofUpload.js";

// ====================================================================
// Ladder : /defi, /ladder, boutons lad_*, modal de litige, boucle de fond
// ====================================================================

const V2 = MessageFlags.IsComponentsV2;
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

function isLadderStaff(interaction, cfg) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      (cfg.modRoleId && interaction.member?.roles?.cache?.has(cfg.modRoleId)),
  );
}

function eloPair(guildId, match, cfg) {
  return { eloA: currentElo(guildId, match.a_id, cfg), eloB: currentElo(guildId, match.b_id, cfg), cfg };
}

/** Réédite la carte du défi (salon du ladder), hors interaction sur la carte. Best-effort. */
export async function refreshLadderCard(client, match, cfg) {
  if (!match?.channel_id || !match?.message_id) return false;
  try {
    const ch = await client.channels.fetch(match.channel_id);
    const msg = await ch.messages.fetch(match.message_id);
    await msg.edit(buildLadderCard(match, eloPair(match.guild_id, match, cfg)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Donne le rôle « 🥇 Ladder #1 » au leader encore présent sur le serveur et le retire aux
 * autres (même principe que le rôle « N°1 du serveur »). Le rôle n'est créé que s'il y a un
 * leader. Best-effort : renvoie { leaderId, roleId } ou null.
 */
export async function updateLadderTopRole(guild) {
  try {
    let leader = null;
    for (const r of getLadderRanking(guild.id).slice(0, 20)) {
      leader = guild.members.cache.get(r.user_id) ?? (await guild.members.fetch(r.user_id).catch(() => null));
      if (leader) break;
    }
    let role = guild.roles.cache.find((r) => r.name === LADDER_TOP_ROLE_NAME);
    if (!role && !leader) return null;
    if (!role) role = await ensureRole(guild, LADDER_TOP_ROLE_NAME, LADDER_TOP_ROLE_COLOR);
    for (const m of role.members?.values?.() ?? []) {
      if (m.id !== leader?.id) await m.roles.remove(role, "N'est plus n°1 du ladder").catch(() => {});
    }
    if (leader && !leader.roles.cache.has(role.id)) await leader.roles.add(role, "N°1 du ladder").catch(() => {});
    return { leaderId: leader?.id ?? null, roleId: role.id };
  } catch (err) {
    console.warn("Rôle Ladder #1 :", err.message);
    return null;
  }
}

async function ladderChannel(guild, cfg) {
  if (!cfg.channelId) return null;
  const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
  return ch?.isTextBased?.() ? ch : null;
}

/**
 * Après une validation (perdant, bot ou staff) : annonce dans le salon du ladder, rôle du
 * leader, alerte staff marquée tranchée. `refreshCard` : la carte n'a pas déjà été éditée par
 * l'interaction en cours. Tout est best-effort : l'Elo est déjà écrit.
 */
export async function afterLadderValidation(client, guild, match, cfg, { how = "", refreshCard = true, staffId = "" } = {}) {
  if (refreshCard) await refreshLadderCard(client, match, cfg);
  const ch = await ladderChannel(guild, cfg);
  if (ch) {
    const { position } = ladderStanding(guild.id, match.winner_id);
    await ch.send(buildLadderResultAnnounce(match, { position, how })).catch(() => {});
  }
  await markAlertDone(client, match, staffId);
  await updateLadderTopRole(guild);
}

async function markAlertDone(client, match, staffId) {
  const d = match.dispute;
  if (!d?.alertChannelId || !d?.alertMessageId) return;
  try {
    const ch = await client.channels.fetch(d.alertChannelId);
    const msg = await ch.messages.fetch(d.alertMessageId);
    await msg.edit(buildLadderModAlertDone(match, staffId));
  } catch {
    /* alerte supprimée */
  }
}

/** Décision staff (bouton de l'alerte ou dashboard) : victoire à `side`, Elo, annonce, rôle. */
export async function staffResolveLadder(client, guild, matchId, side, staffId) {
  const cfg = await getLadderConfig(guild.id);
  const r = resolveLadderMatch(guild.id, matchId, side, { by: staffId, cfg });
  if (!r.ok) return r;
  await afterLadderValidation(client, guild, r.match, cfg, { how: "décision du staff", staffId });
  await logAudit(guild, `⚔️ <@${staffId}> a tranché le défi ladder \`${matchId}\` : victoire de <@${r.match.winner_id}> (${r.result.delta > 0 ? "+" : ""}${r.result.delta} Elo).`);
  return r;
}

/** Annulation staff (aucun point). */
export async function staffVoidLadder(client, guild, matchId, staffId) {
  const cfg = await getLadderConfig(guild.id);
  const r = voidLadderMatch(guild.id, matchId, { by: staffId });
  if (!r.ok) return r;
  await refreshLadderCard(client, r.match, cfg);
  await markAlertDone(client, r.match, staffId);
  await logAudit(guild, `⚔️ <@${staffId}> a annulé le défi ladder \`${matchId}\` (<@${r.match.a_id}> contre <@${r.match.b_id}>), aucun point attribué.`);
  return r;
}

/** Nouvelle saison (dashboard ou automatique) : archive, podium, rôle retiré. */
export async function closeLadderSeason(guild, { by = "", archive = null } = {}) {
  const cfg = await getLadderConfig(guild.id);
  const a = archive || (await resetLadderSeason(guild.id, { by }));
  const ch = await ladderChannel(guild, cfg);
  if (ch) await ch.send(buildSeasonPodiumAnnounce(a)).catch(() => {});
  await updateLadderTopRole(guild);
  await logAudit(guild, `🏁 Saison ${a.season} du ladder close${by && by !== "auto" ? ` par <@${by}>` : " automatiquement"} : ${a.players} joueur(s), ${a.matches} défi(s) validé(s).`);
  return a;
}

// ---------- /defi ----------

export async function handleDefi(interaction) {
  const guild = interaction.guild;
  const cfg = await getLadderConfig(guild.id);
  if (!cfg.enabled) return interaction.reply({ content: "⚔️ Le ladder n'est pas activé sur ce serveur.", flags: EPHEMERAL });
  if (!cfg.channelId) return interaction.reply({ content: "⚔️ Le salon du ladder n'est pas configuré : préviens le staff.", flags: EPHEMERAL });

  const target = interaction.options.getUser("joueur", true);
  const targetMember = interaction.options.getMember("joueur");
  const bestOf = interaction.options.getInteger("bo") ?? 3;
  if (!targetMember && !target.bot) return interaction.reply({ content: "Ce membre n'est pas sur le serveur.", flags: EPHEMERAL });

  // Accusé avant les lectures de liaison et la publication de la carte (fenêtre de 3 s).
  await interaction.deferReply({ flags: EPHEMERAL });
  const [linkA, linkB] = cfg.requireLink ? await Promise.all([getLink(interaction.user.id), getLink(target.id)]) : [true, true];
  const created = createChallenge(guild.id, {
    aId: interaction.user.id,
    bId: target.id,
    aName: interaction.member?.displayName || interaction.user.username,
    bName: targetMember?.displayName || target.username,
    bestOf,
    targetBot: target.bot,
    linkedA: Boolean(linkA),
    linkedB: Boolean(linkB),
    cfg,
  });
  if (!created.ok) return interaction.editReply(`❌ ${created.error}`);
  const match = created.match;

  const channel = await ladderChannel(guild, cfg);
  let message = null;
  if (channel) message = await channel.send(buildLadderCard(match, eloPair(guild.id, match, cfg))).catch(() => null);
  if (!message) {
    // Jamais publié : on efface le défi (il ne doit ni bloquer la paire ni compter au cooldown).
    discardChallenge(guild.id, match.id);
    return interaction.editReply(
      `❌ Impossible de publier le défi dans <#${cfg.channelId}> : vérifie que le bot peut y voir le salon, écrire et intégrer des liens.`,
    );
  }
  setLadderMessage(guild.id, match.id, channel.id, message.id);
  return interaction.editReply(`⚔️ Défi envoyé à <@${target.id}> dans <#${channel.id}> (BO${bestOf}). Sans réponse, il expire ${ts(match.created_at + CHALLENGE_TTL_MS)}.`);
}

// ---------- /ladder ----------

export async function handleLadder(interaction) {
  if (!(await enforceCooldown(interaction, "ladder", 4000))) return;
  const guildId = interaction.guild.id;
  const cfg = await getLadderConfig(guildId);
  if (!cfg.enabled) return interaction.reply({ content: "⚔️ Le ladder n'est pas activé sur ce serveur.", flags: EPHEMERAL });
  await interaction.deferReply({ flags: V2 });
  const { season } = getSeasonInfo(guildId);
  const user = interaction.options.getUser("membre") ?? (interaction.options.getBoolean("moi") ? interaction.user : null);
  const container = user
    ? buildLadderPlayerCard(user.id, user.username, { standing: ladderStanding(guildId, user.id), recent: recentLadderMatches(guildId, user.id, 5), season })
    : buildLadderTopCard(getLadderRanking(guildId), { season, cfg });
  return interaction.editReply({ components: [container], flags: V2, allowedMentions: { parse: [] } });
}

// ---------- Boutons ----------

function replyError(interaction, error) {
  const content = `❌ ${error}`;
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: EPHEMERAL }).catch(() => {});
  return interaction.reply({ content, flags: EPHEMERAL });
}

export async function handleLadderButton(interaction) {
  const [action, id, side, extra] = interaction.customId.split(":");
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const cfg = await getLadderConfig(guild.id);
  const match = getLadderMatch(guild.id, id);
  if (!match) return interaction.reply({ content: "Défi introuvable.", flags: EPHEMERAL });

  // Décisions staff (alerte de litige), avec confirmation : actives même ladder désactivé.
  if (action.startsWith("lad_mod")) {
    if (!isLadderStaff(interaction, cfg)) return interaction.reply({ content: "Réservé au staff.", flags: EPHEMERAL });
    const name = side === "a" ? match.a_name : match.b_name;
    if (action === "lad_modwin") {
      const check = nextStatus(match, "resolve", userId, { isStaff: true });
      if (!check.ok) return interaction.reply({ content: `❌ ${check.error}`, flags: EPHEMERAL });
      return interaction.reply({
        content: `⚠️ Donner la **victoire à ${name || "ce joueur"}** ? L'Elo des deux joueurs est mis à jour et le résultat est annoncé.`,
        components: [{ type: 1, components: [{ type: 2, style: 3, label: `Oui, victoire ${name}`.slice(0, 80), custom_id: `lad_modwinok:${id}:${side}` }] }],
        flags: EPHEMERAL,
      });
    }
    if (action === "lad_modvoid") {
      const check = nextStatus(match, "void", userId, { isStaff: true });
      if (!check.ok) return interaction.reply({ content: `❌ ${check.error}`, flags: EPHEMERAL });
      return interaction.reply({
        content: "⚠️ **Annuler ce défi** ? Aucun point n'est attribué.",
        components: [{ type: 1, components: [{ type: 2, style: 4, label: "Oui, annuler le défi", custom_id: `lad_modvoidok:${id}` }] }],
        flags: EPHEMERAL,
      });
    }
    // Confirmations : accusé et retrait du bouton avant les appels Discord (fenêtre de 3 s).
    await interaction.update({ content: "⏳ Application de la décision…", components: [] });
    const r = action === "lad_modwinok" ? await staffResolveLadder(interaction.client, guild, id, side, userId) : await staffVoidLadder(interaction.client, guild, id, userId);
    if (!r.ok) return interaction.editReply({ content: `❌ ${r.error}`, components: [] });
    return interaction.editReply({
      content: action === "lad_modwinok" ? `✅ Victoire attribuée à **${name}** (${r.result.delta > 0 ? "+" : ""}${r.result.delta} Elo).` : "✅ Défi annulé, aucun point attribué.",
      components: [],
    });
  }

  if (!cfg.enabled) return interaction.reply({ content: "⚔️ Le ladder est désactivé pour le moment.", flags: EPHEMERAL });

  switch (action) {
    case "lad_accept": {
      const r = acceptChallenge(guild.id, id, userId);
      if (!r.ok) return replyError(interaction, r.error);
      await interaction.update(buildLadderCard(r.match, eloPair(guild.id, r.match, cfg)));
      await interaction
        .followUp({
          content: `<@${r.match.a_id}>, <@${userId}> relève ton défi ! Créez la salle et notez chaque manche sur le scoreboard.`,
          allowedMentions: { users: [r.match.a_id] },
        })
        .catch(() => {});
      return;
    }
    case "lad_decline":
    case "lad_cancel": {
      const r = action === "lad_decline" ? declineChallenge(guild.id, id, userId) : cancelChallenge(guild.id, id, userId);
      if (!r.ok) return replyError(interaction, r.error);
      return interaction.update(buildLadderCard(r.match, eloPair(guild.id, r.match, cfg)));
    }
    case "lad_game": {
      // customId : lad_game:<id>:<a|b>:<manches déjà jouées> (voir recordGame).
      const r = recordGame(guild.id, id, side, userId, extra === undefined ? NaN : Number(extra));
      if (!r.ok) return replyError(interaction, r.error);
      await interaction.update(buildLadderCard(r.match, eloPair(guild.id, r.match, cfg)));
      if (r.finished) {
        const loserId = r.match.winner_id === r.match.a_id ? r.match.b_id : r.match.a_id;
        await interaction
          .followUp({
            content: `<@${loserId}>, confirme le résultat de ton défi contre <@${r.match.winner_id}> ou signale un litige sur la carte.`,
            allowedMentions: { users: [loserId] },
          })
          .catch(() => {});
      }
      return;
    }
    case "lad_undo": {
      const r = undoGame(guild.id, id, userId);
      if (!r.ok) return replyError(interaction, r.error);
      return interaction.update(buildLadderCard(r.match, eloPair(guild.id, r.match, cfg)));
    }
    case "lad_dispute": {
      // Le modal doit être la première réponse : on vérifie sans rien écrire avant.
      const check = nextStatus(match, "dispute", userId);
      if (!check.ok) return replyError(interaction, check.error);
      return showUploadModal(interaction, buildDisputeModal(`lad_dispute_modal:${id}`));
    }
    case "lad_confirm": {
      const r = confirmResult(guild.id, id, userId, cfg);
      if (!r.ok) return replyError(interaction, r.error);
      await interaction.update(buildLadderCard(r.match, eloPair(guild.id, r.match, cfg)));
      await afterLadderValidation(interaction.client, guild, r.match, cfg, { refreshCard: false });
      return;
    }
  }
}

// ---------- Modal de litige ----------

export async function handleLadderModal(interaction) {
  const id = interaction.customId.split(":")[1];
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const cfg = await getLadderConfig(guild.id);
  const match = getLadderMatch(guild.id, id);
  if (!match) return interaction.reply({ content: "Défi introuvable.", flags: EPHEMERAL });
  const check = nextStatus(match, "dispute", userId);
  if (!check.ok) return interaction.reply({ content: `❌ ${check.error}`, flags: EPHEMERAL });

  // Accusé avant le téléchargement des captures et les appels Discord (fenêtre de 3 s).
  await interaction.deferReply({ flags: EPHEMERAL });
  const reason = readTextField(interaction, "reason").slice(0, 500) || "Non précisée";
  const collected = await collectProofFiles(interaction, { maxFiles: 3, allowVideo: true, required: false });
  const files = collected.ok ? collected.files : [];
  const byName = interaction.member?.displayName || interaction.user.username;
  const r = disputeLadderMatch(guild.id, id, userId, { reason, byName, files: files.length });
  if (!r.ok) return interaction.editReply(`❌ ${r.error}`);

  await refreshLadderCard(interaction.client, r.match, cfg);
  let alerted = false;
  let filesPosted = false;
  if (cfg.modAlertChannelId) {
    const ch = await guild.channels.fetch(cfg.modAlertChannelId).catch(() => null);
    if (ch?.isTextBased?.()) {
      const imageName = files.find((f) => isImageFile(f.name))?.name;
      const payload = buildLadderModAlert(r.match, { reason, by: userId, imageName, files: files.length, cfg });
      const sent = await sendWithFilesFallback(ch, payload, files).catch(() => null);
      if (sent?.message) {
        alerted = true;
        filesPosted = sent.filesPosted;
        setDisputeAlert(guild.id, id, ch.id, sent.message.id);
      }
    }
  }
  // La raison (texte libre du joueur) reste hors du journal : logAudit n'encadre pas les mentions.
  await logAudit(guild, `⚠️ Litige ladder signalé par <@${userId}> sur le défi \`${id}\` (<@${r.match.a_id}> contre <@${r.match.b_id}>)${files.length ? `, ${files.length} capture(s)` : ""}.`);
  const lines = [alerted ? "⚠️ Litige signalé, le staff a été prévenu." : "⚠️ Litige enregistré. Aucun salon d'alerte staff n'est configuré : préviens un modérateur."];
  if (!collected.ok) lines.push(`📎 Capture non jointe : ${collected.error}`);
  else if (files.length && alerted && !filesPosted) lines.push("📎 Ta capture n'a pas pu être jointe à l'alerte : envoie-la à un modérateur.");
  return interaction.editReply(lines.join("\n"));
}

// ---------- Boucle de fond (60 s) ----------

let ticking = false;

/**
 * Expirations (défi sans réponse 24 h, défi accepté sans résultat 24 h), validations
 * automatiques (`autoConfirmHours` après le score final) et saison mensuelle. Inerte si le
 * ladder est désactivé. Garde anti-chevauchement. Renvoie le bilan du passage.
 */
export async function tickLadder(client, guild, now = Date.now()) {
  const out = { expired: 0, confirmed: 0, season: null };
  if (ticking) return out;
  ticking = true;
  try {
    const cfg = await getLadderConfig(guild.id);
    if (!cfg.enabled) return out;
    for (const m of dueLadderMatches(guild.id, cfg, now)) {
      if (m.status === "reported") {
        const r = confirmResult(guild.id, m.id, null, cfg, now);
        if (!r.ok) continue;
        out.confirmed++;
        await afterLadderValidation(client, guild, r.match, cfg, { how: "validé automatiquement" });
      } else {
        const r = expireLadderMatch(guild.id, m.id, now);
        if (!r.ok) continue;
        out.expired++;
        await refreshLadderCard(client, r.match, cfg);
      }
    }
    const archive = await maybeResetLadderSeason(guild.id, now);
    if (archive) out.season = await closeLadderSeason(guild, { by: "auto", archive });
    return out;
  } finally {
    ticking = false;
  }
}
