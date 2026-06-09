import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}. Verifie ton fichier .env.`);
  }
  return value;
}

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  guildId: required("GUILD_ID"),
  refreshIntervalMinutes: Number(process.env.REFRESH_INTERVAL_MINUTES || 60),
  // Synchro de l'index local du leaderboard (recherche instantanee facon Raybot).
  // Pages de 50 joueurs : 500 pages = top ~25 000 classes 1v1. Mets 0 pour desactiver.
  leaderboardSyncPages: Number(process.env.LEADERBOARD_SYNC_PAGES || 500),
  leaderboardSyncIntervalMinutes: Number(process.env.LEADERBOARD_SYNC_INTERVAL_MINUTES || 180),
  // Salon ou sont envoyees les demandes de validation (vide = liaison directe sans modo).
  reviewChannelId: process.env.REVIEW_CHANNEL_ID || "",
  // Role autorise a valider/refuser (vide = permission "Manage Guild" requise a la place).
  reviewerRoleId: process.env.REVIEWER_ROLE_ID || "",
};

// Configuration du dashboard web (optionnel : actif seulement si CLIENT_SECRET est defini).
export const webConfig = {
  port: Number(process.env.WEB_PORT || 3000),
  clientSecret: process.env.CLIENT_SECRET || "",
  // URL publique du dashboard (ex: http://91.98.17.48:3000). Sert a construire le redirect OAuth.
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  // Secret pour signer les cookies de session (mets une longue chaine aleatoire).
  sessionSecret: process.env.SESSION_SECRET || "",
  enabled() {
    return Boolean(this.clientSecret && this.publicUrl && this.sessionSecret);
  },
};

// Tiers de base Brawlhalla, du plus bas au plus haut.
export const TIERS = ["Tin", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Valhallan"];

// Base de l'API officielle Brawlhalla v1 (sans cle API depuis la v1.0).
export const BH_API_BASE = "https://api.brawlhalla.com/v1";

// Seuils de rating -> tier (repris de corehalla/bhapi constants.ts).
// Tries du plus haut au plus bas pour trouver le premier seuil atteint.
export const RANKED_TIERS = [
  ["Diamond", 2000],
  ["Platinum 5", 1936],
  ["Platinum 4", 1872],
  ["Platinum 3", 1808],
  ["Platinum 2", 1744],
  ["Platinum 1", 1680],
  ["Gold 5", 1622],
  ["Gold 4", 1564],
  ["Gold 3", 1506],
  ["Gold 2", 1448],
  ["Gold 1", 1390],
  ["Silver 5", 1338],
  ["Silver 4", 1286],
  ["Silver 3", 1234],
  ["Silver 2", 1182],
  ["Silver 1", 1130],
  ["Bronze 5", 1086],
  ["Bronze 4", 1042],
  ["Bronze 3", 998],
  ["Bronze 2", 954],
  ["Bronze 1", 910],
  ["Tin 5", 872],
  ["Tin 4", 834],
  ["Tin 3", 796],
  ["Tin 2", 758],
  ["Tin 1", 720],
  ["Tin 0", 200],
];

// Couleur (hex) associee a chaque tier pour la creation automatique des roles.
export const TIER_COLORS = {
  Tin: 0x9d9d9d,
  Bronze: 0xb08d57,
  Silver: 0xc0c0c0,
  Gold: 0xf1c40f,
  Platinum: 0x4aa3a3,
  Diamond: 0x4ea1ff,
  Valhallan: 0x9b59b6,
};

// Emojis custom du serveur, par tier de base. { name, id } d'un emoji applicatif/serveur.
// Tin n'a pas d'emoji custom : repli sur un emoji unicode (voir tierEmoji).
export const TIER_EMOJIS = {
  Bronze: { name: "bronze", id: "1513640373501693962" },
  Silver: { name: "silver", id: "1513640320657522819" },
  Gold: { name: "gold", id: "1513640421727797392" },
  Platinum: { name: "platinum", id: "1513640443601092800" },
  Diamond: { name: "diamond", id: "1513640466216779906" },
  Valhallan: { name: "valhallan", id: "1513640484067737723" },
};

// Repli unicode quand aucun emoji custom n'existe (Tin) ou tier inconnu.
const TIER_EMOJI_FALLBACK = { Tin: "⚫" };

// Chaine d'emoji a inserer dans un message/embed pour un tier de base ("Gold", "Tin"...).
// Renvoie "" si rien de pertinent (pour ne pas polluer l'affichage).
export function tierEmojiText(tier) {
  const e = TIER_EMOJIS[tier];
  if (e) return `<:${e.name}:${e.id}>`;
  return TIER_EMOJI_FALLBACK[tier] ?? "";
}

// Forme resolvable pour ButtonBuilder.setEmoji() (objet {id}/unicode), ou null.
export function tierEmojiResolvable(tier) {
  const e = TIER_EMOJIS[tier];
  if (e) return { id: e.id, name: e.name };
  return TIER_EMOJI_FALLBACK[tier] ?? null;
}

// Prefixes des noms de roles crees/geres par le bot.
export const ROLE_PREFIX = {
  "1v1": "1v1",
  "2v2": "2v2",
};

// Construit le nom de role attendu, ex: "1v1 Gold".
export function roleName(mode, tier) {
  return `${ROLE_PREFIX[mode]} ${tier}`;
}

// ---------- ROLES DE REGION ----------
// Regions Brawlhalla (codes renvoyes par l'API) -> libelle lisible pour le role.
export const REGION_LABELS = {
  "US-E": "US-East",
  "US-W": "US-West",
  EU: "Europe",
  SEA: "SEA",
  BRZ: "Brésil",
  AUS: "Océanie",
  JPN: "Japon",
  SA: "Afrique du Sud",
  ME: "Moyen-Orient",
};
export const REGIONS = Object.keys(REGION_LABELS);
export const REGION_ROLE_COLOR = 0x1abc9c;

// Nom du role de region a partir du code API (ex: "EU" -> "🌍 Europe").
export function regionRoleName(region) {
  const label = REGION_LABELS[region] || region;
  return `🌍 ${label}`;
}

// Nom du role validateur cree automatiquement au demarrage.
export const VALIDATOR_ROLE_NAME = "🛡️ Valideur de Rank";

// Tier d'auto-validation par defaut : tout ce qui est <= ce tier est valide automatiquement.
export const DEFAULT_AUTO_APPROVE_TIER = "Platinum";

// Index d'un tier dans l'echelle (Tin=0 ... Valhallan=6). -1 si inconnu/null.
export function tierIndex(tier) {
  return tier ? TIERS.indexOf(tier) : -1;
}

// Tier le plus haut entre 1v1 et 2v2 (ou null si aucun).
export function highestTier(tiers) {
  let best = null;
  let bestIdx = -1;
  for (const t of Object.values(tiers || {})) {
    const idx = tierIndex(t);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = t;
    }
  }
  return best;
}

// Role "Top mondial" 1v1.
export const TOP_ROLE_NAME = "Top 100 (1v1)";
export const TOP_RANK_MAX = 100;
export const TOP_ROLE_COLOR = 0xffd700;

// Role "n°1 du serveur" : attribue au membre lie ayant le plus haut rating 1v1 du serveur.
// Gere a part (pas dans managedRoleNames) car calcule globalement, pas par membre.
export const TOP_SERVER_ROLE_NAME = "👑 N°1 du serveur";
export const TOP_SERVER_ROLE_COLOR = 0xffc300;

// Role "main legende" : un role par legende, cree A LA DEMANDE (prefixe commun), attribue
// a la legende la plus jouee du membre. Gere a part (echange a chaque synchro).
export const MAIN_LEGEND_ROLE_PREFIX = "🗡️ Main: ";
export const MAIN_LEGEND_ROLE_COLOR = 0xe056fd;
// Nombre minimal de games sur une legende pour qu'elle soit consideree comme "main".
export const MAIN_LEGEND_MIN_GAMES = 10;

// Detection de smurf : on alerte le staff si le rating 1v1 d'un membre fait un bond
// >= ce seuil entre deux synchros (climb anormalement rapide).
export const SMURF_JUMP_THRESHOLD = 300;

// ---------- Roles de NIVEAU DE SERVEUR (XP de chat/vocal) ----------
// Paliers du systeme d'XP. Noms volontairement neutres ("Niveau X") pour ne PAS
// les confondre avec les rangs Brawlhalla. La palette de couleurs rappelle le jeu
// (degrade gris -> bronze -> argent -> or -> turquoise -> bleu -> violet).
// Geres par le systeme de recompenses de niveaux (levels.js), PAS par le sync de rank.
export const SERVER_LEVEL_TIERS = [
  { level: 5, name: "Niveau 5", color: 0x9d9d9d },
  { level: 10, name: "Niveau 10", color: 0xb08d57 },
  { level: 20, name: "Niveau 20", color: 0xc0c0c0 },
  { level: 35, name: "Niveau 35", color: 0xf1c40f },
  { level: 50, name: "Niveau 50", color: 0x4aa3a3 },
  { level: 70, name: "Niveau 70", color: 0x4ea1ff },
  { level: 100, name: "Niveau 100", color: 0x9b59b6 },
];
