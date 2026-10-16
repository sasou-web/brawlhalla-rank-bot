import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } from "discord.js";
import { config } from "./config.js";
import { winsNeeded, autoConfirmAt, CHALLENGE_TTL_MS, MATCH_TTL_MS } from "./ladder.js";

/**
 * Messages Discord du ladder (fonctions pures, JSON brut comme le reste du bot) : carte du
 * défi qui devient le scoreboard puis le résultat, annonce, alerte staff, classement.
 * La carte est un message classique (embed + boutons) pour pouvoir y joindre des fichiers.
 */

const COLORS = {
  pending: 0x4ea1ff,
  accepted: 0x4ea1ff,
  reported: 0xf1c40f,
  disputed: 0xff4d5e,
  done: 0x2ecc71,
  closed: 0x5a606b,
};
const MEDALS = ["🥇", "🥈", "🥉"];

const ts = (ms, style = "R") => `<t:${Math.floor(ms / 1000)}:${style}>`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

function nameOf(match, side) {
  const n = side === "a" ? match.a_name : match.b_name;
  return n || (side === "a" ? "Joueur 1" : "Joueur 2");
}

/** Série affichée : « 🔥 3 V » (victoires d'affilée), « 2 D » (défaites), « — ». */
export function streakText(streak) {
  if (streak > 0) return `🔥 ${streak} V`;
  if (streak < 0) return `${-streak} D`;
  return "—";
}

function scoreLine(m) {
  return `<@${m.a_id}>  \`${m.score_a}\`  —  \`${m.score_b}\`  <@${m.b_id}>`;
}

function loserOf(m) {
  return m.winner_id === m.a_id ? m.b_id : m.a_id;
}

function winnerScore(m) {
  return `${Math.max(m.score_a, m.score_b)}-${Math.min(m.score_a, m.score_b)}`;
}

/**
 * Carte d'un défi selon son statut. `eloA`/`eloB` : Elo actuels (défi en attente) ;
 * `cfg` : config du ladder (validation automatique). Les modifications de la carte ne
 * notifient personne : seule la création mentionne le joueur défié.
 */
export function buildLadderCard(match, { eloA, eloB, cfg } = {}) {
  const m = match;
  const bo = m.best_of;
  const need = winsNeeded(bo);
  const title = `⚔️ Défi 1v1 · BO${bo}`;
  const noPing = { parse: [] };
  const btn = (style, label, customId, emoji) => ({ type: 2, style, label: String(label).slice(0, 80), custom_id: customId, ...(emoji ? { emoji: { name: emoji } } : {}) });

  if (m.status === "pending") {
    const elo = (v) => (Number.isFinite(v) ? ` (**${v}** Elo)` : "");
    return {
      content: `<@${m.b_id}>`,
      embeds: [
        {
          title,
          color: COLORS.pending,
          description:
            `<@${m.a_id}>${elo(eloA)} défie <@${m.b_id}>${elo(eloB)} !\n\n` +
            `<@${m.b_id}>, accepte ou refuse le défi. Sans réponse, il expire ${ts(m.created_at + CHALLENGE_TTL_MS)}.`,
          footer: { text: `Premier à ${need} manche${need > 1 ? "s" : ""} · ladder interne du serveur` },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            btn(3, "Accepter", `lad_accept:${m.id}`, "✅"),
            btn(4, "Refuser", `lad_decline:${m.id}`, "✖️"),
            btn(2, "Retirer le défi", `lad_cancel:${m.id}`),
          ],
        },
      ],
      allowedMentions: { users: [m.b_id] },
    };
  }

  if (m.status === "accepted") {
    const played = m.game_log.length;
    return {
      content: "",
      embeds: [
        {
          title: `${title} · en cours`,
          color: COLORS.accepted,
          description:
            `${scoreLine(m)}\n\nPremier à **${need}** manche${need > 1 ? "s" : ""}. Après chaque manche, l'un des deux joueurs ` +
            `clique sur le vainqueur. ↩️ corrige la dernière manche, ⚠️ signale un problème au staff.\n` +
            `Sans résultat final, le défi expire ${ts(m.accepted_at + MATCH_TTL_MS)}.`,
          footer: { text: "1 manche gagnée = 1 point · le perdant confirme le score final" },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            btn(1, `Manche ${nameOf(m, "a")}`, `lad_game:${m.id}:a:${played}`),
            btn(1, `Manche ${nameOf(m, "b")}`, `lad_game:${m.id}:b:${played}`),
            btn(2, "Annuler", `lad_undo:${m.id}`, "↩️"),
            btn(4, "Litige", `lad_dispute:${m.id}`, "⚠️"),
          ],
        },
      ],
      allowedMentions: noPing,
    };
  }

  if (m.status === "reported") {
    const at = cfg ? autoConfirmAt(m, cfg) : 0;
    const auto = at ? `Sans réponse, il sera validé automatiquement ${ts(at)}.` : "Sans réponse, le staff tranchera.";
    return {
      content: "",
      embeds: [
        {
          title: `${title} · à confirmer`,
          color: COLORS.reported,
          description:
            `${scoreLine(m)}\n\n🏆 <@${m.winner_id}> remporte le défi **${winnerScore(m)}**.\n` +
            `<@${loserOf(m)}>, confirme le résultat ou signale un litige. ${auto}`,
          footer: { text: "Seul le perdant peut confirmer · l'Elo bouge à la validation" },
        },
      ],
      components: [
        {
          type: 1,
          components: [btn(3, "Confirmer le résultat", `lad_confirm:${m.id}`, "✅"), btn(4, "Litige", `lad_dispute:${m.id}`, "⚠️")],
        },
      ],
      allowedMentions: noPing,
    };
  }

  if (m.status === "disputed") {
    const d = m.dispute || {};
    return {
      content: "",
      embeds: [
        {
          title: `${title} · litige`,
          color: COLORS.disputed,
          description: `${scoreLine(m)}\n\n⚠️ Litige signalé${d.by ? ` par <@${d.by}>` : ""} : le staff va trancher. Aucun point ne bouge en attendant.`,
        },
      ],
      components: [],
      allowedMentions: noPing,
    };
  }

  if (m.status === "confirmed" || m.status === "resolved") {
    const how = m.status === "resolved" ? "Décision du staff" : m.resolved_by ? "Confirmé par le perdant" : "Validé automatiquement";
    return {
      content: "",
      embeds: [
        {
          title: `${title} · terminé`,
          color: COLORS.done,
          description:
            `🏆 <@${m.winner_id}> bat <@${loserOf(m)}> **${winnerScore(m)}**.\n` +
            `Elo : **${signed(m.elo_delta)}** pour <@${m.winner_id}>, **${signed(-m.elo_delta)}** pour <@${loserOf(m)}>.`,
          footer: { text: how },
        },
      ],
      components: [],
      allowedMentions: noPing,
    };
  }

  // Défis clos sans résultat.
  let text;
  if (m.status === "declined") text = `✖️ <@${m.b_id}> a refusé le défi.`;
  else if (m.status === "expired") text = m.accepted_at ? "⌛ Défi expiré : aucun résultat final dans les 24 h." : `⌛ Défi expiré : <@${m.b_id}> n'a pas répondu à temps.`;
  else if (m.status === "cancelled") text = m.resolved_by === m.a_id ? `🚫 Défi retiré par <@${m.a_id}>.` : "🚫 Défi annulé par le staff : aucun point attribué.";
  else text = "Défi clos.";
  return {
    content: "",
    embeds: [{ title, color: COLORS.closed, description: `<@${m.a_id}> contre <@${m.b_id}>\n\n${text}` }],
    components: [],
    allowedMentions: noPing,
  };
}

/** Annonce d'un défi validé (sans mention qui notifie). */
export function buildLadderResultAnnounce(match, { position, how = "" } = {}) {
  const m = match;
  const rank = position ? ` — #${position} du ladder` : "";
  const suffix = how ? ` · ${how}` : "";
  return {
    content: `⚔️ <@${m.winner_id}> bat <@${loserOf(m)}> **${winnerScore(m)}** (${signed(m.elo_delta)} / ${signed(-m.elo_delta)})${rank}${suffix}`,
    allowedMentions: { parse: [] },
  };
}

/** Alerte staff d'un litige : décision en un clic (avec confirmation), capture en grand. */
export function buildLadderModAlert(match, { reason, by, imageName, files = 0, cfg = {} } = {}) {
  const m = match;
  const lines = [
    `<@${m.a_id}> contre <@${m.b_id}> · BO${m.best_of}`,
    `**Score au moment du litige** : ${m.score_a}-${m.score_b}`,
    `**Raison** : ${reason || "Non précisée"}`,
  ];
  if (by) lines.push(`**Signalé par** : <@${by}>`);
  if (files) lines.push(`📎 ${files} capture(s) jointe(s)`);
  const embed = { title: "🚨 Litige ladder", color: COLORS.disputed, description: lines.join("\n").slice(0, 4096) };
  if (imageName) embed.image = { url: `attachment://${imageName}` };
  const row = {
    type: 1,
    components: [
      { type: 2, style: 3, label: `Victoire ${nameOf(m, "a")}`.slice(0, 80), custom_id: `lad_modwin:${m.id}:a` },
      { type: 2, style: 3, label: `Victoire ${nameOf(m, "b")}`.slice(0, 80), custom_id: `lad_modwin:${m.id}:b` },
      { type: 2, style: 2, label: "Annuler le match", custom_id: `lad_modvoid:${m.id}` },
    ],
  };
  if (m.channel_id && m.message_id) {
    row.components.push({ type: 2, style: 5, label: "Voir le défi", url: `https://discord.com/channels/${config.guildId}/${m.channel_id}/${m.message_id}` });
  }
  const ping = cfg.modRoleId ? `<@&${cfg.modRoleId}>` : undefined;
  return { content: ping, embeds: [embed], components: [row], allowedMentions: { roles: cfg.modRoleId ? [cfg.modRoleId] : [] } };
}

/** Alerte staff une fois tranchée : boutons retirés, décision indiquée. */
export function buildLadderModAlertDone(match, staffId) {
  const outcome = match.status === "cancelled" ? "🚫 Match annulé" : `✅ Victoire de <@${match.winner_id}>`;
  return {
    embeds: [
      {
        title: "🚨 Litige ladder · tranché",
        color: COLORS.done,
        description: `<@${match.a_id}> contre <@${match.b_id}>\n${outcome}${staffId ? ` par <@${staffId}>` : ""}.`,
      },
    ],
    components: [],
    allowedMentions: { parse: [] },
  };
}

function card(accent, ...texts) {
  const c = new ContainerBuilder().setAccentColor(accent);
  texts.forEach((t, i) => {
    if (i) c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t));
  });
  return c;
}

/** /ladder : top 10 (Components V2). `ranking` : sortie de getLadderRanking. */
export function buildLadderTopCard(ranking, { season = 1, cfg } = {}) {
  const lines = ranking.slice(0, 10).map(
    (r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.user_id}> — **${r.elo}** Elo · ${r.wins} V / ${r.losses} D · ${streakText(r.streak)}`,
  );
  return card(
    0xe67e22,
    `## ⚔️ Ladder 1v1 · saison ${season}`,
    lines.join("\n") || "Personne n'est encore classé. Lance le premier défi avec `/defi` !",
    `-# ${ranking.length} joueur${ranking.length > 1 ? "s" : ""} classé${ranking.length > 1 ? "s" : ""} · Elo de départ ${cfg?.startElo ?? 1000}, K = ${cfg?.kFactor ?? 32} · \`/defi\` pour défier un membre · \`/ladder moi:True\` pour tes stats`,
  );
}

/** /ladder moi (ou membre) : position, bilan, 5 derniers matchs. */
export function buildLadderPlayerCard(userId, username, { standing, recent = [], season = 1 } = {}) {
  const head = `## ⚔️ Ladder · ${username}`;
  const row = standing?.row;
  if (!row) {
    return card(0xe67e22, head, `Pas encore classé cette saison (saison ${season}). Lance un défi avec \`/defi\` !`);
  }
  const summary =
    `**#${standing.position}** sur ${standing.total} · **${row.elo}** Elo\n` +
    `${row.wins} victoire${row.wins > 1 ? "s" : ""} · ${row.losses} défaite${row.losses > 1 ? "s" : ""} · série ${streakText(row.streak)}`;
  const history = recent.map((m) => {
    const won = m.winner_id === String(userId);
    const opp = m.a_id === String(userId) ? m.b_id : m.a_id;
    const mine = m.a_id === String(userId) ? m.score_a : m.score_b;
    const theirs = m.a_id === String(userId) ? m.score_b : m.score_a;
    const delta = won ? m.elo_delta : -m.elo_delta;
    return `${won ? "✅" : "❌"} contre <@${opp}> **${mine}-${theirs}** (${signed(delta)}) · ${ts(m.resolved_at)}`;
  });
  return card(0xe67e22, head, summary, `### Derniers matchs\n${history.join("\n") || "Aucun match validé pour l'instant."}`);
}

/** Annonce du podium à la clôture d'une saison. */
export function buildSeasonPodiumAnnounce(archive) {
  const lines = archive.top.slice(0, 3).map((p, i) => `${MEDALS[i]} <@${p.userId}> — **${p.elo}** Elo (${p.wins} V / ${p.losses} D)`);
  return {
    embeds: [
      {
        title: `🏁 Fin de la saison ${archive.season} du ladder`,
        color: 0xffd700,
        description:
          (lines.length ? `${lines.join("\n")}\n\n` : "Aucun joueur classé cette saison.\n\n") +
          `${archive.matches} défi${archive.matches > 1 ? "s" : ""} validé${archive.matches > 1 ? "s" : ""} · ${archive.players} joueur${archive.players > 1 ? "s" : ""}.\n` +
          `La saison ${archive.season + 1} commence : tout le monde repart du même Elo. À vos défis !`,
      },
    ],
    allowedMentions: { parse: [] },
  };
}
