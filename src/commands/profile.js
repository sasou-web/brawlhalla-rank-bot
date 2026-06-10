import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from "discord.js";
import {
  searchPlayers, getPlayerProfile, getRankings, getLegends, estimateGlory, tierFromRating, pingApi, getApiMetrics,
} from "../brawlhalla.js";
import { getLink, getAllLinks } from "../store.js";
import { getRatingHistory } from "../ratingStore.js";
import { renderProfileCard } from "../profileCard.js";
import { tierEmojiResolvable } from "../config.js";
import { EPHEMERAL, tierEmoji } from "./shared.js";
import { enforceCooldown } from "./cooldowns.js";

// ---------- /top ----------

export async function handleTop(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "top", 5000))) return;
  await interaction.deferReply();
  const links = await getAllLinks();
  const entries = Object.entries(links)
    .map(([id, l]) => ({ id, name: l.name, rating: l.rating1v1 ?? 0, tiers: l.tiers }))
    .filter((e) => e.rating > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 15);

  if (entries.length === 0) return interaction.editReply("Aucun membre lié avec un rank 1v1 pour le moment.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = entries.map((e, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    const t = e.tiers?.["1v1"];
    return `${place} <@${e.id}> — ${t ? `${tierEmoji(t)} ${t}` : "?"} (${e.rating})`;
  });
  const embed = new EmbedBuilder()
    .setTitle("🏆 Classement 1v1 — membres liés")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /stats /rank /legendes /equipe (lookup) ----------

/**
 * Determine le compte cible : option pseudo > option membre > soi-meme.
 * Renvoie { brawlhallaId, label } ou { error }.
 */
async function resolveTarget(interaction) {
  const idOpt = interaction.options.getInteger("id");
  const pseudo = interaction.options.getString("pseudo")?.trim();
  const memberOpt = interaction.options.getUser("membre");

  // Brawlhalla ID fourni : chemin le plus fiable (on va direct au profil, aucune recherche).
  if (idOpt) {
    return { brawlhallaId: idOpt, label: `ID ${idOpt}` };
  }

  if (pseudo) {
    let players;
    try {
      players = await searchPlayers(pseudo);
    } catch (err) {
      return { error: err.pending ? err.message : `Erreur API : ${err.message}` };
    }
    if (!players.length) return { error: `Aucun joueur classé trouvé pour **${pseudo}**.` };
    return { brawlhallaId: players[0].id, label: players[0].username };
  }
  const targetUser = memberOpt ?? interaction.user;
  const link = await getLink(targetUser.id);
  if (!link) {
    return {
      error: memberOpt
        ? `<@${targetUser.id}> n'a aucun compte lié.`
        : "Tu n'as pas de compte lié. Fais /lier d'abord, ou précise un pseudo.",
    };
  }
  return { brawlhallaId: link.brawlhallaId, label: link.name };
}

function winrate(wins, games) {
  return games > 0 ? `${((wins / games) * 100).toFixed(1)}%` : "—";
}

// Formate une duree en secondes facon Raybot : "1 211h 56m 14s".
function formatPlaytime(totalSec) {
  if (!totalSec || totalSec <= 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h.toLocaleString("fr-FR")}h ${m}m ${s}s`;
}

// ============================================================
//  Fiche joueur unifiee : 4 onglets distincts (Vue d'ensemble,
//  Ranked, Legendes, Equipes 2v2) navigables par boutons.
//  Les commandes /stats /rank /legendes /equipe ouvrent chacune
//  un onglet, mais partagent le MEME embed + boutons : aucune
//  info en double, et on change d'onglet sans retaper la commande
//  (le profil est en cache -> instantane).
// ============================================================

const PROFILE_VIEWS = [
  ["overview", "Vue d'ensemble", "🪪"],
  ["ranked", "Ranked", "🥊"],
  ["legends", "Légendes", "⚔️"],
  ["teams", "Équipes 2v2", "👥"],
];

// Rangee de boutons d'onglets (l'onglet actif est mis en avant et desactive).
function profileNavRow(active, brawlhallaId) {
  return new ActionRowBuilder().addComponents(
    PROFILE_VIEWS.map(([view, label, emoji]) =>
      new ButtonBuilder()
        .setCustomId(`prof:${view}:${brawlhallaId}`)
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(view === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(view === active),
    ),
  );
}

// Coequipier d'une equipe 2v2 (l'autre que le joueur consulte).
function teammate(team, brawlhallaId) {
  return team.brawlhalla_id_one !== brawlhallaId ? team.username_one : team.username_two;
}

// Construit l'embed correspondant a un onglet. p = profil, legends = Map id->info.
function buildProfileEmbed(view, p, legends) {
  const footer = { text: `Brawlhalla ID : ${p.brawlhallaId} · change d'onglet avec les boutons` };

  // ---------- Onglet RANKED : tout le competitif (1v1 + 2v2 + legende classee) ----------
  if (view === "ranked") {
    const embed = new EmbedBuilder().setTitle(`🥊 Ranked — ${p.name}`).setColor(0x9b59b6).setFooter(footer);

    if (p.ratings["1v1"] > 0) {
      const tier = p.tiers["1v1"] === "Valhallan" ? "Valhallan" : tierFromRating(p.ratings["1v1"]);
      const losses = Math.max(0, p.games1v1 - p.wins1v1);
      const lines = [
        `${tierEmoji(p.tiers["1v1"])} **${tier}** — ${p.ratings["1v1"]} / ${p.peak1v1} (peak)`,
        `**${p.wins1v1}** V • **${losses}** D — ${p.games1v1} games (**${winrate(p.wins1v1, p.games1v1)}**)`,
        `🌍 Rang mondial : **#${p.globalRank || "?"}** · Région : **${p.region}**`,
      ];
      const glory = estimateGlory(p);
      if (glory) lines.push(`🏅 Glory estimée : **≈ ${glory.totalGlory.toLocaleString("fr-FR")}**`);
      embed.addFields({ name: "🥊 1v1", value: lines.join("\n") });
    } else {
      embed.addFields({ name: "🥊 1v1", value: "Non classé" });
    }

    const bestLeg = [...p.legendsRanked].sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0];
    if (bestLeg && bestLeg.games > 0) {
      const name = legends.get(bestLeg.legend_id)?.name ?? `#${bestLeg.legend_id}`;
      const lossL = Math.max(0, bestLeg.games - bestLeg.wins);
      embed.addFields({
        name: "⭐ Meilleure légende classée",
        value:
          `**${name}** — ${bestLeg.tier ?? tierFromRating(bestLeg.rating)} (${bestLeg.rating} / ${bestLeg.peak_rating})\n` +
          `${bestLeg.wins} V • ${lossL} D (${winrate(bestLeg.wins, bestLeg.games)})`,
        inline: true,
      });
    }

    if (p.best2v2) {
      const t = p.best2v2;
      const tier = p.tiers["2v2"] === "Valhallan" ? "Valhallan" : tierFromRating(t.rating);
      const loss2 = Math.max(0, t.games - t.wins);
      embed.addFields({
        name: "👥 Meilleure équipe 2v2",
        value:
          `${tierEmoji(p.tiers["2v2"])} **${tier}** — ${t.rating} / ${t.peak_rating} (peak)\n` +
          `🤝 avec **${teammate(t, p.brawlhallaId) ?? "?"}**\n` +
          `${t.wins} V • ${loss2} D (${winrate(t.wins, t.games)})`,
        inline: true,
      });
    } else {
      embed.addFields({ name: "👥 Meilleure équipe 2v2", value: "Non classé", inline: true });
    }
    return embed;
  }

  // ---------- Onglet LEGENDES : top legendes les plus jouees (tous modes) ----------
  if (view === "legends") {
    const embed = new EmbedBuilder().setTitle(`⚔️ Légendes — ${p.name}`).setColor(0xe67e22).setFooter(footer);
    const top = [...p.legendsAll].sort((a, b) => (b.games ?? 0) - (a.games ?? 0)).slice(0, 8);
    if (!top.length) {
      embed.setDescription("*Aucune statistique de légende.*");
    } else {
      embed.setDescription(
        top
          .map((l, i) => {
            const name = legends.get(l.legend_id)?.name ?? `#${l.legend_id}`;
            return `**${i + 1}.** ${name} — ${l.games.toLocaleString("fr-FR")} games · **${winrate(l.wins, l.games)}** WR`;
          })
          .join("\n"),
      );
    }
    return embed;
  }

  // ---------- Onglet EQUIPES 2v2 : toutes les equipes classees ----------
  if (view === "teams") {
    const embed = new EmbedBuilder().setTitle(`👥 Équipes 2v2 — ${p.name}`).setColor(0x1abc9c).setFooter(footer);
    const teams = [...p.teams].sort((a, b) => b.rating - a.rating).slice(0, 12);
    if (!teams.length) {
      embed.setDescription("*Aucune équipe 2v2 classée.*");
    } else {
      embed.setDescription(
        teams
          .map((t) => {
            const tier = t.tier ?? tierFromRating(t.rating);
            const loss = Math.max(0, t.games - t.wins);
            return `**${teammate(t, p.brawlhallaId) ?? "?"}** — ${tierEmoji(tier.split(" ")[0])} ${tier} (${t.rating}) · ${t.wins}V/${loss}D · ${winrate(t.wins, t.games)}`;
          })
          .join("\n"),
      );
    }
    return embed;
  }

  // ---------- Onglet VUE D'ENSEMBLE : la carte de visite (carriere, pas le detail ranked) ----------
  const embed = new EmbedBuilder().setTitle(`🪪 Profil — ${p.name}`).setColor(0x4ea1ff).setFooter(footer);
  const playSec = p.legendsAll.reduce((a, l) => a + (l.match_time ?? 0), 0);
  const totLoss = Math.max(0, p.totalGames - p.totalWins);
  const fav = [...p.legendsAll].sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0];
  const favTxt = fav
    ? `${legends.get(fav.legend_id)?.name ?? `#${fav.legend_id}`} (${fav.games.toLocaleString("fr-FR")} games · ${winrate(fav.wins, fav.games)})`
    : "—";
  const rank1 = p.tiers["1v1"]
    ? `${tierEmoji(p.tiers["1v1"])} **${p.tiers["1v1"]}**${p.ratings["1v1"] ? ` (${p.ratings["1v1"]})` : ""}`
    : "Non classé";
  const rank2 = p.tiers["2v2"]
    ? `${tierEmoji(p.tiers["2v2"])} **${p.tiers["2v2"]}**${p.ratings["2v2"] ? ` (${p.ratings["2v2"]})` : ""}`
    : "Non classé";
  embed.addFields(
    { name: "Niveau", value: `**${p.level}**`, inline: true },
    { name: "Région", value: `${p.region}`, inline: true },
    { name: "Temps de jeu", value: formatPlaytime(playSec), inline: true },
    {
      name: "Games (tous modes)",
      value: `**${p.totalGames.toLocaleString("fr-FR")}** · ${winrate(p.totalWins, p.totalGames)} WR`,
      inline: true,
    },
    {
      name: "Victoires / Défaites",
      value: `${p.totalWins.toLocaleString("fr-FR")} • ${totLoss.toLocaleString("fr-FR")}`,
      inline: true,
    },
    { name: "Légende préférée", value: favTxt, inline: true },
    { name: "Rangs", value: `🥊 1v1 : ${rank1}\n👥 2v2 : ${rank2}`, inline: false },
  );
  return embed;
}

// Logique commune aux 4 commandes : resout la cible, charge le profil, repond avec l'onglet + boutons.
// ---------- /progression : courbe d'evolution du rating ----------

// ---------- /carte : carte profil en image ----------

export async function handleCarte(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "carte", 8000))) return;
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let profile;
  try {
    profile = await getPlayerProfile(target.brawlhallaId);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }

  // Avatar Discord : seulement si la cible est un membre (option "membre" ou soi-meme par defaut).
  const memberOpt = interaction.options.getUser("membre");
  const noLookup = !interaction.options.getString("pseudo") && !interaction.options.getInteger("id");
  const avatarUser = memberOpt ?? (noLookup ? interaction.user : null);
  let avatarBuffer = null;
  if (avatarUser) {
    try {
      const res = await fetch(avatarUser.displayAvatarURL({ extension: "png", size: 256 }));
      if (res.ok) avatarBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      /* pas d'avatar : la carte s'affiche sans */
    }
  }

  // Main legende (la plus jouee, >= 1 game) pour l'afficher sur la carte.
  let mainLegend = null;
  try {
    const legends = Array.isArray(profile.legendsAll) ? profile.legendsAll : [];
    let best = null;
    for (const l of legends) if ((l.games ?? 0) > 0 && (!best || (l.games ?? 0) > (best.games ?? 0))) best = l;
    if (best) mainLegend = (await getLegends()).get(best.legend_id)?.name ?? null;
  } catch {
    /* best-effort */
  }

  const glory = estimateGlory(profile)?.totalGlory ?? null;

  let buffer;
  try {
    buffer = await renderProfileCard(profile, {
      avatarBuffer,
      displayName: avatarUser?.username ?? profile.name,
      mainLegend,
      glory,
    });
  } catch (err) {
    return interaction.editReply(`Impossible de générer la carte : ${err.message}`);
  }

  const file = new AttachmentBuilder(buffer, { name: "carte.png" });
  return interaction.editReply({ files: [file] });
}

// ---------- /progression : courbe d'evolution du rating ----------

export async function handleProgression(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "progression", 6000))) return;
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let profile = null;
  try {
    profile = await getPlayerProfile(target.brawlhallaId);
  } catch {
    /* on continue : le nom de repli suffit */
  }
  const name = profile?.name ?? target.label ?? "Joueur";

  const history = await getRatingHistory(target.brawlhallaId);
  if (history.length < 2) {
    return interaction.editReply(
      `📈 Pas encore assez de données pour **${name}**.\n` +
        "L'historique se construit automatiquement à chaque rafraîchissement des rôles. Reviens dans quelques jours !",
    );
  }

  // On borne a 120 points pour garder l'URL du graphe raisonnable.
  const points = history.slice(-120);
  const labels = points.map((p) => new Date(p.ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }));
  const r1 = points.map((p) => p.r1 || null);
  const r2 = points.map((p) => (p.r2 ? p.r2 : null));

  const chart = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "1v1", data: r1, borderColor: "#4ea1ff", backgroundColor: "#4ea1ff", fill: false, tension: 0.3, spanGaps: true, pointRadius: 0 },
        { label: "2v2", data: r2, borderColor: "#9b59b6", backgroundColor: "#9b59b6", fill: false, tension: 0.3, spanGaps: true, pointRadius: 0 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: "#ffffff" } } },
      scales: { x: { ticks: { color: "#bbbbbb", maxTicksLimit: 10 } }, y: { ticks: { color: "#bbbbbb" } } },
    },
  };
  const chartUrl =
    "https://quickchart.io/chart?bkg=" + encodeURIComponent("#2b2d31") + "&w=720&h=400&c=" + encodeURIComponent(JSON.stringify(chart));

  const first = points[0];
  const last = points[points.length - 1];
  const d1 = (last.r1 || 0) - (first.r1 || 0);
  const d2 = (last.r2 || 0) - (first.r2 || 0);
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  const embed = new EmbedBuilder()
    .setColor(0x4ea1ff)
    .setTitle(`📈 Progression — ${name}`)
    .setImage(chartUrl)
    .addFields(
      { name: "1v1 actuel", value: `**${last.r1 || 0}**${d1 ? ` (${sign(d1)})` : ""}`, inline: true },
      { name: "2v2 actuel", value: `**${last.r2 || 0}**${d2 ? ` (${sign(d2)})` : ""}`, inline: true },
      { name: "Période", value: `${labels[0]} → ${labels[labels.length - 1]}`, inline: true },
    )
    .setFooter({ text: "Historique enregistré à chaque refresh des rôles." });

  return interaction.editReply({ embeds: [embed] });
}

// ---------- /versus : comparaison de deux joueurs ----------

// Resout un cote de la comparaison depuis les options suffixees (membre1/pseudo1/id1...).
async function resolveVersusSide(interaction, suffix, allowSelf) {
  const idOpt = interaction.options.getInteger(`id${suffix}`);
  const pseudo = interaction.options.getString(`pseudo${suffix}`)?.trim();
  const memberOpt = interaction.options.getUser(`membre${suffix}`);

  if (idOpt) return { brawlhallaId: idOpt, label: `ID ${idOpt}` };
  if (pseudo) {
    let players;
    try {
      players = await searchPlayers(pseudo);
    } catch (err) {
      return { error: err.pending ? err.message : `Erreur API : ${err.message}` };
    }
    if (!players.length) return { error: `Aucun joueur classé trouvé pour **${pseudo}**.` };
    return { brawlhallaId: players[0].id, label: players[0].username };
  }
  if (memberOpt) {
    const link = await getLink(memberOpt.id);
    if (!link) return { error: `<@${memberOpt.id}> n'a aucun compte lié.` };
    return { brawlhallaId: link.brawlhallaId, label: link.name };
  }
  if (allowSelf) {
    const link = await getLink(interaction.user.id);
    if (!link) return { error: "Tu n'as pas de compte lié. Précise un pseudo/membre pour le 1er joueur." };
    return { brawlhallaId: link.brawlhallaId, label: link.name };
  }
  return { error: "Précise le **2e joueur** (membre, pseudo ou id)." };
}

function vsWinrate(games, wins) {
  if (!games || games <= 0) return null;
  return Math.round((wins / games) * 1000) / 10; // un chiffre apres la virgule
}

export async function handleVersus(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "versus", 8000))) return;
  await interaction.deferReply();
  const a = await resolveVersusSide(interaction, "1", true);
  if (a.error) return interaction.editReply(a.error);
  const b = await resolveVersusSide(interaction, "2", false);
  if (b.error) return interaction.editReply(b.error);
  if (String(a.brawlhallaId) === String(b.brawlhallaId)) {
    return interaction.editReply("Choisis deux joueurs **différents** 😅");
  }

  let pa, pb;
  try {
    [pa, pb] = await Promise.all([getPlayerProfile(a.brawlhallaId), getPlayerProfile(b.brawlhallaId)]);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }

  const na = pa.name ?? a.label;
  const nb = pb.name ?? b.label;
  const wrA = vsWinrate(pa.games1v1, pa.wins1v1);
  const wrB = vsWinrate(pb.games1v1, pb.wins1v1);
  const gloryA = estimateGlory(pa)?.totalGlory ?? null;
  const gloryB = estimateGlory(pb)?.totalGlory ?? null;

  // Construit un tableau aligne (monospace) avec un marqueur sur le meilleur de chaque ligne.
  const rows = [];
  const addRow = (label, va, vb, rawA, rawB, higherWins = true) => {
    let mA = "  ";
    let mB = "  ";
    if (rawA != null && rawB != null && rawA !== rawB) {
      const aWins = higherWins ? rawA > rawB : rawA < rawB;
      if (aWins) mA = "▲ ";
      else mB = "▲ ";
    }
    rows.push(
      `${label.padEnd(11)}│ ${mA}${String(va).padEnd(10)}│ ${mB}${String(vb)}`,
    );
  };

  addRow("Niveau", pa.level || 0, pb.level || 0, pa.level || 0, pb.level || 0);
  addRow("Rating 1v1", pa.ratings["1v1"] || 0, pb.ratings["1v1"] || 0, pa.ratings["1v1"] || 0, pb.ratings["1v1"] || 0);
  addRow("Peak 1v1", pa.peak1v1 || 0, pb.peak1v1 || 0, pa.peak1v1 || 0, pb.peak1v1 || 0);
  addRow("Tier 1v1", pa.tiers["1v1"] ?? "—", pb.tiers["1v1"] ?? "—", null, null);
  addRow("Rating 2v2", pa.ratings["2v2"] || 0, pb.ratings["2v2"] || 0, pa.ratings["2v2"] || 0, pb.ratings["2v2"] || 0);
  addRow("Winrate", wrA != null ? `${wrA}%` : "—", wrB != null ? `${wrB}%` : "—", wrA, wrB);
  addRow("Glory est.", gloryA ?? "—", gloryB ?? "—", gloryA, gloryB);

  const header = `${"".padEnd(11)}│ ${na.slice(0, 10).padEnd(12)}│ ${nb.slice(0, 10)}`;
  const table = "```\n" + header + "\n" + "─".repeat(header.length) + "\n" + rows.join("\n") + "\n```";

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⚔️ ${na}  vs  ${nb}`)
    .setDescription(table)
    .setFooter({ text: "▲ = avantage sur la ligne · Glory = estimation" });

  return interaction.editReply({ embeds: [embed] });
}

async function respondProfile(interaction, view) {
  if (!(await enforceCooldown(interaction, "profile", 4000))) return;
  await interaction.deferReply();

  const idOpt = interaction.options.getInteger("id");
  const pseudo = interaction.options.getString("pseudo")?.trim();

  // Cas direct : Brawlhalla ID, ou membre/soi-meme lie -> profil direct (aucune recherche).
  if (idOpt || !pseudo) {
    const target = await resolveTarget(interaction);
    if (target.error) return interaction.editReply(target.error);
    return showProfile(interaction, view, target.brawlhallaId);
  }

  // Cas pseudo : on recherche, et s'il y a plusieurs candidats on laisse choisir.
  let players;
  try {
    players = await searchPlayers(pseudo);
  } catch (err) {
    return interaction.editReply(err.pending ? err.message : `Erreur API : ${err.message}`);
  }
  if (!players.length) return interaction.editReply(`Aucun joueur classé trouvé pour **${pseudo}**.`);
  if (players.length === 1) return showProfile(interaction, view, players[0].id);

  // Plusieurs joueurs (memes pseudos / pseudos proches) : on affiche un sélecteur.
  const row = new ActionRowBuilder().addComponents(
    players.slice(0, 5).map((pl) => {
      const btn = new ButtonBuilder()
        .setCustomId(`profpick:${view}:${pl.id}`)
        .setLabel(`${pl.username} — ${pl.tier ?? "?"} (${pl.region}, ${pl.rating})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
      const emoji = tierEmojiResolvable(pl.tier ? String(pl.tier).split(" ")[0] : null);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    }),
  );
  return interaction.editReply({
    content: `Plusieurs joueurs correspondent à **${pseudo}**. Choisis le bon :`,
    components: [row],
  });
}

// Charge le profil et affiche l'onglet demande (utilise par les commandes ET le sélecteur).
async function showProfile(interaction, view, brawlhallaId) {
  let p;
  try {
    p = await getPlayerProfile(brawlhallaId);
  } catch (err) {
    return interaction.editReply({ content: `Erreur API : ${err.message}`, embeds: [], components: [] });
  }
  const legends = await getLegends().catch(() => new Map());
  return interaction.editReply({
    content: "",
    embeds: [buildProfileEmbed(view, p, legends)],
    components: [profileNavRow(view, p.brawlhallaId)],
  });
}

export const handleStats = (interaction) => respondProfile(interaction, "overview");
export const handleRank = (interaction) => respondProfile(interaction, "ranked");
export const handleLegendes = (interaction) => respondProfile(interaction, "legends");
export const handleEquipe = (interaction) => respondProfile(interaction, "teams");

// Clic sur un candidat du sélecteur : ouvre la fiche de ce joueur dans l'onglet demande.
export async function handleProfilePick(interaction) {
  const [, view, idStr] = interaction.customId.split(":");
  await interaction.deferUpdate();
  return showProfile(interaction, view, Number(idStr));
}

// Clic sur un onglet : recharge le profil (cache -> instantane) et remplace l'embed.
export async function handleProfileNav(interaction) {
  const [, view, idStr] = interaction.customId.split(":");
  const brawlhallaId = Number(idStr);
  await interaction.deferUpdate();

  let p;
  try {
    p = await getPlayerProfile(brawlhallaId);
  } catch (err) {
    return interaction.editReply({ content: `Erreur API : ${err.message}`, embeds: [], components: [] });
  }
  const legends = await getLegends().catch(() => new Map());
  return interaction.editReply({
    embeds: [buildProfileEmbed(view, p, legends)],
    components: [profileNavRow(view, brawlhallaId)],
  });
}

export async function handleLeaderboard(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "leaderboard", 5000))) return;
  await interaction.deferReply();
  const mode = interaction.options.getString("mode") ?? "1v1";
  const region = interaction.options.getString("region") ?? "ALL";

  let rankings;
  try {
    rankings = await getRankings(mode, region, 1, 10);
  } catch (err) {
    return interaction.editReply(`Erreur API : ${err.message}`);
  }
  if (!rankings.length) return interaction.editReply("Aucun résultat.");

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rankings.slice(0, 10).map((r, i) => {
    const place = medals[i] ?? `**${i + 1}.**`;
    const name = mode === "2v2" ? r.teamname : r.players?.[0]?.username ?? r.name ?? "?";
    const t = r.tier ?? null;
    return `${place} ${name} — ${t ? `${tierEmoji(t)} ${t}` : "?"} (${r.rating})`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Leaderboard ${mode} — ${region}`)
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"));
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /ping ----------

export async function handlePing(interaction, ctx) {
  if (!(await enforceCooldown(interaction, "ping", 5000))) return;
  await interaction.deferReply();
  const r = await pingApi();

  const fmt = (c) =>
    c.ok ? `🟢 OK (${c.ms} ms)` : `🔴 ${c.status ? `HTTP ${c.status}` : c.error || "réseau"} (${c.ms} ms)`;

  const ws = interaction.client.ws.ping;
  const botTxt = ws >= 0 ? `${Math.round(ws)} ms` : "mesure en cours…";

  const allOk = r.leaderboard.ok && r.player.ok;
  const embed = new EmbedBuilder()
    .setTitle("🏓 Pong")
    .setColor(allOk ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: "API — leaderboard", value: fmt(r.leaderboard), inline: true },
      { name: "API — joueurs", value: fmt(r.player), inline: true },
      { name: "Latence bot (gateway)", value: botTxt, inline: false },
    );

  // Fiabilité observée depuis le démarrage (compteurs en mémoire).
  const mx = await getApiMetrics().catch(() => null);
  if (mx && mx.meaningful > 0) {
    const pct = (mx.successRate * 100).toFixed(0);
    const cd = mx.cooldownActiveMs > 0 ? ` · ⏳ cooldown ${Math.ceil(mx.cooldownActiveMs / 1000)}s` : "";
    const pending = mx.pendingProfiles + mx.pendingSearches;
    const idxAge = mx.index.ageMs != null ? `il y a ${Math.floor(mx.index.ageMs / 60000)} min` : "jamais";
    embed.addFields({
      name: "Fiabilité API (depuis le démarrage)",
      value:
        `✅ **${pct}%** de succès sur ${mx.meaningful} appels${cd}\n` +
        `↻ ${mx.retries} retries · ⛔ ${mx.rateLimited} rate-limit · 💥 ${mx.serverErrors} erreurs serveur · 📡 ${mx.networkErrors} réseau\n` +
        `📥 file de récup : **${pending}** · 🗂️ index local : **${mx.index.count}** joueurs (sync ${idxAge})`,
      inline: false,
    });
  }

  embed
    .setFooter({
      text: allOk
        ? "Tout est opérationnel."
        : "Si 'joueurs' est rouge mais 'leaderboard' vert, c'est une panne côté API Brawlhalla (pas le bot).",
    })
    .setTimestamp(new Date());
  return interaction.editReply({ embeds: [embed] });
}

// ---------- /help ----------

export async function handleHelp(interaction, ctx) {
  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("🐾 Aide — les commandes essentielles")
    .setDescription("Voici l'essentiel pour bien démarrer. La plupart des commandes acceptent un **membre**, un **pseudo** ou un **Brawlhalla ID**.")
    .addFields(
      {
        name: "🎮 Ton compte",
        value: [
          "`/lier` — Relie ton compte Brawlhalla et reçois tes **rôles de rank** automatiquement.",
          "`/delier` — Retire la liaison de ton compte.",
        ].join("\n"),
      },
      {
        name: "📊 Tes stats",
        value: [
          "`/carte` — Ta **carte profil** en image (rank, winrate, main, Glory).",
          "`/rank` — Le détail de ton **Ranked** 1v1 & 2v2.",
          "`/stats` — Ta **fiche complète** (légendes, équipes…).",
          "`/progression` — La **courbe** de ton rating au fil du temps.",
          "`/versus` — **Compare-toi** à un autre joueur.",
        ].join("\n"),
      },
      {
        name: "🏆 Classements",
        value: [
          "`/top` — Classement des **membres liés** du serveur.",
          "`/leaderboard` — Le **top 10 officiel** Brawlhalla.",
          "`/niveau` · `/classement-niveaux` — Ton **XP** et le top du serveur.",
        ].join("\n"),
      },
      {
        name: "🎟️ Tournoi",
        value: "`/bracket` — Affiche le **bracket** du tournoi en cours.",
      },
    )
    .setFooter({ text: "Astuce : commence par /lier pour débloquer tes rôles et tes stats." });

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}
