import { loadDoc, saveDoc } from "./db.js";

const KEY = "links";

/**
 * Structure : { [discordUserId]: { brawlhallaId, name, tiers, rating1v1, updatedAt } }
 * Persisté dans SQLite (clé "links") via db.js.
 *
 * Le document est gardé en cache mémoire (source de vérité unique : aucun autre module
 * n'écrit la clé "links") et les écritures passent par une chaîne sérialisée. Ça évite le
 * read-modify-write concurrent : deux liaisons/déliaisons simultanées ne s'écrasent plus
 * mutuellement, et chaque écriture est O(1) côté logique (plus de re-parse du blob).
 */

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (!cache) cache = loadDoc(KEY, {});
  return cache;
}

// Chaîne d'écritures : deux sauvegardes ne se chevauchent jamais.
function enqueueWrite() {
  const doWrite = () => saveDoc(KEY, cache);
  writeChain = writeChain.then(doWrite, doWrite);
  return writeChain;
}

export async function setLink(discordUserId, brawlhallaId, name, extra = {}) {
  const data = load();
  data[discordUserId] = {
    brawlhallaId,
    name,
    ...extra,
    updatedAt: new Date().toISOString(),
  };
  await enqueueWrite();
}

/**
 * Fin de saison, ranked 3v3 : efface le pic 3v3 de la saison close et la date du dernier rank
 * 3v3 vu (le rank 3v3 n'est donc plus reporté 24 h dans la nouvelle saison). Renvoie le
 * nombre de liaisons modifiées.
 */
export async function clearSeason3v3() {
  const data = load();
  let changed = 0;
  for (const link of Object.values(data)) {
    if (!link.peakTiers?.["3v3"] && !link.ranked3v3SeenAt) continue;
    if (link.peakTiers) link.peakTiers = { ...link.peakTiers, "3v3": null };
    link.ranked3v3SeenAt = null;
    changed++;
  }
  if (changed) await enqueueWrite();
  return changed;
}

export async function removeLink(discordUserId) {
  const data = load();
  const existed = Boolean(data[discordUserId]);
  delete data[discordUserId];
  await enqueueWrite();
  return existed;
}

export async function getLink(discordUserId) {
  const data = load();
  return data[discordUserId] ?? null;
}

/**
 * Renvoie l'ID Discord deja lie a ce Brawlhalla ID, ou null si personne.
 * Sert au controle d'unicite (un compte Brawlhalla = un seul membre).
 */
export async function findUserByBrawlhallaId(brawlhallaId) {
  const data = load();
  const id = Number(brawlhallaId);
  for (const [discordUserId, link] of Object.entries(data)) {
    if (Number(link.brawlhallaId) === id) return discordUserId;
  }
  return null;
}

export async function getAllLinks() {
  // Copie défensive : les appelants itèrent/agrègent dessus, on protège le cache d'une
  // mutation externe accidentelle.
  return structuredClone(load());
}
