import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, MessageType, SystemChannelFlagsBitField } from "discord.js";
import { getWelcomeConfig, pingRoleId } from "./welcome.js";

/**
 * Alerte staff à l'arrivée : à chaque nouveau membre, le bot prévient un salon staff
 * (ping du rôle choisi, ex. Helpeur) avec un lien direct vers le message de bienvenue
 * de Discord pour ce membre, pour que l'équipe aille lui dire bonjour dans le chat.
 *
 * Anti-spam :
 *  - les bots sont ignorés ;
 *  - les arrivées sont regroupées : la première attend FLUSH_DELAY_MS (le temps que le
 *    message système de Discord existe), puis pendant GROUP_WINDOW_MS les suivantes sont
 *    ajoutées au même message (une modification ne notifie personne) ;
 *  - le rôle n'est notifié qu'une fois par délai (staffPingCooldownMin) ;
 *  - seul ce rôle peut être notifié (allowedMentions), jamais les nouveaux membres.
 *
 *  - un membre déjà signalé dans les REPEAT_WINDOW_MS précédentes (départ puis retour)
 *    ne crée pas de nouvelle alerte.
 *
 * Les liens sont des boutons (« 💬 Dire bienvenue ») : un lien masqué dans le texte
 * peut s'afficher en markdown brut. « 👋 J'y vais » note qui s'en occupe puis lui répond
 * en privé avec ces mêmes boutons (un bouton ne peut pas ouvrir un salon à lui seul).
 * La liste « En route » est relue dans le message : le bouton marche encore après un
 * redémarrage du bot.
 *
 * État en mémoire uniquement (alerte ouverte, dernier ping) : un redémarrage repart de zéro.
 */

export const STAFF_GO_ID = "wstaff_go";
export const FLUSH_DELAY_MS = 6000;
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
export const REPEAT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_LISTED = 10;
// 5 rangées de 5 boutons au plus : 9 liens + « J'y vais ».
const MAX_LINK_BUTTONS = 9;
const MAX_COOLDOWN_MIN = 240;
const HELPERS_PREFIX = "🙋 **En route :**";
const HINT_LINE = "-# Clique sur **👋 J'y vais** pour montrer que tu t'en occupes.";

export function staffPingCooldownMs(cfg) {
  const n = Number(cfg?.staffPingCooldownMin);
  const min = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), MAX_COOLDOWN_MIN) : 10;
  return min * 60 * 1000;
}

export function channelUrl(guildId, channelId) {
  return channelId ? `https://discord.com/channels/${guildId}/${channelId}` : "";
}

function helpersLine(helpers) {
  return helpers.length ? `${HELPERS_PREFIX} ${helpers.slice(0, 15).map((id) => `<@${id}>`).join(", ")}` : HINT_LINE;
}

function memberLine(m) {
  return m.left ? `➜ ~~<@${m.id}>~~ est déjà reparti 💨` : `➜ <@${m.id}>`;
}

function buttonLabel(text) {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** Boutons lien vers le message de bienvenue de chaque membre encore présent. */
export function welcomeLinkButtons(members) {
  const linked = members.filter((m) => !m.left && /^https:\/\/\S+$/.test(m.url || ""));
  return linked.slice(0, MAX_LINK_BUTTONS).map((m) =>
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(m.url)
      .setEmoji("💬")
      .setLabel(buttonLabel(linked.length > 1 ? `Bienvenue ${m.name || "membre"}` : "Dire bienvenue")),
  );
}

function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length; i += 5) out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return out;
}

/**
 * Message staff. alert : { roleId, members: [{ id, url, left }], helpers: [userId] }.
 * `notifyRole` : le rôle reçoit une notification (sinon il s'affiche sans notifier).
 */
export function buildStaffAlertPayload(alert, { notifyRole = false, test = false } = {}) {
  const { roleId = "", members = [], helpers = [] } = alert;
  const n = members.length;
  const head = n > 1 ? `🚨 **${n} nouveaux membres !** Allez leur dire **bienvenue** 👋` : "🚨 **Nouveau membre !** Allez lui dire **bienvenue** 👋";
  const lines = [];
  if (test) lines.push("-# 🧪 Test : personne n'est notifié.");
  lines.push(roleId ? `<@&${roleId}> ${head}` : head);
  for (const m of members.slice(0, MAX_LISTED)) lines.push(memberLine(m));
  if (n > MAX_LISTED) lines.push(`-# … et **${n - MAX_LISTED}** de plus`);
  lines.push(helpersLine(helpers));
  const go = new ButtonBuilder().setCustomId(STAFF_GO_ID).setStyle(ButtonStyle.Primary).setEmoji("👋").setLabel("J'y vais");
  return {
    content: lines.join("\n").slice(0, 2000),
    components: rows([...welcomeLinkButtons(members), go]),
    allowedMentions: { parse: [], roles: notifyRole && roleId && !test ? [roleId] : [] },
  };
}

/** Membres « en route » lus dans le texte d'une alerte. */
export function parseHelpers(content) {
  const line = String(content || "")
    .split("\n")
    .find((l) => l.startsWith(HELPERS_PREFIX));
  return line ? [...line.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]) : [];
}

/** Ajoute ou retire `userId` des membres en route. Renvoie la liste à jour. */
export function toggleHelper(helpers, userId) {
  return helpers.includes(userId) ? helpers.filter((id) => id !== userId) : [...helpers, userId];
}

/** Remplace la ligne « En route » (ou l'indication) d'un texte d'alerte. */
export function withHelpers(content, helpers) {
  const lines = String(content || "").split("\n");
  const i = lines.findIndex((l) => l.startsWith(HELPERS_PREFIX) || l === HINT_LINE);
  if (i >= 0) lines[i] = helpersLine(helpers);
  else lines.push(helpersLine(helpers));
  return lines.join("\n").slice(0, 2000);
}

/** Message « X a rejoint le serveur » de Discord pour ce membre, parmi des messages récents. */
export function findJoinMessage(messages, userId) {
  for (const msg of messages?.values?.() || []) {
    if (msg.type === MessageType.UserJoin && msg.author?.id === userId) return msg;
  }
  return null;
}

/**
 * Lien de chaque arrivée : message de bienvenue de Discord (salon système), sinon message
 * d'accueil du bot, sinon le salon de discussion choisi (ou le salon système).
 */
async function resolveLinks(guild, cfg, items) {
  const sysId = guild.systemChannelId || "";
  const flags = guild.systemChannelFlags;
  const joinsHidden = flags?.has?.(SystemChannelFlagsBitField.Flags.SuppressJoinNotifications) === true;
  let recent = null;
  if (sysId && !joinsHidden) {
    const sys = guild.systemChannel || (await guild.channels.fetch(sysId).catch(() => null));
    recent = await sys?.messages?.fetch({ limit: 50 }).catch(() => null);
  }
  const fallback = channelUrl(guild.id, cfg.staffChatChannelId || sysId);
  for (const it of items) it.url = findJoinMessage(recent, it.id)?.url || it.welcomeUrl || fallback;
}

// ----- État par serveur (en mémoire) -----
const states = new Map();

function stateFor(guildId) {
  let st = states.get(guildId);
  if (!st) {
    // alerted : { [memberId]: date de la dernière alerte } (anti départ/retour en boucle).
    st = { pending: [], timer: null, open: null, lastPingAt: 0, alerted: new Map(), chain: Promise.resolve() };
    states.set(guildId, st);
  }
  return st;
}

// Envois et modifications d'un serveur en file : une arrivée et un clic ne s'écrasent pas.
function run(st, fn) {
  const p = st.chain.then(fn, fn);
  st.chain = p.catch(() => {});
  return p;
}

/** Tests : oublie tout l'état. */
export function resetStaffAlerts() {
  for (const st of states.values()) if (st.timer) clearTimeout(st.timer);
  states.clear();
}

/** Nouveau membre : mis en attente puis signalé au staff (regroupé avec les arrivées proches). */
export async function queueStaffAlert(member, { welcomeUrl = "", delayMs = FLUSH_DELAY_MS } = {}) {
  if (member.user?.bot) return;
  const cfg = await getWelcomeConfig(member.guild.id);
  if (!cfg.staffEnabled || !cfg.staffChannelId) return;
  const st = stateFor(member.guild.id);
  st.pending = st.pending.filter((p) => p.id !== member.id);
  st.pending.push({ id: member.id, name: member.displayName || member.user?.globalName || member.user?.username || "", welcomeUrl });
  if (st.timer) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    flushStaffAlerts(member.guild).catch((err) => console.warn("Alerte staff :", err.message));
  }, delayMs);
  st.timer.unref?.();
}

/** Publie (ou complète) l'alerte staff avec les arrivées en attente. Renvoie le message. */
export function flushStaffAlerts(guild, { now = Date.now() } = {}) {
  const st = stateFor(guild.id);
  return run(st, async () => {
    const open = st.open;
    const openUsable = open && now - open.createdAt < GROUP_WINDOW_MS;
    for (const [id, at] of st.alerted) if (now - at >= REPEAT_WINDOW_MS) st.alerted.delete(id);
    // Déjà signalé récemment ailleurs que dans l'alerte en cours : pas de nouvelle alerte.
    const items = st.pending.splice(0).filter((it) => !st.alerted.has(it.id) || (openUsable && open.members.some((m) => m.id === it.id)));
    if (!items.length) return null;
    const cfg = await getWelcomeConfig(guild.id);
    if (!cfg.staffEnabled || !cfg.staffChannelId) return null;
    await resolveLinks(guild, cfg, items);
    for (const it of items) st.alerted.set(it.id, now);

    let members = items.map((it) => ({ id: it.id, name: it.name, url: it.url, left: false }));
    if (openUsable && open.channelId === cfg.staffChannelId) {
      for (const m of members) {
        const known = open.members.find((x) => x.id === m.id);
        if (known) Object.assign(known, m);
        else open.members.push(m);
      }
      const edited = await open.message.edit(buildStaffAlertPayload(open)).catch(() => null);
      if (edited) {
        open.message = edited;
        return edited;
      }
      members = open.members; // message supprimé : on republie toute la fenêtre
    }
    st.open = null;

    const ch = await guild.channels.fetch(cfg.staffChannelId).catch(() => null);
    if (!ch?.isTextBased?.()) return null;
    const roleId = pingRoleId(guild, cfg.staffRoleId);
    const notifyRole = Boolean(roleId) && now - st.lastPingAt >= staffPingCooldownMs(cfg);
    const alert = { roleId, members, helpers: [] };
    const message = await ch.send(buildStaffAlertPayload(alert, { notifyRole }));
    if (notifyRole) st.lastPingAt = now;
    st.open = { ...alert, message, channelId: ch.id, createdAt: now };
    return message;
  });
}

/** Membre reparti : retiré de l'attente, barré dans l'alerte en cours. */
export function markStaffAlertLeft(member) {
  const st = states.get(member.guild.id);
  if (!st) return Promise.resolve();
  st.pending = st.pending.filter((p) => p.id !== member.id);
  return run(st, async () => {
    const m = st.open?.members.find((x) => x.id === member.id);
    if (!m || m.left) return;
    m.left = true;
    const edited = await st.open.message.edit(buildStaffAlertPayload(st.open)).catch(() => null);
    if (edited) st.open.message = edited;
  });
}

/** Bouton « 👋 J'y vais » : ajoute ou retire le membre de la liste « En route ». */
export async function handleStaffAlertButton(interaction) {
  await interaction.deferUpdate();
  const st = stateFor(interaction.guildId);
  // Pas d'erreur vers le gestionnaire global : après deferUpdate, il remplacerait le texte
  // de l'alerte par le message d'erreur.
  const result = await run(st, () => toggleOnAlert(st, interaction)).catch((err) => {
    console.warn("Alerte staff (bouton) :", err.message);
    return null;
  });
  await interaction.followUp({ ...goReply(result), flags: MessageFlags.Ephemeral }).catch(() => {});
}

/** Réponse privée au clic : les liens pour aller dire bienvenue, ou l'annulation. */
export function goReply(result) {
  if (!result) return { content: "Impossible de mettre à jour l'alerte, réessaie." };
  if (!result.joined) return { content: "↩️ Tu n'es plus marqué **en route**." };
  const links = result.links.slice(0, MAX_LINK_BUTTONS);
  if (!links.length) return { content: "👋 **C'est noté, tu es en route !** Va lui dire **bienvenue** dans le chat 💬" };
  return {
    content: `👋 **C'est noté, tu es en route !** Clique pour ouvrir ${links.length > 1 ? "leurs messages" : "son message"} de bienvenue 👇`,
    components: rows(links),
  };
}

// Boutons lien d'une alerte déjà publiée (alerte hors mémoire).
function linkButtonsOf(message) {
  const out = [];
  for (const row of message.components || []) {
    for (const c of row.components || []) {
      if (c.url) out.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(c.url).setEmoji("💬").setLabel(buttonLabel(c.label || "Dire bienvenue")));
    }
  }
  return out;
}

async function toggleOnAlert(st, interaction) {
  const userId = interaction.user.id;
  const open = st.open?.message?.id === interaction.message.id ? st.open : null;
  if (open) {
    const helpers = toggleHelper(open.helpers, userId);
    const edited = await interaction.editReply(buildStaffAlertPayload({ ...open, helpers }));
    open.helpers = helpers;
    if (edited) open.message = edited;
    return { joined: helpers.includes(userId), links: welcomeLinkButtons(open.members) };
  }
  // Alerte plus ancienne (ou bot redémarré) : la liste est relue dans le message à jour.
  const msg = await interaction.message.fetch().catch(() => interaction.message);
  const helpers = toggleHelper(parseHelpers(msg.content), userId);
  await interaction.editReply({ content: withHelpers(msg.content, helpers), allowedMentions: { parse: [] } });
  return { joined: helpers.includes(userId), links: linkButtonsOf(msg) };
}
