import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} from "discord.js";
import {
  getTikTokConfig,
  setTikTokConfig,
  getTikTokStatus,
  checkTikTokSources,
  postTest as tiktokPostTest,
  normalizeHandle,
} from "../../tiktok.js";

const EPHEMERAL = MessageFlags.Ephemeral;

// ====================================================================
// Panneau interactif /setup-tiktok
// ====================================================================

const stamp = (iso) => {
  const t = typeof iso === "number" ? iso : Date.parse(iso || "");
  return !t || Number.isNaN(t) ? "" : `<t:${Math.floor(t / 1000)}:R>`;
};

// Une ligne d'état par source : dernière lecture, erreur éventuelle, pause en cours.
function sourceLine(s) {
  if (!s || s.ok === null) return "*(pas encore lue)*";
  const pause = s.retryAt && s.retryAt > Date.now() ? `\n⏸️ en pause, reprise ${stamp(s.retryAt)}` : "";
  if (s.ok) return `✅ OK ${stamp(s.at)} · ${s.count} vidéo(s)`;
  return `❌ ${s.error} ${stamp(s.at)}${pause}`.slice(0, 1000);
}

async function buildTikTokPanel(guildId) {
  const cfg = await getTikTokConfig(guildId);
  const st = await getTikTokStatus(guildId);
  const shownName = cfg.username || st.profile?.nickname || cfg.account;
  const lastPost = st.lastPostAt ? stamp(st.lastPostAt) : "*(aucune depuis la mise en place)*";

  const embed = new EmbedBuilder()
    .setTitle("📱 Notifications TikTok")
    .setColor(cfg.enabled ? 0x69c9d0 : 0x747f8d)
    .setDescription(
      "Le bot annonce chaque **nouvelle vidéo** d'un compte TikTok dans un salon, avec un ping de rôle.\n\n" +
        "**Comment ça marche :** le bot lit directement la page publique du profil (intégration officielle " +
        "TikTok) toutes les quelques minutes. Un **flux RSS** peut être ajouté en secours, utilisé seulement " +
        "si TikTok ne répond pas. Plusieurs vidéos d'un coup = **un seul message**, jamais de rafale.\n\u200b",
    )
    .addFields(
      { name: "État", value: cfg.enabled ? "🟢 **Activé**" : "🔴 **Désactivé**", inline: true },
      { name: "Compte suivi", value: cfg.account ? `**@${cfg.account}**` : "❌ *(non défini)*", inline: true },
      { name: "Vérification", value: `toutes les **${cfg.pollIntervalMin} min**`, inline: true },
      { name: "Nom affiché", value: shownName ? `**${shownName}**` : "*(auto)*", inline: true },
      { name: "Salon", value: cfg.channelId ? `<#${cfg.channelId}>` : "*(non défini)*", inline: true },
      { name: "Rôle pingé", value: cfg.roleId ? `<@&${cfg.roleId}>` : "*(aucun ping)*", inline: true },
      { name: "Source directe (TikTok)", value: cfg.account ? sourceLine(st.sources?.embed) : "*(compte non défini)*", inline: false },
      { name: "Flux RSS de secours", value: cfg.feedUrl ? sourceLine(st.sources?.rss) : "*(aucun — optionnel)*", inline: false },
      { name: "Dernière notification", value: `${lastPost}${st.lastPostError ? `\n⚠️ ${st.lastPostError}` : ""}`.slice(0, 1000), inline: true },
      { name: "Vidéos mémorisées", value: `${st.seenCount}`, inline: true },
    )
    .setFooter({ text: "Tester = poste la dernière vidéo · Diagnostic = vérifie les sources sans rien poster." });
  if (st.lastNote) embed.addFields({ name: "Dernier événement", value: st.lastNote.slice(0, 1000) });

  const rowChannel = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tt_channel")
      .setPlaceholder("📢 Salon où poster les vidéos")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowRole = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId("tt_role").setPlaceholder("🔔 Rôle à ping (optionnel)").setMinValues(0).setMaxValues(1),
  );
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tt_set_feed").setLabel("Compte & flux").setEmoji("🔗").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tt_interval").setLabel("Intervalle").setEmoji("⏱️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tt_toggle")
      .setLabel(cfg.enabled ? "Activé" : "Désactivé")
      .setEmoji(cfg.enabled ? "🟢" : "🔴")
      .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("tt_test").setLabel("Tester").setEmoji("🧪").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tt_diag").setLabel("Diagnostic").setEmoji("🔎").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowChannel, rowRole, rowButtons] };
}

// Résumé lisible du diagnostic des sources (checkTikTokSources).
function formatDiag(results, cfg) {
  if (!results.length) return "Aucune source configurée.";
  const lines = ["🔎 **Diagnostic des sources**"];
  for (const r of results) {
    const label = r.source === "embed" ? `Source directe (@${cfg.account})` : "Flux RSS de secours";
    if (r.ok) {
      const who = r.profile?.nickname ? `, profil « ${r.profile.nickname} »` : "";
      const title = r.latest?.title ? ` — dernière : « ${r.latest.title.replace(/\s+/g, " ").slice(0, 80)} »` : "";
      lines.push(`✅ ${label} : ${r.count} vidéo(s)${who}${title} (${r.ms} ms)`);
    } else {
      lines.push(`❌ ${label} : ${r.error}`);
    }
  }
  const direct = results.find((r) => r.source === "embed");
  const rss = results.find((r) => r.source === "rss");
  if (direct?.ok) lines.push(`\n➡️ Nouvelles vidéos détectées en **~${cfg.pollIntervalMin} min** après publication.`);
  else if (rss?.ok) lines.push("\n⚠️ Seul le flux RSS répond : les notifications dépendront de son rythme de mise à jour (plus lent).");
  else lines.push("\n🛑 Aucune source ne répond pour l'instant : rien ne sera annoncé tant que ce n'est pas réglé.");
  return lines.join("\n").slice(0, 1900);
}

export async function handleSetupTikTok(interaction, ctx) {
  const panel = await buildTikTokPanel(interaction.guild.id);
  return interaction.reply({ ...panel, flags: EPHEMERAL });
}

async function refreshTikTokPanel(interaction) {
  return interaction.update(await buildTikTokPanel(interaction.guild.id));
}

export async function handleTikTokPanelButton(interaction, ctx) {
  const id = interaction.customId;
  const cfg = await getTikTokConfig(interaction.guild.id);

  if (id === "tt_toggle") {
    if (!cfg.enabled && ((!cfg.account && !cfg.feedUrl) || !cfg.channelId)) {
      return interaction.reply({
        content: "Définis d'abord le **compte TikTok** (bouton « Compte & flux ») et un **salon** avant d'activer.",
        flags: EPHEMERAL,
      });
    }
    await setTikTokConfig(interaction.guild.id, { enabled: !cfg.enabled });
    return refreshTikTokPanel(interaction);
  }

  if (id === "tt_set_feed") {
    const modal = new ModalBuilder().setCustomId("tt_feed_modal").setTitle("Compte TikTok suivi").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("account")
          .setLabel("Compte TikTok (pseudo ou lien du profil)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setPlaceholder("kayagoldforged")
          .setValue(cfg.account || ""),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("username")
          .setLabel("Nom affiché dans l'annonce (optionnel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(64)
          .setPlaceholder("vide = nom du profil TikTok")
          .setValue(cfg.username || ""),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("feedurl")
          .setLabel("Flux RSS de secours (optionnel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("https://…/rss/compte.xml")
          .setValue(cfg.feedUrl || ""),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tt_interval") {
    const modal = new ModalBuilder().setCustomId("tt_interval_modal").setTitle("Fréquence de vérification").addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("interval")
          .setLabel("Minutes entre deux vérifications (1 à 1440)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg.pollIntervalMin)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === "tt_test") {
    await interaction.reply({ content: "🧪 Test en cours…", flags: EPHEMERAL });
    const r = await tiktokPostTest(interaction.client, interaction.guild.id);
    if (r.ok) {
      const via = r.source === "embed" ? "source directe" : "flux RSS";
      return interaction.editReply(`✅ Test réussi — dernière vidéo postée dans <#${cfg.channelId}> (via ${via}).`);
    }
    return interaction.editReply(`❌ Test échoué : ${r.reason}`);
  }

  if (id === "tt_diag") {
    await interaction.reply({ content: "🔎 Diagnostic en cours…", flags: EPHEMERAL });
    const results = await checkTikTokSources(cfg);
    return interaction.editReply(formatDiag(results, cfg));
  }
}

export async function handleTikTokPanelSelect(interaction, ctx) {
  if (interaction.customId === "tt_channel") {
    await setTikTokConfig(interaction.guild.id, { channelId: interaction.values[0] });
    return refreshTikTokPanel(interaction);
  }
  if (interaction.customId === "tt_role") {
    // minValues=0 : si rien n'est choisi, on retire le ping.
    await setTikTokConfig(interaction.guild.id, { roleId: interaction.values[0] || "" });
    return refreshTikTokPanel(interaction);
  }
}

export async function handleTikTokPanelModal(interaction, ctx) {
  if (interaction.customId === "tt_feed_modal") {
    const accountRaw = interaction.fields.getTextInputValue("account")?.trim() || "";
    const username = interaction.fields.getTextInputValue("username")?.trim().replace(/^@+/, "") || "";
    const feedUrl = interaction.fields.getTextInputValue("feedurl")?.trim() || "";
    const account = normalizeHandle(accountRaw);

    if (accountRaw && !account) {
      return interaction.reply({
        content: "Compte TikTok invalide. Donne le pseudo (ex : `kayagoldforged`) ou le lien du profil.",
        flags: EPHEMERAL,
      });
    }
    if (!account && !feedUrl) {
      return interaction.reply({ content: "Indique au moins le **compte TikTok** (recommandé) ou un flux RSS.", flags: EPHEMERAL });
    }
    if (feedUrl && !/^https?:\/\/\S+$/i.test(feedUrl)) {
      return interaction.reply({ content: "URL de flux invalide. Donne une URL http(s) complète.", flags: EPHEMERAL });
    }

    // La vérification réseau peut dépasser les 3 s accordées par Discord : on diffère.
    const fromMessage = interaction.isFromMessage();
    if (fromMessage) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: EPHEMERAL });

    const results = await checkTikTokSources({ account, feedUrl });
    const direct = results.find((r) => r.source === "embed");
    if (direct?.fatal) {
      const msg = `❌ Rien n'a été enregistré : ${direct.error}\nVérifie l'orthographe du compte (@${account}).`;
      return fromMessage ? interaction.followUp({ content: msg, flags: EPHEMERAL }) : interaction.editReply(msg);
    }

    // Changer de compte ou de flux déclenche un amorçage silencieux : l'historique n'est pas reposté.
    const cfg = await setTikTokConfig(interaction.guild.id, { account, feedUrl, username });
    const text = `Enregistré ✅\n${formatDiag(results, cfg)}`;
    if (fromMessage) {
      await interaction.editReply(await buildTikTokPanel(interaction.guild.id));
      return interaction.followUp({ content: text, flags: EPHEMERAL });
    }
    return interaction.editReply(text);
  }

  if (interaction.customId === "tt_interval_modal") {
    const n = Number(interaction.fields.getTextInputValue("interval")?.trim());
    if (!Number.isFinite(n) || n < 1 || n > 1440) {
      return interaction.reply({ content: "Valeur invalide (entre 1 et 1440 minutes).", flags: EPHEMERAL });
    }
    await setTikTokConfig(interaction.guild.id, { pollIntervalMin: Math.floor(n) });
    if (interaction.isFromMessage()) return refreshTikTokPanel(interaction);
    return interaction.reply({ content: `Vérification toutes les ${Math.floor(n)} min. ✅`, flags: EPHEMERAL });
  }
}
