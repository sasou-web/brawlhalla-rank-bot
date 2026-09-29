/**
 * /combos et viewer privé des combos : navigation (arme, combo), ralenti x0.25 et
 * progression « Je maîtrise » (XP une fois par combo, succès).
 *
 * customIds :
 *   cbp_open                 (select du panneau public)   → nouvel affichage privé
 *   cbp_weapon / cbp_pick:<w> (selects du viewer)          → mise à jour du viewer
 *   cbp_slow:<w>:<id>:<1|0>  (bouton)                      → ralenti activé / désactivé
 *   cbp_master:<w>:<id>:<s>  (bouton, s = ralenti affiché) → coche / décoche le combo
 */
import { webConfig } from "../config.js";
import { loadCombos, weaponsWithCombos, buildComboViewer, comboById } from "../combos.js";
import { masteredSet, toggleMastery, claimMasteryXp, masteryStats, MASTERY_XP, MASTERY_XP_DAILY } from "../comboMastery.js";
import { addBonusXp } from "../levels.js";
import { handleLevelUp } from "../xpEvents.js";
import { grantAndAnnounce } from "../achievements.js";
import { EPHEMERAL, EPHEMERAL_V2 } from "./shared.js";
import { enforceCooldown } from "./cooldowns.js";

// Contexte du viewer pour ce membre : progression (sur un serveur) + lien Combo Lab
// (uniquement si le dashboard tourne réellement : sinon le lien mènerait nulle part).
function viewerOpts(interaction, extra = {}) {
  return {
    mastered: interaction.guildId ? masteredSet(interaction.guildId, interaction.user.id) : null,
    labBaseUrl: webConfig.enabled() ? webConfig.publicUrl : "",
    ...extra,
  };
}

const updateViewer = async (interaction, weapon, id, extra) =>
  interaction.editReply({ ...(await buildComboViewer(weapon, id, viewerOpts(interaction, extra))), attachments: [] });

// ---------- /combos ----------

export async function handleCombos(interaction) {
  if (!(await enforceCooldown(interaction, "combos", 5000))) return;
  const combos = await loadCombos();
  if (!combos.length) {
    return interaction.reply({ content: "La base de combos est vide. Un admin doit la mettre à jour depuis le dashboard (section Combos) ou lancer `node scripts/scrape-combos.js`.", flags: EPHEMERAL });
  }
  const opt = interaction.options.getString("arme");
  const weapons = await weaponsWithCombos();
  const weapon = opt && weapons.includes(opt) ? opt : weapons[0];
  await interaction.deferReply({ flags: EPHEMERAL_V2 }); // affichage privé V2 + le téléchargement vidéo peut dépasser 3s
  return interaction.editReply(await buildComboViewer(weapon, null, viewerOpts(interaction)));
}

// Panneau public : ouvre un affichage PRIVÉ par utilisateur (usage simultané sans conflit).
export async function handleCombosOpen(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL_V2 });
  return interaction.editReply(await buildComboViewer(interaction.values[0], null, viewerOpts(interaction)));
}

// Dans l'affichage privé : changer d'arme.
export async function handleCombosWeapon(interaction) {
  await interaction.deferUpdate();
  return updateViewer(interaction, interaction.values[0], null);
}

// Dans l'affichage privé : choisir un combo par son nom.
export async function handleCombosPick(interaction) {
  const weapon = interaction.customId.split(":")[1];
  await interaction.deferUpdate();
  return updateViewer(interaction, weapon, interaction.values[0]);
}

// ---------- Ralenti x0.25 ----------

export async function handleCombosSlow(interaction) {
  const [, weapon, id, flag] = interaction.customId.split(":");
  const slow = flag === "1";
  // L'encodage coûte du CPU : cooldown court, uniquement pour activer le ralenti.
  if (slow && !(await enforceCooldown(interaction, "combos_slow", 3000))) return;
  await interaction.deferUpdate();
  return updateViewer(interaction, weapon, id, { slow });
}

// ---------- « Je maîtrise ce combo » ----------

export async function handleCombosMaster(interaction) {
  const [, weapon, id, slowFlag] = interaction.customId.split(":");
  if (!interaction.guildId) {
    return interaction.reply({ content: "La progression n'est disponible que sur le serveur.", flags: EPHEMERAL });
  }
  const combo = await comboById(id);
  if (!combo || combo.weapon !== weapon) {
    return interaction.reply({ content: "Ce combo n'existe plus dans la base. Rouvre `/combos`.", flags: EPHEMERAL });
  }
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const nowMastered = toggleMastery(guildId, userId, combo);
  const notes = [];

  if (!nowMastered) {
    notes.push("↩️ Retiré de tes combos maîtrisés.");
  } else {
    // XP : une seule fois par combo, plafonnée par jour (la maîtrise est déclarative).
    const claim = claimMasteryXp(guildId, userId, combo.id);
    if (claim === "granted") {
      const r = await addBonusXp(guildId, userId, MASTERY_XP).catch(() => null);
      if (r?.gain > 0) notes.push(`✨ **+${r.gain} XP** pour ce nouveau combo maîtrisé !`);
      else notes.push("✅ Combo ajouté à ta progression.");
      if (r?.leveledUp && interaction.guild) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        handleLevelUp(interaction.guild, member, r.level, r.oldLevel, null).catch(() => {});
      }
    } else if (claim === "limit") {
      notes.push(`✅ Combo ajouté à ta progression. Limite d'XP du jour atteinte (${MASTERY_XP_DAILY} combos récompensés par jour).`);
    } else {
      notes.push("✅ Combo ajouté à ta progression.");
    }

    // Succès liés à la progression (annoncés dans le salon des succès, sans ping).
    if (interaction.guild) {
      const stats = masteryStats(masteredSet(guildId, userId), await loadCombos());
      const fresh = await grantAndAnnounce(interaction.guild, userId, { combos: stats.count, weaponsCompleted: stats.weaponsCompleted }).catch(() => []);
      if (fresh?.length) notes.push(`🏅 Succès débloqué : ${fresh.map((a) => `${a.emoji} **${a.name}**`).join(", ")}`);
    }
  }

  return updateViewer(interaction, weapon, combo.id, { slow: slowFlag === "1", notice: notes.join("\n") });
}
