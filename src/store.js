import { loadDoc, saveDoc } from "./db.js";

const KEY = "links";

/**
 * Structure : { [discordUserId]: { brawlhallaId, name, tiers, rating1v1, updatedAt } }
 * Persisté dans SQLite (clé "links") via db.js.
 */
async function readAll() {
  return loadDoc(KEY, {});
}

async function writeAll(data) {
  saveDoc(KEY, data);
}

export async function setLink(discordUserId, brawlhallaId, name, extra = {}) {
  const data = await readAll();
  data[discordUserId] = {
    brawlhallaId,
    name,
    ...extra,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(data);
}

export async function removeLink(discordUserId) {
  const data = await readAll();
  const existed = Boolean(data[discordUserId]);
  delete data[discordUserId];
  await writeAll(data);
  return existed;
}

export async function getLink(discordUserId) {
  const data = await readAll();
  return data[discordUserId] ?? null;
}

/**
 * Renvoie l'ID Discord deja lie a ce Brawlhalla ID, ou null si personne.
 * Sert au controle d'unicite (un compte Brawlhalla = un seul membre).
 */
export async function findUserByBrawlhallaId(brawlhallaId) {
  const data = await readAll();
  const id = Number(brawlhallaId);
  for (const [discordUserId, link] of Object.entries(data)) {
    if (Number(link.brawlhallaId) === id) return discordUserId;
  }
  return null;
}

export async function getAllLinks() {
  return readAll();
}
