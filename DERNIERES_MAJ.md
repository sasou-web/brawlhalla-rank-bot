# Dernières mises à jour — Brawlhalla Rank Bot

## Session du 10 juin 2026 — Refactorisation, robustesse, observabilité & nouvelles features

Grosse session de fond : modularisation du code, fiabilisation des données, observabilité de
l'API, anti-abus, et 3 nouvelles fonctionnalités communautaires. Tests passés de **22 à 71**.

### 🧱 Refactorisation
- **`commands.js` éclaté** (3475 → 451 lignes) en 11 modules sous `src/commands/` :
  `definitions.js` (toutes les slash commands), `shared.js` (helpers transverses),
  `profile.js`, `linking.js`, `levels.js`, `tournament.js`, et `panels/` (tiktok, clips,
  guessrank, tempvoice). Les dispatchers restent le point d'entrée et délèguent aux modules.

### 🗄️ Robustesse des données (SQLite)
- **Tables dédiées** `xp` et `rating_history` : écritures **atomiques par ligne** au lieu de
  réécrire un gros blob JSON à chaque message / refresh. Migration automatique unique depuis
  l'ancien format (aucune perte : 34 membres + historique migrés en prod).
- **Tables `achievements` et `counters`** (succès + compteurs persistants, ex. clips postés).
- Base de **test isolée** via `BOT_DB_PATH` (les tests ne touchent plus `data/bot.db`).

### 📡 Observabilité de l'API Brawlhalla
- Module `apiMetrics.js` : taux de succès, erreurs 429/5xx/réseau, retries, cooldown global,
  profondeur des files de récupération, fraîcheur de l'index local.
- Exposé via **`/ping`** (bloc « Fiabilité API »), l'endpoint **`/api/metrics`**, et un
  **widget dashboard** dédié (onglet « Fiabilité API »).

### 🛡️ Anti-abus
- **Cooldowns par utilisateur** sur les commandes coûteuses (API/canvas) : `/carte` (8s),
  `/versus` (8s), `/stats`/`/rank`/`/legendes`/`/equipe` (4s), `/progression` (6s),
  `/leaderboard` (5s), `/top` (5s), `/ping` (5s), `/combos` (5s), `/niveau` (4s).

### ✨ Nouvelles fonctionnalités
1. **Récap hebdo de progression** — classement automatique des plus gros gains de rating 1v1
   sur 7 jours, posté dans le salon d'annonces (1×/semaine).
2. **Récompenses de fin de saison** — au `/reset-saison`, chaque membre lié reçoit un **badge
   permanent** `🏅 S{n} {Tier}` selon son meilleur tier, puis le n° de saison s'incrémente.
3. **Succès / achievements** — 9 succès (lié, Gold, Diamant, Valhallan, Top 100, Niveau 10/50,
   5 clips, 25 clips). Commande **`/achievements [membre]`**. Déblocage sur sync / level-up /
   clips. **Annonces dans un salon dédié sans ping** (configurable via `/setup-succes` ou le
   dashboard → Réglages généraux → Salon des succès).

### 🔧 Dette technique corrigée
- **TTL 24h** sur le cache des légendes (un nouveau personnage n'attend plus un redémarrage).
- **Sync leaderboard incrémentale** : haut du classement rafraîchi à chaque cycle + reste
  balayé par rotation → ~5× moins d'appels API par cycle (réglable via `LEADERBOARD_SYNC_*`).
- Logique de parsing rendue testable (`mapRankingEntry`, `buildPlayerProfile`, `estimateGlory`,
  `planLeaderboardSync`).

### ✅ Vérifications
- `npm run check` : tous les fichiers OK (`node --check`).
- `npm test` : **71/71** (runner `scripts/run-tests.js` sur base SQLite temporaire isolée).

### 🚀 Déploiement
```bash
sudo bash /root/brawlhalla-rank-bot/update.sh
```
(pull → install → check + test → `npm run deploy` → `pm2 restart brawl-bot`).
Pense à configurer le salon des succès après coup : `/setup-succes salon:#succes`.

---
*Dernière mise à jour : 10 juin 2026 · Bot version : 1.0.0*
