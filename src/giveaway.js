import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from "discord.js";
import { loadDoc, saveDoc } from "./db.js";
import { parseColor } from "./tickets.js";
import {
  createGiveawayRow,
  setGiveawayMessage,
  getGiveaway,
  markGiveawayEnded,
  setGiveawayStatus,
  listDueGiveaways,
  listEntries,
  countEntries,
  addEntry,
  removeEntry,
} from "./giveawayStore.js";

// ====================================================================
// Système de giveaways (concours) — Components V2.
//
// Cycle de vie d'un concours :
//   1. Création (slash /giveaway ou dashboard web) → message V2 publié avec un bouton
//      « Participer ». L'enregistrement est persisté en SQLite (giveawayStore).
//   2. Les membres cliquent le bouton → une participation est enregistrée (toggle :
//      recliquer retire la participation). Le rôle requis est vérifié si défini.
//   3. À l'échéance (tick périodique dans index.js) OU manuellement, le bot tire N
//      gagnants au hasard, édite le message et annonce les gagnants (mention + MP).
//   4. Reroll possible : retire un nouveau gagnant parmi les participants.
//
// La config (apparence + réglages par défaut) est éditable depuis le dashboard web.
// ====================================================================

const KEY = "giveaway";

const DEFAULT_CONFIG = {
  enabled: false,
  // Salon par défaut où publier un giveaway créé depuis le dashboard.
  defaultChannelId: "",
  // Rôle autorisé à gérer les giveaways en plus des admins (optionnel, infos seulement).
  hostRoleId: "",
  // Rôle pingé à la publication d'un giveaway (optionnel).
  pingRoleId: "",
  // Rôle requis par défaut pour participer (optionnel ; surchargé à la création).
  requiredRoleId: "",
  // Apparence de l'embed.
  embedTitle: "GIVEAWAY",
  embedColor: "#f1c40f",
  bannerUrl: "",
  buttonLabel: "Participer",
  buttonEmoji: "🎉",
  footerText: "Bonne chance à toutes et à tous ! 🍀",
  // Envoie un MP aux gagnants à la clôture.
  dmWinners: true,
  // Valeurs par défaut proposées dans le formulaire de création.
  defaultDuration: "24h",
  defaultWinners: 1,
};

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, { guilds: {} });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function doWrite() {
  saveDoc(KEY, cache);
}

function save() {
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

async function getGuild(guildId) {
  const c = await load();
  const g = { ...DEFAULT_CONFIG, ...(c.guilds[guildId] || {}) };
  c.guilds[guildId] = g;
  return g;
}

/** Config du système de giveaways pour un serveur (fusionnée avec les défauts). */
export async function getGiveawayConfig(guildId) {
  return getGuild(guildId);
}

/** Met à jour la config (patch partiel) et persiste. */
export async function setGiveawayConfig(guildId, patch) {
  const g = await getGuild(guildId);
  Object.assign(g, patch || {});
  await save();
  return getGiveawayConfig(guildId);
}

// ====================================================================
// Utilitaires
// ====================================================================

/**
 * Convertit une durée lisible en millisecondes. Accepte une combinaison d'unités :
 * "30s", "10m", "2h", "3d", "1w", ou composé "1d12h". Renvoie 0 si invalide.
 */
export function parseDuration(input) {
  if (typeof input === "number") return input > 0 ? input : 0;
  if (!input || typeof input !== "string") return 0;
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  let total = 0;
  let matched = false;
  const re = /(\d+)\s*(w|d|h|m|s)/gi;
  let m;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    total += parseInt(m[1], 10) * units[m[2].toLowerCase()];
  }
  // Repli : un nombre nu = minutes.
  if (!matched) {
    const n = parseInt(input, 10);
    if (Number.isFinite(n) && n > 0) return n * 60_000;
    return 0;
  }
  return total;
}

/** Durée (ms) en texte court FR : "1 j 2 h 30 min". */
export function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const mn = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const parts = [];
  if (d) parts.push(`${d} j`);
  if (h) parts.push(`${h} h`);
  if (mn) parts.push(`${mn} min`);
  if (!d && !h && s) parts.push(`${s} s`);
  return parts.join(" ") || "0 min";
}

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

// Tire `count` gagnants au hasard parmi `entries` (sans doublon), en excluant `exclude`.
// Mélange de Fisher-Yates sur une copie.
export function drawWinners(entries, count, exclude = []) {
  const pool = entries.filter((id) => !exclude.includes(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}

// ====================================================================
// Construction des messages (Components V2)
// ====================================================================

/** Message V2 d'un giveaway ACTIF (avec bouton « Participer »). */
export function buildGiveawayPayload(gw, cfg) {
  const color = parseColor(cfg.embedColor || "#f1c40f");
  const container = new ContainerBuilder().setAccentColor(color);

  if (cfg.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(cfg.bannerUrl)),
    );
  }

  const endsSec = Math.floor(gw.ends_ts / 1000);
  const count = countEntries(gw.id);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎉 ${(cfg.embedTitle || "GIVEAWAY").toUpperCase()} 🎉\n### 🏆 ${gw.prize}`.slice(0, 4000),
    ),
  );

  if (gw.description && gw.description.trim()) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(gw.description.trim().slice(0, 2000)));
  }

  container.addSeparatorComponents(divider());

  const lines = [
    `🎁 **Récompense :** ${gw.prize}`,
    `🏅 **Gagnant(s) :** ${gw.winners_count}`,
    `🎟️ **Participants :** ${count}`,
    `⏳ **Fin :** <t:${endsSec}:R> · <t:${endsSec}:f>`,
    `👤 **Organisé par :** <@${gw.host_id}>`,
  ];
  if (gw.required_role_id) lines.push(`🔒 **Rôle requis :** <@&${gw.required_role_id}>`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n").slice(0, 4000)));

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${cfg.footerText || "Bonne chance ! 🍀"} • Clique le bouton pour participer.`),
  );

  const button = new ButtonBuilder()
    .setCustomId(`gw_enter:${gw.id}`)
    .setLabel(`${cfg.buttonLabel || "Participer"} (${count})`)
    .setStyle(ButtonStyle.Success);
  const emoji = resolveEmoji(cfg.buttonEmoji);
  if (emoji) button.setEmoji(emoji);

  container.addSeparatorComponents(divider());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** Message V2 d'un giveaway TERMINÉ (gagnants affichés, bouton désactivé). */
export function buildEndedPayload(gw, cfg, winnerIds) {
  const color = parseColor(cfg.embedColor || "#f1c40f");
  const container = new ContainerBuilder().setAccentColor(color);

  if (cfg.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(cfg.bannerUrl)),
    );
  }

  const endedSec = Math.floor(Date.now() / 1000);
  const count = countEntries(gw.id);
  const cancelled = gw.status === "cancelled";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎉 ${(cfg.embedTitle || "GIVEAWAY").toUpperCase()} — ${cancelled ? "ANNULÉ" : "TERMINÉ"}\n### 🏆 ${gw.prize}`.slice(0, 4000),
    ),
  );

  container.addSeparatorComponents(divider());

  let resultText;
  if (cancelled) {
    resultText = "🚫 Ce giveaway a été **annulé**. Aucun gagnant n'a été tiré.";
  } else if (winnerIds && winnerIds.length) {
    resultText = `🥳 **Gagnant(s) :** ${winnerIds.map((id) => `<@${id}>`).join(", ")}`;
  } else {
    resultText = "😢 Aucun participant valide — pas de gagnant cette fois-ci.";
  }

  const lines = [
    resultText,
    `🎟️ **Participants :** ${count}`,
    `⏱️ **Clôturé :** <t:${endedSec}:f>`,
    `👤 **Organisé par :** <@${gw.host_id}>`,
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n").slice(0, 4000)));

  const button = new ButtonBuilder()
    .setCustomId(`gw_ended:${gw.id}`)
    .setLabel(cancelled ? "Giveaway annulé" : "Giveaway terminé")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  container.addSeparatorComponents(divider());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// Résout un emoji de bouton : custom (<:name:id> / <a:name:id>) ou unicode court.
function resolveEmoji(e) {
  if (!e) return undefined;
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(e);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  if ([...e].length <= 4) return e;
  return undefined;
}

// ====================================================================
// Opérations (création, participation, clôture, reroll, annulation)
// ====================================================================

/**
 * Crée un giveaway et publie son message V2 dans le salon.
 * Renvoie { ok, error?, giveaway?, message? }.
 */
export async function createGiveaway(client, {
  guildId,
  channelId,
  prize,
  description = "",
  durationMs,
  winnersCount = 1,
  requiredRoleId = null,
  hostId,
}) {
  if (!prize || !String(prize).trim()) return { ok: false, error: "Précise une récompense." };
  if (!durationMs || durationMs < 10_000) return { ok: false, error: "Durée invalide (minimum 10 secondes)." };
  if (!channelId) return { ok: false, error: "Choisis un salon." };

  const cfg = await getGiveawayConfig(guildId);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, error: "Salon introuvable ou non textuel." };

  const gw = createGiveawayRow({
    guildId,
    channelId,
    prize: String(prize).trim(),
    description: String(description || "").trim(),
    winnersCount,
    requiredRoleId: requiredRoleId || null,
    hostId,
    imageUrl: cfg.bannerUrl || "",
    endsTs: Date.now() + durationMs,
  });

  const payload = buildGiveawayPayload(gw, cfg);

  let message;
  try {
    if (cfg.pingRoleId) {
      // En V2 le champ `content` est interdit : on poste le ping séparément.
      await channel.send({ content: `<@&${cfg.pingRoleId}>`, allowedMentions: { roles: [cfg.pingRoleId] } }).catch(() => null);
    }
    message = await channel.send(payload);
  } catch (err) {
    setGiveawayStatus(gw.id, "cancelled");
    return { ok: false, error: `Envoi impossible : ${err.message}` };
  }

  setGiveawayMessage(gw.id, message.id);
  gw.message_id = message.id;
  return { ok: true, giveaway: gw, message };
}

/** Édite (rafraîchit) le message d'un giveaway actif. Best-effort. */
export async function refreshGiveawayMessage(client, gw, cfg) {
  if (!gw.message_id) return;
  try {
    const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const msg = await channel.messages.fetch(gw.message_id).catch(() => null);
    if (msg) await msg.edit(buildGiveawayPayload(gw, cfg));
  } catch {
    /* best-effort */
  }
}

/**
 * Clôture un giveaway : tire les gagnants, édite le message, annonce.
 * Renvoie { ok, error?, winners? }.
 */
export async function endGiveaway(client, id, { announce = true } = {}) {
  const gw = getGiveaway(id);
  if (!gw) return { ok: false, error: "Giveaway introuvable." };
  if (gw.status !== "active") return { ok: false, error: "Ce giveaway n'est plus actif." };

  const cfg = await getGiveawayConfig(gw.guild_id);
  const entries = listEntries(id);
  const winners = drawWinners(entries, gw.winners_count);

  markGiveawayEnded(id, winners);
  gw.status = "ended";
  gw.winnerIds = winners;

  await updateMessageToEnded(client, gw, cfg, winners);
  if (announce) await announceWinners(client, gw, cfg, winners);

  return { ok: true, winners };
}

/**
 * Reroll : retire de nouveaux gagnants (en excluant les précédents) et les annonce.
 * Renvoie { ok, error?, winners? }.
 */
export async function rerollGiveaway(client, id, count) {
  const gw = getGiveaway(id);
  if (!gw) return { ok: false, error: "Giveaway introuvable." };
  if (gw.status !== "ended") return { ok: false, error: "Tu ne peux reroll qu'un giveaway terminé." };

  const cfg = await getGiveawayConfig(gw.guild_id);
  const entries = listEntries(id);
  const previous = gw.winnerIds || [];
  const n = count || gw.winners_count;
  const fresh = drawWinners(entries, n, previous);
  if (!fresh.length) return { ok: false, error: "Aucun autre participant disponible pour un reroll." };

  // On conserve l'historique : nouveaux gagnants ajoutés à la liste mémorisée.
  const all = [...previous, ...fresh];
  markGiveawayEnded(id, all);

  const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel
      .send({
        content: `🔁 **Reroll !** Nouveau(x) gagnant(s) pour **${gw.prize}** : ${fresh.map((w) => `<@${w}>`).join(", ")} 🎉`,
        allowedMentions: { users: fresh },
      })
      .catch(() => null);
  }
  if (cfg.dmWinners) await dmWinners(client, gw, fresh);
  return { ok: true, winners: fresh };
}

/** Annule un giveaway actif (aucun tirage), édite le message. */
export async function cancelGiveaway(client, id) {
  const gw = getGiveaway(id);
  if (!gw) return { ok: false, error: "Giveaway introuvable." };
  if (gw.status !== "active") return { ok: false, error: "Ce giveaway n'est plus actif." };

  const cfg = await getGiveawayConfig(gw.guild_id);
  setGiveawayStatus(id, "cancelled");
  gw.status = "cancelled";
  await updateMessageToEnded(client, gw, cfg, []);
  return { ok: true };
}

/** Tick périodique : clôture tous les giveaways dont l'échéance est dépassée. */
export async function endDueGiveaways(client) {
  const due = listDueGiveaways();
  let ended = 0;
  for (const gw of due) {
    try {
      await endGiveaway(client, gw.id);
      ended++;
    } catch (err) {
      console.warn(`Clôture giveaway #${gw.id} échouée : ${err.message}`);
    }
  }
  return { ended };
}

// ---------- Participation (clic bouton) ----------

/**
 * Gère un clic sur le bouton « Participer » (toggle).
 * Renvoie { ok, joined?, error?, gw? } ; le message est rafraîchi par l'appelant.
 */
export async function toggleEntry(interaction, id) {
  const gw = getGiveaway(id);
  if (!gw || gw.status !== "active") {
    return { ok: false, error: "Ce giveaway est terminé." };
  }
  // Vérifie le rôle requis si défini.
  if (gw.required_role_id) {
    const member = interaction.member;
    const has = member?.roles?.cache?.has(gw.required_role_id);
    if (!has) {
      return { ok: false, error: `Tu dois avoir le rôle <@&${gw.required_role_id}> pour participer.` };
    }
  }
  const userId = interaction.user.id;
  if (addEntry(id, userId)) {
    return { ok: true, joined: true, gw };
  }
  // Déjà inscrit → on retire (toggle).
  removeEntry(id, userId);
  return { ok: true, joined: false, gw };
}

// ====================================================================
// Helpers internes d'annonce / édition
// ====================================================================

async function updateMessageToEnded(client, gw, cfg, winners) {
  if (!gw.message_id) return;
  try {
    const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const msg = await channel.messages.fetch(gw.message_id).catch(() => null);
    if (msg) await msg.edit(buildEndedPayload(gw, cfg, winners));
  } catch {
    /* best-effort */
  }
}

async function announceWinners(client, gw, cfg, winners) {
  const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
  if (channel?.isTextBased?.()) {
    let text;
    if (winners.length) {
      text = `🎉 Félicitations ${winners.map((w) => `<@${w}>`).join(", ")} ! Vous remportez **${gw.prize}** 🏆`;
    } else {
      text = `😢 Le giveaway **${gw.prize}** se termine sans participant. Aucun gagnant.`;
    }
    const replyOpts = { content: text, allowedMentions: { users: winners } };
    if (gw.message_id) replyOpts.reply = { messageReference: gw.message_id, failIfNotExists: false };
    await channel.send(replyOpts).catch(() => null);
  }
  if (cfg.dmWinners) await dmWinners(client, gw, winners);
}

async function dmWinners(client, gw, winners) {
  for (const userId of winners) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(`🎉 Tu as gagné **${gw.prize}** dans le giveaway ! Rapproche-toi du staff pour récupérer ta récompense.`);
    } catch {
      /* MP fermés : on ignore */
    }
  }
}
