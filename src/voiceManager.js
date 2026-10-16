import {
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import {
  getTempConfig,
  getHub,
  addTempChannel,
  removeTempChannel,
  isTempChannel,
  getTempChannelIds,
} from "./tempvoice.js";

/**
 * Salons vocaux temporaires « rejoindre pour créer » (extrait d'index.js).
 * - `handleTempVoice(oldState, newState)` : crée un salon à l'entrée d'un hub, le supprime
 *   quand il se vide.
 * - `cleanupTempChannels(guild)` : nettoyage des salons vides/orphelins au démarrage.
 */

// Panneau de controle poste dans le chat du salon vocal (Components V2).
// Mise en page : en-tete + deux groupes thematiques (acces/apparence, membres/propriete)
// avec leurs boutons juste en dessous, et le ping du proprietaire dans le pied de cadre.
function vcDivider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function voiceControlPanel(ownerId) {
  const container = new ContainerBuilder().setAccentColor(0x1abc9c);

  // En-tete : message d'accueil clair pour un membre lambda.
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## 🎛️ Panneau de contrôle du salon\n" +
        "Bienvenue dans **ta room** ! Gère-la en un clic avec les boutons ci-dessous.\n" +
        "-# 👑 Seul le créateur du salon peut utiliser ces commandes.",
    ),
  );

  // Groupe 1 : acces & apparence.
  container.addSeparatorComponents(vcDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "### 🔧 Accès & apparence\n" +
        "🔒 **Verrouiller** — plus personne ne peut rejoindre\n" +
        "🔓 **Ouvrir** — tout le monde peut rejoindre\n" +
        "👥 **Limite** — fixe le nombre max de membres\n" +
        "✏️ **Renommer** — change le nom du salon",
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vc_lock").setLabel("Verrouiller").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_unlock").setLabel("Ouvrir").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_limit").setLabel("Limite").setEmoji("👥").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_rename").setLabel("Renommer").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    ),
  );

  // Groupe 2 : membres & propriete.
  container.addSeparatorComponents(vcDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "### 👥 Membres & propriété\n" +
        "⛔ **Bloquer** — expulse un membre et l'empêche de revenir\n" +
        "✅ **Autoriser** — réautorise un membre bloqué\n" +
        "👑 **Réclamer** — deviens propriétaire si le créateur est parti",
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vc_block").setLabel("Bloquer").setEmoji("⛔").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("vc_permit").setLabel("Autoriser").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("vc_claim").setLabel("Réclamer").setEmoji("👑").setStyle(ButtonStyle.Primary),
    ),
  );

  // Pied de cadre : ping du proprietaire (notifie grace a allowedMentions).
  container.addSeparatorComponents(vcDivider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# 🎙️ Salon de <@${ownerId}> • ces réglages ne concernent que cette room`),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [ownerId] },
  };
}

// Donne au createur le controle de son salon et poste le panneau (best-effort : n'echoue pas la creation).
function grantOwnerControls(channel, ownerId) {
  channel.permissionOverwrites
    .edit(ownerId, {
      ManageChannels: true,
      MoveMembers: true,
      MuteMembers: true,
    })
    .catch(() => {});
  channel.send(voiceControlPanel(ownerId)).catch(() => {});
}

// Creation simple (ne demande que "Gerer les salons"). Pas d'overwrite ici :
// Discord refuse qu'un bot accorde une permission qu'il n'a pas -> echec total sinon.
// Le salon est suivi comme temporaire : supprime quand il se vide (handleTempVoice).
async function createRegisteredChannel(guild, { ownerId, name, userLimit, categoryId, reason }) {
  const channel = await guild.channels.create({
    name: String(name).slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: categoryId || null,
    userLimit: Math.min(99, Math.max(0, userLimit || 0)),
    reason: reason || "Salon vocal temporaire",
  });
  await addTempChannel(guild.id, channel.id, ownerId);
  return channel;
}

/**
 * Vocal temporaire cree hors hub (ex. equipe LFG complete) : meme suivi et meme panneau de
 * controle que les salons des hubs. Leve en cas d'echec de creation (l'appelant decide).
 */
export async function createTempChannelFor(guild, { ownerId, name, userLimit, categoryId, reason }) {
  const channel = await createRegisteredChannel(guild, { ownerId, name, userLimit, categoryId, reason });
  grantOwnerControls(channel, ownerId);
  return channel;
}

async function createTempChannel(member, cfg, hubChannel, hub) {
  const guild = member.guild;
  const template = hub?.nameTemplate || "🎮 {user}";
  try {
    const channel = await createRegisteredChannel(guild, {
      ownerId: member.id,
      name: template.replace(/\{user\}/gi, member.displayName),
      userLimit: hub?.userLimit,
      categoryId: cfg.categoryId || hubChannel.parentId,
    });
    // Deplacement impossible (membre deja ressorti du hub, permission « Deplacer des membres »
    // manquante...) : le salon resterait vide sans jamais etre supprime -> on le retire aussitot.
    const moved = await member.voice
      .setChannel(channel)
      .then(() => true)
      .catch(() => false);
    if (!moved) {
      await channel.delete("Salon vocal temporaire : membre non deplace").catch(() => {});
      await removeTempChannel(guild.id, channel.id);
      return null;
    }

    grantOwnerControls(channel, member.id);
    return channel;
  } catch (err) {
    console.warn("Creation salon temporaire echouee :", err.message);
    return null;
  }
}

export async function handleTempVoice(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  // Un membre rejoint un hub -> on lui cree un salon selon le modele de CE hub. Seulement a
  // l'ENTREE : micro, casque, camera ou stream emettent aussi un VoiceStateUpdate sur place.
  const cfg = await getTempConfig(guild.id);
  const joined = newState.channelId && newState.channelId !== oldState.channelId;
  if (cfg.enabled && joined && newState.member) {
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

// Nettoyage au demarrage : supprime les salons temporaires vides/orphelins.
export async function cleanupTempChannels(guild) {
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
