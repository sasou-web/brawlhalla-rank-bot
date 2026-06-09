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
  };
}

export async function setSetting(key, value) {
  await load();
  cache[key] = value;
  await save();
}
