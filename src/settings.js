import { config, DEFAULT_AUTO_APPROVE_TIER } from "./config.js";
import { loadDoc, saveDoc } from "./db.js";

const KEY = "settings";
let cache = null;

async function load() {
  if (cache) return cache;
  cache = loadDoc(KEY, {});
  return cache;
}

async function save() {
  saveDoc(KEY, cache);
}

/**
 * Reglages effectifs : valeurs definies via /setup, sinon valeurs du .env, sinon defaut.
 */
export async function getSettings() {
  const s = await load();
  return {
    reviewChannelId: s.reviewChannelId || config.reviewChannelId || "",
    reviewerRoleId: s.reviewerRoleId || config.reviewerRoleId || "",
    auditChannelId: s.auditChannelId || "",
    announceChannelId: s.announceChannelId || "",
    alertChannelId: s.alertChannelId || "",
    autoApproveTier: s.autoApproveTier || DEFAULT_AUTO_APPROVE_TIER,
    validatorRoleId: s.validatorRoleId || "",
    // Salon dédié aux annonces de succès/achievements (vide = pas d'annonce).
    achievementsChannelId: s.achievementsChannelId || "",
    // Numéro de saison courant (incrémenté à chaque /reset-saison).
    season: s.season || 1,
    // Dernier récap hebdo de progression posté (ms epoch). 0 = jamais.
    lastWeeklyRecapTs: s.lastWeeklyRecapTs || 0,
    // Validation par preuve (screenshot) pour les hauts rangs : à partir de `proofTier`,
    // un fil privé est créé où le joueur poste une capture de son profil en jeu (ID visible).
    requireProofScreenshot: s.requireProofScreenshot ?? true,
    proofTier: s.proofTier || "Diamond",
  };
}

export async function setSetting(key, value) {
  await load();
  cache[key] = value;
  await save();
}
