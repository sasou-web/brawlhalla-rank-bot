import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import { topCounters } from "../achievements.js";
import { getGuessRankConfig, guessStats } from "../guessrank.js";
import { enforceCooldown } from "./cooldowns.js";

// ---------- /devine-top : classement « Devine ton rang » noté ----------

const V2 = MessageFlags.IsComponentsV2;
const MEDALS = ["🥇", "🥈", "🥉"];

function card(...texts) {
  const c = new ContainerBuilder().setAccentColor(0x9b59b6);
  texts.forEach((t, i) => {
    if (i) c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t));
  });
  return c;
}

export async function handleDevineTop(interaction) {
  if (!(await enforceCooldown(interaction, "devine-top", 4000))) return;
  await interaction.deferReply({ flags: V2 });
  const guildId = interaction.guild.id;
  const cfg = await getGuessRankConfig(guildId);
  const off = cfg.scoringEnabled ? null : "-# Le score est désactivé : aucun point n'est compté pour le moment.";

  if (interaction.options.getBoolean("moi")) {
    const s = guessStats(guildId, interaction.user.id);
    const body = s.games
      ? `**${s.points}** point${s.points > 1 ? "s" : ""} · **${s.games}** partie${s.games > 1 ? "s" : ""}\n` +
        `🎯 Rang exact : **${s.exact}** fois (précision **${s.precision} %**)` +
        (s.place ? `\n🏆 Place au classement : **${s.place}${s.place === 1 ? "er" : "e"}**` : "")
      : "Tu n'as encore participé à aucune révélation. Vote sous un clip avec l'emoji du rang que tu devines !";
    const parts = [`## 🔮 Devine ton rang — ${interaction.user.username}`, body];
    if (off) parts.push(off);
    return interaction.editReply({ components: [card(...parts)], flags: V2, allowedMentions: { parse: [] } });
  }

  const top = topCounters(guildId, "guess_points", 10);
  const lines = top.map((e, i) => {
    const s = guessStats(guildId, e.userId);
    return `${MEDALS[i] ?? `**${i + 1}.**`} <@${e.userId}> — **${e.val}** pts · ${s.games} partie${s.games > 1 ? "s" : ""} · ${s.precision} % exact`;
  });
  const parts = [
    "## 🔮 Classement « Devine ton rang »",
    lines.join("\n") || "Personne n'a encore marqué de point.",
    `-# Rang exact : +${cfg.pointsExact} · à un rang près : +${cfg.pointsNear} · révélation ${cfg.revealDelayHours} h après le clip. Tes stats : \`/devine-top moi:True\``,
  ];
  if (off) parts.push(off);
  return interaction.editReply({ components: [card(...parts)], flags: V2, allowedMentions: { parse: [] } });
}
