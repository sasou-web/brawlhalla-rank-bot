import { ChannelType, PermissionFlagsBits } from "discord.js";
import { TIERS, tierIndex, roleName, TOP_ROLE_NAME } from "./config.js";

// Emojis unicode pour les NOMS de salons (les emojis custom ne s'affichent pas dans un nom de salon).
const VOICE_TIER_EMOJI = {
  Tin: "⚫",
  Bronze: "🟤",
  Silver: "⚪",
  Gold: "🟡",
  Platinum: "🟦",
  Diamond: "🔷",
  Valhallan: "🟣",
};

/**
 * Cree (ou met a jour) un salon vocal par rank dans une categorie.
 * Acces : seuls les membres ayant un role de rank EGAL OU SUPERIEUR au tier du vocal
 * peuvent se connecter (donc Valhallan accede a tout). @everyone ne peut pas se connecter.
 * Comme les roles de rank ne s'obtiennent que via /lier (verifie via l'API), impossible de tricher.
 *
 * @param {Guild} guild - serveur discord.js
 * @param {{ categoryId: string, rangMin?: string, limite?: number }} opts
 * @returns {{ categoryName, created: string[], updated: string[], failed: number }}
 */
export async function setupRankVoiceChannels(guild, { categoryId, rangMin = "Bronze", limite = 0 } = {}) {
  const category =
    guild.channels.cache.get(categoryId) || (await guild.channels.fetch(categoryId).catch(() => null));
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error("Catégorie introuvable ou invalide.");
  }

  await guild.roles.fetch();
  const roleByName = (name) => guild.roles.cache.find((r) => r.name === name) || null;

  const everyoneId = guild.roles.everyone.id;
  const minIdx = Math.max(0, tierIndex(rangMin));
  const topRole = roleByName(TOP_ROLE_NAME);
  const limit = Math.max(0, Math.min(99, Number(limite) || 0));

  const created = [];
  const updated = [];
  let failed = 0;

  // Un vocal par tier, du plus bas (rangMin) au plus haut (Valhallan).
  for (let i = minIdx; i < TIERS.length; i++) {
    const tier = TIERS[i];

    // Roles autorises a se connecter : tous les rangs >= ce tier (1v1 ET 2v2) + Top 100.
    const allowRoleIds = [];
    for (let j = i; j < TIERS.length; j++) {
      for (const mode of ["1v1", "2v2"]) {
        const r = roleByName(roleName(mode, TIERS[j]));
        if (r) allowRoleIds.push(r.id);
      }
    }
    if (topRole) allowRoleIds.push(topRole.id);

    const overwrites = [
      { id: everyoneId, deny: [PermissionFlagsBits.Connect] },
      ...allowRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.Connect] })),
    ];

    const emoji = VOICE_TIER_EMOJI[tier] ?? "🔊";
    const name = tier === "Valhallan" ? `${emoji} Valhallan` : `${emoji} ${tier}+`;

    const existing = guild.channels.cache.find(
      (c) => c.parentId === category.id && c.type === ChannelType.GuildVoice && c.name === name,
    );

    try {
      if (existing) {
        await existing.permissionOverwrites.set(overwrites, "Maj vocal de rank");
        if (limit) await existing.setUserLimit(limit).catch(() => {});
        updated.push(name);
      } else {
        await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: limit || 0,
          permissionOverwrites: overwrites,
          reason: `Vocal de rank (${tier}+) — accès vérifié par le bot`,
        });
        created.push(name);
      }
    } catch {
      failed++;
    }
  }

  return { categoryName: category.name, created, updated, failed };
}

// Resume lisible (pour la reponse de la commande slash et le toast du dashboard).
export function rankVoiceSummary({ categoryName, created, updated, failed }) {
  return [
    `🎙️ **Vocaux de rank** dans **${categoryName}** :`,
    created.length ? `✅ Créés : ${created.join(", ")}` : null,
    updated.length ? `🔁 Mis à jour : ${updated.join(", ")}` : null,
    failed ? `⚠️ ${failed} salon(s) en échec (le bot a-t-il **Gérer les salons** et un rôle assez haut ?).` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
