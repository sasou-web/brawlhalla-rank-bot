import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  AttachmentBuilder,
  PermissionFlagsBits,
} from "discord.js";
import {
  getUserStats, getLeaderboard, getLevelConfig, setLevelConfig, setReward,
  setUserLevel, addUserXp, resetLevels, rewardRolePlan,
} from "../levels.js";
import { renderLevelCard } from "../levelCard.js";
import { EPHEMERAL, logAudit } from "./shared.js";
import { enforceCooldown } from "./cooldowns.js";

// ---------- Systeme de niveaux ----------

// Petite barre de progression textuelle (ex: ████░░░░░░).
function progressBar(current, total, size = 12) {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}

export async function handleNiveau(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "niveau", 4000))) return;
  await interaction.deferReply();
  const targetUser = interaction.options.getUser("membre") ?? interaction.user;
  if (targetUser.bot) return interaction.editReply("Les bots ne gagnent pas d'XP. 🤖");

  const s = await getUserStats(interaction.guild.id, targetUser.id);
  if (s.xp === 0) {
    return interaction.editReply(
      targetUser.id === interaction.user.id
        ? "Tu n'as pas encore d'XP. Discute sur le serveur pour en gagner !"
        : `<@${targetUser.id}> n'a pas encore d'XP.`,
    );
  }

  // Carte image (façon MEE6/Arcane). Repli sur un embed si le rendu échoue.
  try {
    let avatarBuffer = null;
    try {
      const res = await fetch(targetUser.displayAvatarURL({ extension: "png", size: 256 }));
      if (res.ok) avatarBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      /* sans avatar */
    }
    const buffer = await renderLevelCard({
      displayName: targetUser.username,
      avatarBuffer,
      level: s.level,
      rank: s.rank,
      totalMembers: s.totalMembers,
      xp: s.xp,
      xpIntoLevel: s.xpIntoLevel,
      xpForNext: s.xpForNext,
      messages: s.messages,
    });
    const file = new AttachmentBuilder(buffer, { name: "niveau.png" });
    return interaction.editReply({ files: [file] });
  } catch {
    const bar = progressBar(s.xpIntoLevel, s.xpForNext);
    const embed = new EmbedBuilder()
      .setTitle(`Niveau — ${targetUser.username}`)
      .setColor(0x5865f2)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: "Niveau", value: `**${s.level}**`, inline: true },
        { name: "Rang serveur", value: s.rank ? `#${s.rank} / ${s.totalMembers}` : "—", inline: true },
        { name: "Messages", value: `${s.messages}`, inline: true },
        { name: "XP totale", value: `${s.xp}`, inline: true },
        { name: "Progression", value: `${bar}\n${s.xpIntoLevel} / ${s.xpForNext} XP avant le niveau ${s.level + 1}`, inline: false },
      );
    return interaction.editReply({ embeds: [embed] });
  }
}

export async function handleClassementNiveaux(interaction, ctx) {
  await interaction.deferReply();
  const top = await getLeaderboard(interaction.guild.id, 10);
  if (!top.length) return interaction.editReply("Personne n'a encore gagné d'XP sur le serveur.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((e, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    return `${place} <@${e.id}> — Niveau **${e.level}** (${e.xp} XP)`;
  });
  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement des niveaux")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /leaderboard-xp : classement XP complet pagine ----------

const XP_LB_PER_PAGE = 10;

async function buildXpLeaderboardPage(guild, page) {
  const all = await getLeaderboard(guild.id, Number.MAX_SAFE_INTEGER);
  const totalPages = Math.max(1, Math.ceil(all.length / XP_LB_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = all.slice(p * XP_LB_PER_PAGE, p * XP_LB_PER_PAGE + XP_LB_PER_PAGE);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = slice.map((e, i) => {
    const rank = p * XP_LB_PER_PAGE + i;
    const place = rank < 3 ? medals[rank] : `**${rank + 1}.**`;
    return `${place} <@${e.id}> — Niveau **${e.level}** · ${e.xp.toLocaleString("fr-FR")} XP`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement XP du serveur")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n") || "Personne n'a encore d'XP.")
    .setFooter({ text: `Page ${p + 1}/${totalPages} • ${all.length} membre(s) classé(s)` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`xplb:${p - 1}`).setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(`xplb:${p + 1}`).setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
  );

  return { embeds: [embed], components: all.length > XP_LB_PER_PAGE ? [row] : [] };
}

export async function handleLeaderboardXp(interaction, ctx) {
  await interaction.deferReply();
  const page = await buildXpLeaderboardPage(interaction.guild, 0);
  return interaction.editReply(page);
}

export async function handleLeaderboardXpPage(interaction, ctx) {
  const page = Number(interaction.customId.split(":")[1]) || 0;
  const built = await buildXpLeaderboardPage(interaction.guild, page);
  return interaction.update(built);
}

export async function handleNiveauxConfig(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const patch = {};
  const active = interaction.options.getBoolean("active");
  const salon = interaction.options.getChannel("salon-annonce");
  const cooldown = interaction.options.getInteger("cooldown");
  const xpMin = interaction.options.getInteger("xp-min");
  const xpMax = interaction.options.getInteger("xp-max");
  const voiceActive = interaction.options.getBoolean("vocal-actif");
  const voiceXp = interaction.options.getInteger("vocal-xp");
  const annonce = interaction.options.getString("annonce");
  const cumul = interaction.options.getBoolean("cumul-roles");

  if (active !== null) patch.enabled = active;
  if (salon) {
    patch.announceChannelId = salon.id;
    patch.announceMode = "channel";
  }
  if (cooldown !== null) patch.cooldownSec = cooldown;
  if (xpMin !== null) patch.minXp = xpMin;
  if (xpMax !== null) patch.maxXp = xpMax;
  if (voiceActive !== null) patch.voiceEnabled = voiceActive;
  if (voiceXp !== null) patch.voiceXpPerMin = voiceXp;
  if (annonce !== null) patch.announceMode = annonce;
  if (cumul !== null) patch.stackRewards = cumul;

  const cfg = Object.keys(patch).length ? await setLevelConfig(interaction.guild.id, patch) : await getLevelConfig(interaction.guild.id);

  const rewards = Object.entries(cfg.rewards ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([lvl, roleId]) => `• Niveau ${lvl} → <@&${roleId}>`)
    .join("\n") || "*(aucune)*";

  const annonceTxt =
    cfg.announceMode === "off"
      ? "désactivée"
      : cfg.announceMode === "dm"
        ? "message privé"
        : cfg.announceChannelId
          ? `salon <#${cfg.announceChannelId}>`
          : "salon courant";

  return interaction.editReply(
    "**Config des niveaux**\n" +
      `• Activé : **${cfg.enabled ? "oui" : "non"}**\n` +
      `• Annonces : **${annonceTxt}**\n` +
      `• Cooldown : **${cfg.cooldownSec}s**\n` +
      `• XP par message : **${cfg.minXp}–${cfg.maxXp}**\n` +
      `• XP vocal : **${cfg.voiceEnabled ? "oui" : "non"}** (${cfg.voiceXpPerMin} XP/min)\n` +
      `• Cumul des rôles de palier : **${cfg.stackRewards ? "oui" : "seulement le plus haut"}**\n` +
      `• Récompenses :\n${rewards}`,
  );
}

export async function handleNiveauxRecompense(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const niveau = interaction.options.getInteger("niveau", true);
  const role = interaction.options.getRole("role");

  if (role) {
    const me = interaction.guild.members.me;
    if (me && role.position >= me.roles.highest.position) {
      return interaction.editReply(
        `Je ne peux pas attribuer <@&${role.id}> : ce rôle est au-dessus du mien. Place mon rôle plus haut dans la hiérarchie.`,
      );
    }
  }

  await setReward(interaction.guild.id, niveau, role?.id ?? null);
  return interaction.editReply(
    role
      ? `Récompense définie : niveau **${niveau}** → <@&${role.id}> ✅`
      : `Récompense du niveau **${niveau}** supprimée. ✅`,
  );
}

export async function handleNiveauxSet(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const target = interaction.options.getUser("membre", true);
  if (target.bot) return interaction.editReply("Les bots ne gagnent pas d'XP.");

  const niveau = interaction.options.getInteger("niveau");
  const xp = interaction.options.getInteger("xp");
  if (niveau === null && xp === null) {
    return interaction.editReply("Précise `niveau` (valeur exacte) ou `xp` (à ajouter/retirer).");
  }

  let stats;
  if (niveau !== null) stats = await setUserLevel(interaction.guild.id, target.id, niveau);
  if (xp !== null) stats = await addUserXp(interaction.guild.id, target.id, xp);

  // Applique les roles de recompense correspondant au nouveau niveau (ajout + retrait).
  try {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) await applyRewardRolesForMember(member, stats.level);
  } catch {
    /* best-effort */
  }

  await logAudit(interaction.guild, `📈 <@${interaction.user.id}> a modifié l'XP de <@${target.id}> → niveau ${stats.level} (${stats.xp} XP).`);
  return interaction.editReply(`<@${target.id}> est maintenant **niveau ${stats.level}** (${stats.xp} XP). ✅`);
}

// Aligne les roles de recompense d'un membre sur son niveau (ajoute ceux manquants,
// retire ceux qu'il ne devrait plus avoir). Renvoie true si un changement a eu lieu.
async function applyRewardRolesForMember(member, level) {
  const { desired, all } = await rewardRolePlan(member.guild.id, level);
  const desiredSet = new Set(desired);
  const toAdd = desired.filter((id) => id && !member.roles.cache.has(id));
  const toRemove = all.filter((id) => id && !desiredSet.has(id) && member.roles.cache.has(id));
  if (toAdd.length) await member.roles.add(toAdd, "Resync récompense de niveau").catch(() => {});
  if (toRemove.length) await member.roles.remove(toRemove, "Resync récompense de niveau").catch(() => {});
  return toAdd.length > 0 || toRemove.length > 0;
}

export async function handleNiveauxReset(interaction, ctx) {
  const target = interaction.options.getUser("membre");
  if (target) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const existed = await resetLevels(interaction.guild.id, target.id);
    await logAudit(interaction.guild, `🧹 <@${interaction.user.id}> a reset l'XP de <@${target.id}>.`);
    return interaction.editReply(existed ? `XP de <@${target.id}> remise à zéro. ✅` : `<@${target.id}> n'avait pas d'XP.`);
  }

  // Reset global : confirmation par bouton.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("levels_reset_all").setLabel("Confirmer le reset total").setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    content: "⚠️ Cela va **remettre à zéro l'XP de tous les membres** du serveur. Action irréversible. Confirmer ?",
    components: [row],
    flags: EPHEMERAL,
  });
}

export async function handleLevelsResetAllConfirm(interaction, ctx) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Réservé aux admins.", flags: EPHEMERAL });
  }
  await interaction.deferUpdate();
  await resetLevels(interaction.guild.id, null);
  await logAudit(interaction.guild, `🧹 <@${interaction.user.id}> a reset l'XP de tout le serveur.`);
  return interaction.editReply({ content: "XP de tous les membres remise à zéro. ✅", components: [] });
}

export async function handleNiveauxResync(interaction, ctx) {
  const target = interaction.options.getUser("membre");
  await interaction.deferReply({ flags: EPHEMERAL });

  if (target) {
    if (target.bot) return interaction.editReply("Les bots n'ont pas de rôles de niveau.");
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply("Membre introuvable sur le serveur.");
    const s = await getUserStats(interaction.guild.id, target.id);
    const changed = await applyRewardRolesForMember(member, s.level);
    return interaction.editReply(
      changed
        ? `Rôles de <@${target.id}> réalignés sur le niveau ${s.level}. ✅`
        : `Aucun changement : <@${target.id}> a déjà les bons rôles.`,
    );
  }

  // Resync global : tous les membres ayant de l'XP.
  const r = await resyncAllRewards(interaction.guild, (n) =>
    interaction.editReply(`Resync de ${n} membre(s) en cours… (cela peut prendre un moment)`),
  );
  if (r.total === 0) return interaction.editReply("Aucun membre avec de l'XP à resync.");
  await logAudit(interaction.guild, `🔁 <@${interaction.user.id}> a resync les niveaux (${r.changed} membre(s) mis a jour).`);
  return interaction.editReply(`Resync terminé : **${r.changed}** membre(s) mis à jour, ${r.skipped} absent(s) du serveur.`);
}

// Réaligne les rôles de récompense de tous les membres ayant de l'XP sur leur niveau.
// onStart(total) est appelé une fois le nombre connu (pour informer l'admin).
async function resyncAllRewards(guild, onStart) {
  const all = await getLeaderboard(guild.id, Number.MAX_SAFE_INTEGER);
  if (!all.length) return { total: 0, changed: 0, skipped: 0 };
  if (onStart) await onStart(all.length).catch(() => {});

  // Pre-charge le cache des membres pour eviter un fetch reseau par membre.
  await guild.members.fetch().catch(() => {});

  let changed = 0;
  let skipped = 0;
  for (const e of all) {
    const member = guild.members.cache.get(e.id);
    if (!member) {
      skipped++;
      continue;
    }
    try {
      if (await applyRewardRolesForMember(member, e.level)) changed++;
    } catch {
      /* ignore membre */
    }
  }
  return { total: all.length, changed, skipped };
}

// ====================================================================
// Panneau interactif /setup-levels
// ====================================================================

// Construit l'embed + les composants du panneau a partir de la config actuelle.
async function buildLevelsPanel(guildId) {
  const cfg = await getLevelConfig(guildId);

  const annonceTxt =
    cfg.announceMode === "off"
      ? "🔕 désactivées"
      : cfg.announceMode === "dm"
        ? "📩 en message privé"
        : cfg.announceChannelId
          ? `💬 dans <#${cfg.announceChannelId}>`
          : "💬 dans le salon où le membre écrit";

  const rewardsTxt =
    Object.entries(cfg.rewards ?? {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([lvl, roleId]) => `• Niveau **${lvl}** → <@&${roleId}>`)
      .join("\n") || "*(aucune récompense configurée)*";

  const embed = new EmbedBuilder()
    .setTitle("⚙️ Configuration du système de niveaux")
    .setColor(cfg.enabled ? 0x5865f2 : 0x747f8d)
    .setDescription(
      "Les membres gagnent de l'XP en discutant et en restant en vocal, montent de niveau et débloquent des rôles.\n" +
        "Chaque réglage ci-dessous est **appliqué immédiatement**.\n\u200b",
    )
    .addFields(
      {
        name: "État du système",
        value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé** (aucun gain d'XP)",
        inline: true,
      },
      {
        name: "XP par message",
        value: `**${cfg.minXp}–${cfg.maxXp}** XP\ncooldown **${cfg.cooldownSec}s** entre 2 gains`,
        inline: true,
      },
      {
        name: "XP vocal",
        value: cfg.voiceEnabled
          ? `🟢 **${cfg.voiceXpPerMin}** XP/min\n(pas seul, pas mute, hors AFK)`
          : "🔴 désactivé",
        inline: true,
      },
      { name: "Annonces de montée", value: annonceTxt, inline: true },
      {
        name: "Cumul des rôles",
        value: cfg.stackRewards ? "📚 tous les paliers atteints" : "🥇 seulement le plus haut",
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🎁 Récompenses par niveau", value: rewardsTxt, inline: false },
    )
    .setFooter({ text: "Boutons = activer/désactiver • Menus = salon & mode • ⚙️ valeurs XP • 🎁 récompenses" });

  const rowChannel = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("lvl_announce_channel")
      .setPlaceholder("💬 Salon des annonces de montée de niveau")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const rowMode = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("lvl_announce_mode")
      .setPlaceholder("📣 Où annoncer les montées de niveau ?")
      .addOptions(
        { label: "Dans un salon", value: "channel", description: "Salon dédié ci-dessus, sinon le salon du message", emoji: "💬", default: cfg.announceMode === "channel" },
        { label: "En message privé", value: "dm", description: "Le membre est notifié en MP (zéro spam public)", emoji: "📩", default: cfg.announceMode === "dm" },
        { label: "Désactivées", value: "off", description: "Aucune annonce de montée de niveau", emoji: "🔕", default: cfg.announceMode === "off" },
      ),
  );

  const rowToggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lvl_toggle_enabled")
      .setLabel(cfg.enabled ? "Système : ON" : "Système : OFF")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("lvl_toggle_voice")
      .setLabel(cfg.voiceEnabled ? "XP vocal : ON" : "XP vocal : OFF")
      .setEmoji("🎙️")
      .setStyle(cfg.voiceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("lvl_toggle_stack")
      .setLabel(cfg.stackRewards ? "Cumul rôles : ON" : "Cumul rôles : OFF")
      .setEmoji("📚")
      .setStyle(cfg.stackRewards ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const rowActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lvl_open_xp_modal").setLabel("Valeurs XP").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lvl_open_reward_modal").setLabel("Récompenses").setEmoji("🎁").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("lvl_resync").setLabel("Resync rôles").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowChannel, rowMode, rowToggles, rowActions] };
}

export async function handleSetupLevels(interaction, ctx) {
  const panel = await buildLevelsPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

// Rafraichit le panneau en place apres une modification.
async function refreshLevelsPanel(interaction) {
  const panel = await buildLevelsPanel(interaction.guild.id);
  return interaction.update(panel);
}

// ---------- Boutons du panneau ----------

export async function handleLevelsPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getLevelConfig(interaction.guild.id);

  if (id === "lvl_toggle_enabled") {
    await setLevelConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshLevelsPanel(interaction);
  }
  if (id === "lvl_toggle_voice") {
    await setLevelConfig(interaction.guild.id, { voiceEnabled: !cfg.voiceEnabled });
    return refreshLevelsPanel(interaction);
  }
  if (id === "lvl_toggle_stack") {
    await setLevelConfig(interaction.guild.id, { stackRewards: !cfg.stackRewards });
    return refreshLevelsPanel(interaction);
  }

  if (id === "lvl_open_xp_modal") {
    const modal = new ModalBuilder().setCustomId("lvl_xp_modal").setTitle("Valeurs d'XP").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("xpmin").setLabel("XP min par message").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.minXp)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("xpmax").setLabel("XP max par message").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.maxXp)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("cooldown").setLabel("Cooldown messages (secondes)").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.cooldownSec)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("voicexp").setLabel("XP vocal par minute").setStyle(TextInputStyle.Short).setRequired(false).setValue(String(cfg.voiceXpPerMin)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "lvl_open_reward_modal") {
    const modal = new ModalBuilder().setCustomId("lvl_reward_modal").setTitle("Ajouter / retirer une récompense").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("niveau").setLabel("Niveau (ex: 10)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("10"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("role")
          .setLabel("Rôle : @mention, ID ou nom (vide = retirer)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("@VIP  ou  123456789012345678  ou  VIP"),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "lvl_resync") {
    await interaction.reply({ content: "🔄 Resync en cours…", flags: EPHEMERAL });
    const r = await resyncAllRewards(interaction.guild);
    await logAudit(interaction.guild, `🔁 <@${interaction.user.id}> a resync les niveaux via le panneau (${r.changed} mis à jour).`);
    return interaction.editReply(
      r.total === 0
        ? "Aucun membre avec de l'XP à resync."
        : `Resync terminé : **${r.changed}** membre(s) mis à jour, ${r.skipped} absent(s).`,
    );
  }
}

// ---------- Menus du panneau ----------

export async function handleLevelsPanelSelect(interaction, ctx) {
  if (interaction.customId === "lvl_announce_channel") {
    await setLevelConfig(interaction.guild.id, { announceChannelId: interaction.values[0], announceMode: "channel" });
    return refreshLevelsPanel(interaction);
  }
  if (interaction.customId === "lvl_announce_mode") {
    await setLevelConfig(interaction.guild.id, { announceMode: interaction.values[0] });
    return refreshLevelsPanel(interaction);
  }
}

// ---------- Modals du panneau ----------

function parseRoleInput(guild, input) {
  if (!input) return { role: null, empty: true };
  const idMatch = input.match(/(\d{5,})/); // ID brut ou mention <@&ID>
  if (idMatch) {
    const r = guild.roles.cache.get(idMatch[1]);
    if (r) return { role: r, empty: false };
  }
  const byName = guild.roles.cache.find((r) => r.name.toLowerCase() === input.trim().toLowerCase());
  return { role: byName ?? null, empty: false };
}

export async function handleLevelsPanelModal(interaction, ctx) {
  if (interaction.customId === "lvl_xp_modal") {
    const patch = {};
    const num = (key) => {
      const raw = interaction.fields.getTextInputValue(key)?.trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.floor(n) : null;
    };
    const xpmin = num("xpmin");
    const xpmax = num("xpmax");
    const cooldown = num("cooldown");
    const voicexp = num("voicexp");

    if (xpmin !== null) patch.minXp = Math.max(1, xpmin);
    if (xpmax !== null) patch.maxXp = Math.max(1, xpmax);
    if (cooldown !== null) patch.cooldownSec = Math.max(0, cooldown);
    if (voicexp !== null) patch.voiceXpPerMin = Math.max(0, voicexp);

    // Coherence min <= max.
    if (patch.minXp != null && patch.maxXp != null && patch.minXp > patch.maxXp) {
      const t = patch.minXp;
      patch.minXp = patch.maxXp;
      patch.maxXp = t;
    }

    await setLevelConfig(interaction.guild.id, patch);
    if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
    return interaction.reply({ content: "Valeurs d'XP mises à jour. ✅", flags: EPHEMERAL });
  }

  if (interaction.customId === "lvl_reward_modal") {
    const niveauRaw = interaction.fields.getTextInputValue("niveau")?.trim();
    const roleRaw = interaction.fields.getTextInputValue("role")?.trim();
    const niveau = Number(niveauRaw);

    if (!Number.isInteger(niveau) || niveau < 1) {
      return interaction.reply({ content: "Niveau invalide. Indique un entier ≥ 1.", flags: EPHEMERAL });
    }

    const { role, empty } = parseRoleInput(interaction.guild, roleRaw);

    if (empty) {
      // Retrait de la recompense pour ce niveau.
      await setReward(interaction.guild.id, niveau, null);
      if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
      return interaction.reply({ content: `Récompense du niveau ${niveau} retirée. ✅`, flags: EPHEMERAL });
    }

    if (!role) {
      return interaction.reply({ content: `Rôle introuvable pour « ${roleRaw} ». Donne une @mention, un ID ou le nom exact.`, flags: EPHEMERAL });
    }
    const me = interaction.guild.members.me;
    if (me && role.position >= me.roles.highest.position) {
      return interaction.reply({
        content: `Je ne peux pas attribuer <@&${role.id}> : ce rôle est au-dessus du mien dans la hiérarchie. Place mon rôle plus haut puis réessaie.`,
        flags: EPHEMERAL,
      });
    }

    await setReward(interaction.guild.id, niveau, role.id);
    if (interaction.isFromMessage()) return refreshLevelsPanel(interaction);
    return interaction.reply({ content: `Récompense définie : niveau ${niveau} → <@&${role.id}>. ✅`, flags: EPHEMERAL });
  }
}
