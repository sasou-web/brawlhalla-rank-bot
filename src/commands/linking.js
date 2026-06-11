import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { searchPlayers, getPlayerProfile } from "../brawlhalla.js";
import { removeLink, getLink, findUserByBrawlhallaId } from "../store.js";
import { getSettings } from "../settings.js";
import { managedRoleNames } from "../roles.js";
import { highestTier, tierIndex, tierEmojiResolvable } from "../config.js";
import { EPHEMERAL, logAudit, dmUser, tierEmoji, doSync } from "./shared.js";

// Cooldown anti-spam de /lier (par utilisateur).
const LIER_COOLDOWN_MS = 30_000;
const lierCooldowns = new Map(); // userId -> timestamp

// ---------- Helpers ----------

function tierSummary(tiers) {
  const parts = [];
  if (tiers?.["1v1"]) parts.push(`1v1 ${tierEmoji(tiers["1v1"])} **${tiers["1v1"]}**`);
  if (tiers?.["2v2"]) parts.push(`2v2 ${tierEmoji(tiers["2v2"])} **${tiers["2v2"]}**`);
  return parts.length ? parts.join(" · ") : "aucun rank classé";
}

async function isReviewer(interaction) {
  const { reviewerRoleId, validatorRoleId } = await getSettings();
  const roles = interaction.member?.roles?.cache;
  if (reviewerRoleId && roles?.has(reviewerRoleId)) return true;
  if (validatorRoleId && roles?.has(validatorRoleId)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}


// ---------- /lier ----------

export async function handleLier(interaction, ctx) {
  const now = Date.now();
  // Nettoyage opportuniste : retire les cooldowns expirés pour borner la taille de la Map
  // (sinon elle grossit indéfiniment, un userId par personne ayant déjà fait /lier).
  for (const [uid, ts] of lierCooldowns) {
    if (now - ts >= LIER_COOLDOWN_MS) lierCooldowns.delete(uid);
  }
  const last = lierCooldowns.get(interaction.user.id) ?? 0;
  if (now - last < LIER_COOLDOWN_MS) {
    const wait = Math.ceil((LIER_COOLDOWN_MS - (now - last)) / 1000);
    return interaction.reply({ content: `Patiente ${wait}s avant de réessayer.`, flags: EPHEMERAL });
  }
  lierCooldowns.set(interaction.user.id, now);

  const pseudo = interaction.options.getString("pseudo")?.trim();
  const idOption = interaction.options.getInteger("id");

  if (!pseudo && !idOption) {
    return interaction.reply({
      content: "Indique ton **pseudo** ou ton **Brawlhalla ID**. Ex : `/lier pseudo:TonPseudo` ou `/lier id:123456`.",
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply(); // public : le joueur sera mentionne/notifie au moment du choix

  // ---- Liaison directe par ID : on saute la recherche par pseudo ----
  if (idOption) {
    const brawlhallaId = Number(idOption);
    let data;
    try {
      data = await getPlayerProfile(brawlhallaId);
    } catch (err) {
      const msg = err.pending ? err.message : `Erreur API : ${err.message}`;
      return interaction.editReply(`<@${interaction.user.id}> ${msg}`);
    }
    if (!data || !data.name || data.name === "?") {
      return interaction.editReply(
        `<@${interaction.user.id}> aucun compte Brawlhalla trouvé pour l'ID \`${brawlhallaId}\`. Vérifie ton ID en jeu.`,
      );
    }
    return linkChosenAccount(interaction, { brawlhallaId, member: interaction.member, ctx, data });
  }

  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    const msg = err.pending ? err.message : `Erreur lors de la recherche : ${err.message}`;
    return interaction.editReply(`<@${interaction.user.id}> ${msg}`);
  }
  if (players.length === 0) {
    return interaction.editReply(
      `<@${interaction.user.id}> aucun joueur classé trouvé pour **${pseudo}**. Seuls les joueurs ayant joué en ranked cette saison apparaissent.\n💡 Astuce : tu peux aussi lier directement avec ton **ID** via \`/lier id:123456\`.`,
    );
  }

  const row = new ActionRowBuilder().addComponents(
    players.map((p) => {
      const btn = new ButtonBuilder()
        .setCustomId(`pick:${interaction.user.id}:${p.id}`)
        .setLabel(`${p.username} — ${p.tier ?? "?"} (${p.region}, ${p.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Primary);
      const emoji = tierEmojiResolvable(p.tier ? String(p.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `<@${interaction.user.id}> sélectionne **ton** compte Brawlhalla :`,
    components: [row],
    allowedMentions: { users: [interaction.user.id] },
  });
}

export async function handlePick(interaction, ctx) {
  // customId : pick:<ownerId>:<brawlhallaId>
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  const brawlhallaId = Number(parts[2]);

  // Message public : seul l'auteur de la commande /lier peut choisir son compte.
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "Ce choix ne t'appartient pas. Lance ta propre commande `/lier`.",
      flags: EPHEMERAL,
    });
  }
  await interaction.deferUpdate();
  return linkChosenAccount(interaction, { brawlhallaId, member: interaction.member, ctx });
}

/**
 * Logique commune de liaison d'un compte choisi (par bouton de sélection OU par /lier id:).
 * L'interaction doit déjà être différée (deferReply ou deferUpdate) : tout passe par editReply.
 * - auto-validation si rang ≤ seuil ;
 * - sinon validation staff, avec preuve (fil privé + screenshot) pour les hauts rangs.
 */
async function linkChosenAccount(interaction, { brawlhallaId, member, ctx, data }) {
  const userId = member.id;

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== userId) {
    return interaction.editReply({
      content: `<@${userId}> ce compte est **déjà lié** par <@${owner}>. Si c'est le tien, contacte le staff.`,
      components: [],
      allowedMentions: { users: [userId] },
    });
  }

  if (!data) {
    try {
      data = await getPlayerProfile(brawlhallaId);
    } catch (err) {
      return interaction.editReply({ content: `Erreur API : ${err.message}`, components: [] });
    }
  }

  const settings = await getSettings();
  const top = highestTier(data.tiers);
  const autoApprove =
    !settings.reviewChannelId || tierIndex(top) <= tierIndex(settings.autoApproveTier);

  if (autoApprove) {
    try {
      const result = await doSync(member, brawlhallaId, ctx, data);
      await logAudit(
        interaction.guild,
        `✅ Auto-liaison : <@${userId}> → \`${data.name}\` (${tierSummary(result.tiers)})`,
      );
      const note = data.partial
        ? "\n⚠️ API Brawlhalla indisponible : seul ton rank 1v1 a pu être appliqué. Le reste se mettra à jour automatiquement plus tard."
        : "\nTes rôles seront mis à jour automatiquement.";
      return interaction.editReply({
        content: `<@${userId}> compte lié ! ${tierSummary(result.tiers)}.${note}`,
        components: [],
        allowedMentions: { users: [userId] },
      });
    } catch (err) {
      return interaction.editReply({ content: `Échec de la liaison : ${err.message}`, components: [] });
    }
  }

  // Validation staff requise.
  const channel = await interaction.guild.channels.fetch(settings.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({
      content: "Salon de validation introuvable. Préviens un admin (/setup).",
      components: [],
    });
  }

  // Hauts rangs : on exige une preuve (capture du profil en jeu) dans un fil privé.
  const needsProof = settings.requireProofScreenshot && tierIndex(top) >= tierIndex(settings.proofTier);
  if (needsProof) {
    const res = await openProofThread(interaction, channel, { userId, brawlhallaId, data, settings });
    if (res.ok) {
      return interaction.editReply({
        content:
          `<@${userId}> ton rang **${top}** demande une **preuve** avant validation.\n` +
          `📸 Tu as été ajouté à un **fil privé** : **[clique ici pour l'ouvrir](${res.url})**. ` +
          `Poste-y une **capture de ta page de profil en jeu** avec ton **ID \`${brawlhallaId}\`** visible. Le staff validera ensuite.`,
        components: [],
        allowedMentions: { users: [userId] },
      });
    }
    // Échec de création du fil (permissions, fonctionnalité indispo) : repli sur la review classique.
    await logAudit(interaction.guild, `⚠️ Création du fil de preuve impossible (${res.error}). Repli sur validation classique.`);
  }

  // Validation classique : embed + boutons dans le salon de validation.
  const embed = buildReviewEmbed({ id: userId }, brawlhallaId, data);
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ap:${userId}:${brawlhallaId}`).setLabel("Valider").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rj:${userId}:${brawlhallaId}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
  );

  try {
    await channel.send({ embeds: [embed], components: [actions] });
  } catch (err) {
    return interaction.editReply({ content: `Impossible d'envoyer la demande : ${err.message}`, components: [] });
  }
  return interaction.editReply({
    content: `<@${userId}> ta demande a été envoyée au staff ✅. Tu recevras tes rôles une fois validée.`,
    components: [],
    allowedMentions: { users: [userId] },
  });
}

/**
 * Crée un fil PRIVÉ de validation (mod + joueur) dans le salon de validation, y ajoute le
 * joueur, demande la capture d'écran et propose les boutons Valider/Refuser. Le joueur poste
 * sa preuve directement dans le fil (upload natif Discord). Renvoie { ok, thread?, error? }.
 */
async function openProofThread(interaction, channel, { userId, brawlhallaId, data, settings }) {
  try {
    const thread = await channel.threads.create({
      name: `🎟️ Liaison ${data.name ?? brawlhallaId}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: 1440, // 24 h
      reason: "Validation de liaison Brawlhalla (preuve requise)",
    });
    await thread.members.add(userId).catch(() => {});

    const embed = buildReviewEmbed({ id: userId }, brawlhallaId, data);
    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ap:${userId}:${brawlhallaId}`).setLabel("Valider").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rj:${userId}:${brawlhallaId}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
    );
    const staffPing = settings.reviewerRoleId ? `<@&${settings.reviewerRoleId}> ` : "";
    await thread.send({
      content:
        `${staffPing}Nouvelle demande de liaison à vérifier.\n` +
        `📸 <@${userId}>, envoie **ici** une **capture d'écran de ta page de profil en jeu** ` +
        `avec ton **pseudo** et ton **ID \`${brawlhallaId}\`** bien visibles.\n` +
        `Le staff vérifiera la capture puis cliquera **Valider** ✅.`,
      embeds: [embed],
      components: [actions],
      allowedMentions: { users: [userId], roles: settings.reviewerRoleId ? [settings.reviewerRoleId] : [] },
    });
    const url = `https://discord.com/channels/${interaction.guild.id}/${thread.id}`;
    return { ok: true, threadId: thread.id, url };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildReviewEmbed(user, brawlhallaId, data) {
  return new EmbedBuilder()
    .setTitle("Demande de liaison Brawlhalla")
    .setColor(0x4ea1ff)
    .addFields(
      { name: "Membre", value: `<@${user.id}>`, inline: true },
      { name: "Compte", value: `\`${data.name ?? "?"}\``, inline: true },
      { name: "Brawlhalla ID", value: `\`${brawlhallaId}\``, inline: true },
      { name: "1v1", value: `${data.tiers["1v1"] ? `${tierEmoji(data.tiers["1v1"])} ${data.tiers["1v1"]}` : "—"} (${data.ratings["1v1"]})`, inline: true },
      { name: "2v2", value: `${data.tiers["2v2"] ? `${tierEmoji(data.tiers["2v2"])} ${data.tiers["2v2"]}` : "—"} (${data.ratings["2v2"]})`, inline: true },
      { name: "Région / Peak / Rang", value: `${data.region} · peak ${data.peak1v1} · #${data.globalRank}`, inline: true },
    )
    .setFooter({ text: "Valide uniquement si ce compte appartient bien à ce membre." })
    .setTimestamp(new Date());
}

// ---------- Validation (boutons + modal) ----------

export async function handleApprove(interaction, ctx) {
  if (!(await isReviewer(interaction))) {
    return interaction.reply({ content: "Tu n'as pas la permission de valider.", flags: EPHEMERAL });
  }
  const [, requesterId, bhId] = interaction.customId.split(":");
  const brawlhallaId = Number(bhId);
  await interaction.deferUpdate();

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== requesterId) {
    return concludeReview(interaction, `❌ Déjà lié par <@${owner}> entre-temps.`);
  }
  const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
  if (!member) return concludeReview(interaction, "❌ Membre introuvable.");

  try {
    const result = await doSync(member, brawlhallaId, ctx);
    await dmUser(interaction.client, requesterId, `✅ Ta liaison Brawlhalla a été validée ! ${tierSummary(result.tiers)}.`);
    await logAudit(interaction.guild, `✅ <@${interaction.user.id}> a validé <@${requesterId}> (${tierSummary(result.tiers)}).`);
    return concludeReview(interaction, `✅ Validé par <@${interaction.user.id}> — <@${requesterId}> : ${tierSummary(result.tiers)}.`);
  } catch (err) {
    return concludeReview(interaction, `⚠️ Erreur : ${err.message}`);
  }
}

export async function handleReject(interaction, ctx) {
  if (!(await isReviewer(interaction))) {
    return interaction.reply({ content: "Tu n'as pas la permission de refuser.", flags: EPHEMERAL });
  }
  const [, requesterId, bhId] = interaction.customId.split(":");
  const modal = new ModalBuilder()
    .setCustomId(`rm:${requesterId}:${bhId}:${interaction.channelId}:${interaction.message.id}`)
    .setTitle("Refuser la demande")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("raison")
          .setLabel("Raison (envoyée au membre)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200),
      ),
    );
  return interaction.showModal(modal);
}


async function concludeReview(interaction, conclusion) {
  const original = interaction.message?.embeds?.[0];
  const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder();
  embed.addFields({ name: "Résultat", value: conclusion });
  const res = await interaction.editReply({ embeds: [embed], components: [] });
  // Si la validation s'est faite dans un fil de preuve, on le verrouille et l'archive.
  const ch = interaction.channel;
  if (ch?.isThread?.()) {
    ch.setLocked(true).catch(() => {});
    ch.setArchived(true).catch(() => {});
  }
  return res;
}

// ---------- /forcelink (admin) ----------

export async function handleForcelink(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  const pseudo = interaction.options.getString("pseudo", true).trim();
  await interaction.deferReply({ flags: EPHEMERAL });

  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    return interaction.editReply(`Erreur : ${err.message}`);
  }
  if (players.length === 0) return interaction.editReply(`Aucun joueur classé pour **${pseudo}**.`);

  const row = new ActionRowBuilder().addComponents(
    players.map((p) => {
      const btn = new ButtonBuilder()
        .setCustomId(`fl:${target.id}:${p.id}`)
        .setLabel(`${p.username} — ${p.tier ?? "?"} (${p.region}, ${p.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
      const emoji = tierEmojiResolvable(p.tier ? String(p.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `Choisis le compte à lier à <@${target.id}> :`,
    components: [row],
  });
}

export async function handleForceLinkPick(interaction, ctx) {
  if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  const [, targetId, bhId] = interaction.customId.split(":");
  const brawlhallaId = Number(bhId);
  await interaction.deferUpdate();

  const owner = await findUserByBrawlhallaId(brawlhallaId);
  if (owner && owner !== targetId) {
    return interaction.editReply({
      content: `Ce compte est déjà lié par <@${owner}>. Fais d'abord /unlink sur lui.`,
      components: [],
    });
  }
  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) return interaction.editReply({ content: "Membre introuvable.", components: [] });

  try {
    const result = await doSync(member, brawlhallaId, ctx);
    await logAudit(interaction.guild, `🔧 <@${interaction.user.id}> a force-lié <@${targetId}> (${tierSummary(result.tiers)}).`);
    return interaction.editReply({
      content: `<@${targetId}> lié ! ${tierSummary(result.tiers)}.`,
      components: [],
    });
  } catch (err) {
    return interaction.editReply({ content: `Échec : ${err.message}`, components: [] });
  }
}

// ---------- /unlink (admin) ----------

export async function handleUnlink(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  await interaction.deferReply({ flags: EPHEMERAL });
  const existed = await removeLink(target.id);
  if (!existed) return interaction.editReply(`<@${target.id}> n'avait aucune liaison.`);

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (member) {
    const managed = managedRoleNames();
    const toRemove = member.roles.cache.filter((r) => managed.has(r.name));
    if (toRemove.size) await member.roles.remove([...toRemove.values()], "Unlink admin");
  }
  await logAudit(interaction.guild, `🗑️ <@${interaction.user.id}> a délié <@${target.id}>.`);
  return interaction.editReply(`Liaison de <@${target.id}> supprimée.`);
}

// ---------- /whois ----------

export async function handleWhois(interaction, ctx) {
  const target = interaction.options.getUser("membre", true);
  await interaction.deferReply({ flags: EPHEMERAL });
  const link = await getLink(target.id);
  if (!link) return interaction.editReply(`<@${target.id}> n'a aucun compte lié.`);

  let live = "";
  try {
    const data = await getPlayerProfile(link.brawlhallaId);
    live = `\nEn direct : ${tierSummary(data.tiers)}`;
  } catch {
    /* ignore */
  }
  return interaction.editReply(
    `<@${target.id}> → **${link.name}** (ID \`${link.brawlhallaId}\`)\n` +
      `Dernier enregistré : ${tierSummary(link.tiers)}${live}`,
  );
}


// ---------- /delier ----------

export async function handleDelier(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const existed = await removeLink(interaction.user.id);
  if (!existed) return interaction.editReply("Tu n'avais aucun compte lié.");

  const managed = managedRoleNames();
  const toRemove = interaction.member.roles.cache.filter((r) => managed.has(r.name));
  if (toRemove.size) await interaction.member.roles.remove([...toRemove.values()], "Déliaison Brawlhalla");
  return interaction.editReply("Compte délié et rôles de rank retirés.");
}
