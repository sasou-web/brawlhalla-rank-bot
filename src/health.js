import { getSettings } from "./settings.js";
import { pingApi } from "./brawlhalla.js";

/**
 * Surveillance/alertes : prévient un salon admin si le bot redémarre, perd la
 * connexion Discord, ou si l'API Brawlhalla devient injoignable (et au rétablissement).
 * Le salon cible = alertChannelId (sinon repli sur auditChannelId).
 */

let clientRef = null;
let apiDown = false;
let healthTimer = null;
let lastApiCheckTs = 0;
const API_CHECK_MS = 10 * 60 * 1000; // 10 min

/**
 * Instantané de santé, consommé par l'endpoint public /health du dashboard.
 * Ne renvoie QUE des informations non sensibles (pas de nom de serveur, pas de
 * compteur de membres, aucune donnée de membre) : l'endpoint est sans authentification.
 */
export function healthSnapshot() {
  const client = clientRef;
  const connected = Boolean(client?.isReady?.());
  const ping = connected ? client.ws.ping : -1;
  return {
    discordConnected: connected,
    // discord.js renvoie -1 tant que le heartbeat n'a pas eu lieu.
    wsPingMs: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null,
    apiDown,
    lastApiCheckTs: lastApiCheckTs || null,
  };
}

/** Envoie un message au salon d'alerte (best-effort, ne lève jamais). */
export async function notifyAdmin(content) {
  try {
    if (!clientRef) return;
    const s = await getSettings();
    const channelId = s.alertChannelId || s.auditChannelId;
    if (!channelId) return;
    const ch = await clientRef.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
  } catch {
    /* best-effort : la surveillance ne doit jamais casser le bot */
  }
}

async function checkApi() {
  try {
    const r = await pingApi();
    lastApiCheckTs = Date.now();
    const ok = r.leaderboard.ok || r.player.ok;
    if (!ok && !apiDown) {
      apiDown = true;
      await notifyAdmin("⚠️ **API Brawlhalla injoignable** — `/lier`, `/stats` et le refresh des rôles peuvent échouer. Je préviendrai au rétablissement.");
    } else if (ok && apiDown) {
      apiDown = false;
      await notifyAdmin("✅ **API Brawlhalla rétablie.**");
    }
  } catch {
    /* ignore : on réessaiera au prochain tick */
  }
}

/**
 * Branche la surveillance sur le client. À appeler une seule fois (au ready).
 * Pose les écouteurs de connexion Discord et démarre la boucle de healthcheck API.
 */
export function initHealth(client) {
  if (clientRef) return; // déjà initialisé
  clientRef = client;

  // Anti-spam : on n'alerte que si la coupure dure (vraie panne), pas sur les
  // micro-reconnexions gateway normales. Et on ne poste "rétablie" que si on a
  // réellement signalé une coupure avant.
  let downNotified = false;
  let downTimer = null;
  const DOWN_GRACE_MS = 30 * 1000;

  const onReconnect = (id) => {
    if (downTimer) { clearTimeout(downTimer); downTimer = null; }
    if (downNotified) {
      downNotified = false;
      notifyAdmin(`✅ **Connexion Discord rétablie** (shard ${id}).`);
    }
  };

  client.on("shardDisconnect", (event, id) => {
    console.warn(`Shard ${id} déconnecté (code ${event?.code}).`);
    if (downTimer || downNotified) return;
    downTimer = setTimeout(() => {
      downTimer = null;
      downNotified = true;
      notifyAdmin(`⚠️ **Déconnexion Discord** (shard ${id}, code ${event?.code ?? "?"}). Reconnexion en cours…`);
    }, DOWN_GRACE_MS);
  });
  client.on("shardError", (err, id) => console.error(`Shard ${id} erreur :`, err?.message));
  client.on("shardResume", (id) => { console.log(`Shard ${id} reconnecté (resume).`); onReconnect(id); });
  client.on("shardReady", (id) => onReconnect(id));
  client.on("error", (err) => console.error("Erreur client Discord :", err?.message));

  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(checkApi, API_CHECK_MS);
}
