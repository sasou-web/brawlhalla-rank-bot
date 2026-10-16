import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  escapeMarkdown,
} from "discord.js";
import { getGuildView, buildLinksIndex, memberLabel } from "../guild.js";
import { getAllLinks } from "../store.js";
import { enforceCooldown } from "./cooldowns.js";
import { EPHEMERAL_V2 } from "./shared.js";

const V2 = MessageFlags.IsComponentsV2;
const NO_MENTIONS = { parse: [] };
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const text = (s) => new TextDisplayBuilder().setContent(s);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** Contenu texte de la carte /guilde (pur, testable). */
export function buildGuildCardSections(snapshot, linksIndex, { stale = false } = {}) {
  const { stats, members } = snapshot;
  const head = [`## 🛡️ ${escapeMarkdown(stats.name)}`];
  const facts = [
    stats.rank ? `Rang **#${fmt(stats.rank)}**` : null,
    `**${fmt(stats.xp)}** XP de guilde`,
    `**${fmt(stats.points)}** points cette semaine`,
    `**${fmt(stats.memberCount ?? members.length)}** membres`,
  ].filter(Boolean);
  head.push(facts.join(" · "));

  const byXp = [...members].sort((a, b) => b.xp - a.xp).slice(0, 10);
  const byPoints = [...members].filter((m) => m.points > 0).sort((a, b) => b.points - a.points).slice(0, 5);
  const medals = ["🥇", "🥈", "🥉"];
  const rankLine = (m, i, value) => `${medals[i] ?? `**${i + 1}.**`} ${memberLabel(m, linksIndex)} — ${value}`;

  const sections = [head.join("\n")];
  sections.push(
    "### Meilleurs contributeurs (XP)\n" +
      (byXp.length ? byXp.map((m, i) => rankLine(m, i, `${fmt(m.xp)} XP`)).join("\n") : "*Aucun membre.*"),
  );
  sections.push(
    "### Points de guilde de la semaine\n" +
      (byPoints.length ? byPoints.map((m, i) => rankLine(m, i, `${fmt(m.points)} pts`)).join("\n") : "*Aucun point cette semaine.*"),
  );
  const linked = members.filter((m) => linksIndex.has(m.id)).length;
  const age = Math.max(1, Math.round((Date.now() - snapshot.at) / 60000));
  sections.push(
    `-# ${linked}/${members.length} membres liés à un compte Discord · données d'il y a ${age} min` +
      (stale ? " (API Brawlhalla indisponible, dernières données connues)" : ""),
  );
  return sections;
}

export async function handleGuilde(interaction) {
  if (!(await enforceCooldown(interaction, "guilde", 30_000))) return;
  await interaction.deferReply({ flags: V2 });
  const view = await getGuildView(interaction.guildId);
  if (!view.configured)
    return interaction.editReply({ components: [text("La guilde Brawlhalla du serveur n'est pas encore configurée (dashboard › Communauté › Guilde).")], flags: V2 });
  if (!view.snapshot)
    return interaction.editReply({ components: [text(`Impossible de lire la guilde pour le moment. ${view.error || ""}`.trim())], flags: V2 });

  const linksIndex = buildLinksIndex(await getAllLinks());
  const card = new ContainerBuilder().setAccentColor(0x3b82f6);
  buildGuildCardSections(view.snapshot, linksIndex, { stale: view.stale }).forEach((s, i) => {
    if (i) card.addSeparatorComponents(sep());
    card.addTextDisplayComponents(text(s));
  });
  card.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("gld_unlinked").setLabel("Membres non liés").setEmoji("🔗").setStyle(ButtonStyle.Secondary),
    ),
  );
  return interaction.editReply({ components: [card], flags: V2, allowedMentions: NO_MENTIONS });
}

/** Liste des pseudos de la guilde sans compte Discord lié (pur, testable). */
export function unlinkedGuildMembers(members, linksIndex) {
  return members.filter((m) => !linksIndex.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

// Bouton staff (préfixe gld_ : permission « Gérer le serveur » revérifiée par commands.js).
export async function handleGuildButton(interaction) {
  if (interaction.customId !== "gld_unlinked") return;
  await interaction.deferReply({ flags: EPHEMERAL_V2 });
  const view = await getGuildView(interaction.guildId);
  if (!view.snapshot) return interaction.editReply({ components: [text("Aucune donnée de guilde disponible pour le moment.")], flags: EPHEMERAL_V2 });
  const unlinked = unlinkedGuildMembers(view.snapshot.members, buildLinksIndex(await getAllLinks()));
  if (!unlinked.length) return interaction.editReply({ components: [text("✅ Tous les membres de la guilde ont lié leur compte.")], flags: EPHEMERAL_V2 });
  const lines = [];
  let size = 0;
  for (const m of unlinked) {
    const line = `• ${escapeMarkdown(m.name)}${m.rank ? ` · ${escapeMarkdown(m.rank)}` : ""}`;
    if (size + line.length > 3500) {
      lines.push(`… et ${unlinked.length - lines.length} autre(s)`);
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return interaction.editReply({
    components: [text(`### 🔗 ${unlinked.length} membre(s) de la guilde sans compte lié\n${lines.join("\n")}`)],
    flags: EPHEMERAL_V2,
    allowedMentions: NO_MENTIONS,
  });
}
