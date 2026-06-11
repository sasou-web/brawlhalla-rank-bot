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

export async function handleTempVoice(oldState, newState) {
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
