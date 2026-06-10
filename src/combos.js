/**
 * True combos Brawlhalla — données BrawlDatabase (https://www.brawldatabase.com).
 * - loadCombos / combosFor / weaponsWithCombos : lecture du dataset
 * - refreshCombos : (re)scrape depuis BrawlDB et écrit data/combos.json
 * - buildCombosMessage : payload Discord (vidéo + stats + menu arme + navigation)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "..", "data", "combos.json");
const BASE = "https://www.brawldatabase.com";
const MAX_ID = 240;
const CONCURRENCY = 10;
const HEADERS = { "HX-Request": "true", "User-Agent": "Mozilla/5.0 (combo-fetcher)" };

// slug d'arme BrawlDB -> libellé FR + emoji.
export const WEAPON_META = {
  sword: { label: "Épée", emoji: "🗡️" },
  hammer: { label: "Marteau", emoji: "🔨" },
  blasters: { label: "Blasters", emoji: "🔫" },
  lance: { label: "Lance", emoji: "🐎" },
  spear: { label: "Spear", emoji: "🔱" },
  katars: { label: "Katars", emoji: "🐾" },
  axe: { label: "Hache", emoji: "🪓" },
  bow: { label: "Arc", emoji: "🏹" },
  gauntlets: { label: "Gantelets", emoji: "🥊" },
  scythe: { label: "Faux", emoji: "☠️" },
  cannon: { label: "Canon", emoji: "💣" },
  orb: { label: "Orbe", emoji: "🔮" },
  greatsword: { label: "Grande épée", emoji: "⚔️" },
  battle_boots: { label: "Bottes", emoji: "🥾" },
  unarmed: { label: "Mains nues", emoji: "✊" },
  chakram: { label: "Chakram", emoji: "💫" },
};

export const weaponLabel = (slug) => WEAPON_META[slug]?.label || slug;
export const weaponEmoji = (slug) => WEAPON_META[slug]?.emoji || "⚔️";

let cache = null;
let meta = { scrapedAt: null };

export async function loadCombos() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(DATA, "utf8"));
    cache = Array.isArray(raw.combos) ? raw.combos : [];
    meta.scrapedAt = raw.scrapedAt || null;
  } catch {
    cache = [];
  }
  return cache;
}

export async function combosInfo() {
  const combos = await loadCombos();
  const byWeapon = {};
  for (const c of combos) byWeapon[c.weapon] = (byWeapon[c.weapon] || 0) + 1;
  return { count: combos.length, scrapedAt: meta.scrapedAt, byWeapon };
}

export async function weaponsWithCombos() {
  const combos = await loadCombos();
  const present = new Set(combos.map((c) => c.weapon));
  return Object.keys(WEAPON_META).filter((w) => present.has(w));
}

export async function combosFor(weapon) {
  const combos = await loadCombos();
  return combos.filter((c) => c.weapon === weapon);
}

// ---------- Scrape / refresh ----------
const decodeHtml = (s) =>
  (s || "")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function fetchCombo(id) {
  let res;
  try {
    res = await fetch(`${BASE}/combos/${id}/`, { headers: HEADERS });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  const t = await res.text();
  const vid = t.match(/\/media\/combos\/([\w-]+)\/(\d+)\.mp4/);
  if (!vid) return null;
  const weapon = vid[1];
  const notationRaw = (t.match(/combo--viewer__header[\s\S]*?<h1>([\s\S]*?)<\/h1>/) || [])[1] || "";
  const notation = decodeHtml(
    notationRaw.replace(/<span class="modifier">(.*?)<\/span>/g, "[$1]").replace(/<[^>]+>/g, ""),
  );
  if (!notation) return null;
  const desc = (t.match(/og:description" content="([^"]*)"/) || [])[1] || "";
  const stats = desc.match(/Usability:\s*(\d+)\s*\|\s*Damage Range:\s*(.+?)\s*\|\s*Dexterity:\s*(.+?)\s*\|\s*Average Damage:\s*(\d+)/);
  return {
    id,
    weapon,
    notation,
    usability: stats ? Number(stats[1]) : 0,
    damage: stats ? stats[2].trim() : "—",
    dexterity: stats ? stats[3].trim() : "Any",
    avgDamage: stats ? Number(stats[4]) : 0,
    video: `${BASE}/media/combos/${weapon}/${id}.mp4`,
    url: `${BASE}/combos/${id}/`,
  };
}

// Re-scrape BrawlDB et réécrit data/combos.json. Renvoie { count, byWeapon }.
export async function refreshCombos() {
  const ids = Array.from({ length: MAX_ID }, (_, i) => i + 1);
  const combos = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchCombo));
    for (const c of results) if (c) combos.push(c);
  }
  combos.sort((a, b) => a.weapon.localeCompare(b.weapon) || b.usability - a.usability || a.id - b.id);
  const scrapedAt = new Date().toISOString();
  await mkdir(dirname(DATA), { recursive: true });
  await writeFile(DATA, JSON.stringify({ source: BASE, scrapedAt, combos }, null, 2));
  cache = combos; // recharge le cache à chaud
  meta.scrapedAt = scrapedAt;
  const byWeapon = {};
  for (const c of combos) byWeapon[c.weapon] = (byWeapon[c.weapon] || 0) + 1;
  return { count: combos.length, byWeapon };
}

// ---------- Payload Discord (partagé commande + dashboard) ----------
export async function buildCombosMessage(weapon, index) {
  const list = await combosFor(weapon);
  if (!list.length) return { content: "Aucun combo pour cette arme.", embeds: [], components: [], files: [], attachments: [] };
  const i = Math.max(0, Math.min(Number(index) || 0, list.length - 1));
  const c = list[i];
  const weapons = await weaponsWithCombos();

  const embed = {
    color: 0xf1c40f,
    title: `${weaponEmoji(weapon)} ${weaponLabel(weapon)} — ${c.notation}`,
    url: c.url,
    fields: [
      { name: "🎯 Facilité", value: `${c.usability}/10`, inline: true },
      { name: "💥 Dégâts", value: String(c.damage), inline: true },
      { name: "✋ Dextérité", value: String(c.dexterity), inline: true },
      { name: "📊 Dégâts moyens", value: String(c.avgDamage), inline: true },
    ],
    footer: { text: `Combo ${i + 1}/${list.length} · trié par facilité · source BrawlDatabase.com` },
  };
  const menu = {
    type: 3,
    custom_id: "cb_weapon",
    placeholder: `${weaponLabel(weapon)} — choisir une arme`,
    options: weapons.map((w) => ({ label: weaponLabel(w), value: w, emoji: { name: weaponEmoji(w) }, default: w === weapon })),
  };
  const nav = {
    type: 1,
    components: [
      { type: 2, style: 2, custom_id: `cb_nav:${weapon}:${i - 1}`, label: "◀", disabled: i === 0 },
      { type: 2, style: 2, custom_id: "cb_count", label: `${i + 1}/${list.length}`, disabled: true },
      { type: 2, style: 2, custom_id: `cb_nav:${weapon}:${i + 1}`, label: "▶", disabled: i >= list.length - 1 },
      { type: 2, style: 5, label: "BrawlDB", url: c.url },
    ],
  };

  // On télécharge la vidéo et on la JOINT au message : Discord la lit inline,
  // contrairement à un simple lien (qui n'est pas déroulé quand un embed est présent).
  let files = [];
  let content = "";
  try {
    const r = await fetch(c.video, { headers: { "User-Agent": "Mozilla/5.0 (combo-fetcher)" } });
    if (r.ok) {
      files = [{ attachment: Buffer.from(await r.arrayBuffer()), name: `${weapon}-${c.id}.mp4` }];
    } else {
      content = c.video;
    }
  } catch {
    content = c.video; // fallback : au moins le lien
  }

  return {
    content,
    embeds: [embed],
    components: [{ type: 1, components: [menu] }, nav],
    files,
    allowedMentions: { parse: [] },
  };
}

