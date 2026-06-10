# Dernières mises à jour — Brawlhalla Rank Bot

## Session — Découpe XP & factorisation police (dette technique)

### 🧱 Découpe d'`index.js` (suite)
- **`src/xpEvents.js`** : extraction de toute la logique XP (`handleMessageXp`, `tickVoiceXp`,
  `handleLevelUp` + rôles de récompense). `index.js` ne fait plus que brancher les évènements.
- Imports d'`index.js` nettoyés (plus de `ChannelType`/`PermissionFlagsBits`/imports XP
  inutiles) ; doublon de commentaire supprimé.

### 🎨 Factorisation du chargement de police
- **`src/cardFont.js`** : logique de chargement de police (DejaVu/Liberation/Arial → repli
  `sans-serif`) mutualisée. `profileCard.js`, `levelCard.js` et `bracketImage.js` l'importent
  au lieu de dupliquer le bloc 3 fois.

### ✅ Vérifications
- `npm run check` : 52 fichiers OK. `npm test` : **93/93**.
- Smoke-test de rendu des 3 cartes (profil/niveau/bracket) : PNG générés correctement.

---

## Session — Files de récupération API persistées (robustesse)

### 📡 Files de récupération persistées en SQLite
- Nouveau module **`src/pendingStore.js`** (table `pending(kind, item, added_ts)`).
- `brawlhalla.js` : les files `pendingProfiles` / `pendingSearches` (profils & recherches qui
  ont échoué côté API et qu'on rejoue en arrière-plan) étaient **en mémoire** → perdues à
  chaque redémarrage. Elles sont désormais **persistées** : hydratées au démarrage, miroir
  mémoire+SQLite à chaque ajout/retrait. Un `/lier` qui a échoué se rejoue même après un
  `pm2 restart`.
- **Purge automatique** au démarrage des éléments en attente depuis > 7 jours (hygiène : on
  ne réessaie pas indéfiniment un pseudo qui n'existe plus en ranked).
- **5 nouveaux tests** (`test/pending.store.test.js`) : add/load par type, idempotence,
  suppression, indépendance des types, purge par ancienneté.

### ✅ Vérifications
- `npm run check` : 50 fichiers OK. `npm test` : **93/93**.

---

## Session — Découpe des monolithes, permissions & tests handlers (Priorité 5)

### 🧱 Découpe d'`index.js`
- **`src/tournamentAutomation.js`** : extraction de toute l'automatisation des matchs de tournoi
  (création des salons texte/vocal, timers litige/inactivité, nettoyage). Point d'entrée
  `tournamentTick(client, guild)`.
- **`src/voiceManager.js`** : extraction des salons vocaux temporaires « rejoindre pour créer »
  (`handleTempVoice`, `cleanupTempChannels`, panneau de contrôle).
- `index.js` allégé d'environ **230 lignes** ; suppression de code mort (`resolveMatch`,
  `tournamentAnnounce`, `entrantNameById` non utilisés).

### 🛡️ Défense en profondeur sur les permissions
- Helper centralisé `requirePermission` / `requireManageGuild` (`commands/shared.js`).
- **Gate de permission au niveau du dispatcher** (`handleChatInput`) : les commandes admin
  (`ManageGuild`) et staff (`ManageMessages`) sont revérifiées **à l'exécution**, plus seulement
  via `setDefaultMemberPermissions` (gate client Discord, contournable). `bracket` reste publique.

### ✅ Tests handlers (nouveaux)
- `test/permissions.test.js` (6 tests) : `requirePermission`/`requireManageGuild`, contenu des
  ensembles de commandes gatées (et exclusion des commandes publiques), et **blocage effectif**
  d'une commande admin/staff pour un non-autorisé via `handleChatInput` (handler jamais atteint).
- Total : **82 → 88 tests**, tous au vert. `npm run check` : 49 fichiers OK.

### 🗺️ Mono-serveur
- Choix assumé pour l'instant : le runtime reste mono-serveur (`config.guildId`). Le passage
  multi-serveur est reporté.

---

## Session — Durcissement : intégrité, arrêt propre, sécu dashboard & UX

Session de durcissement : élimination de risques réels de perte de données, arrêt propre,
3 correctifs de sécurité du dashboard, et 3 améliorations UX.

### 🗄️ Intégrité des données
- **`store.js` (liaisons) en cache + chaîne d'écriture sérialisée** : fin du *read-modify-write*
  concurrent. Avant, deux liaisons/déliaisons simultanées travaillaient sur des copies
  indépendantes du blob et pouvaient s'écraser (clobber). Désormais source de vérité unique
  en mémoire + écritures non chevauchantes. `getAllLinks` renvoie une copie défensive.
- *Note* : l'XP (`addMessageXp`/`addVoiceXp`) est en réalité déjà atomique par appel (aucun
  `await` entre lecture et écriture sous better-sqlite3 synchrone) — pas de correctif requis.

### 🔌 Cycle de vie
- **Arrêt propre `SIGINT`/`SIGTERM`** (`index.js`) : stoppe les 8 boucles `setInterval`
  (suivi via `every()`), déconnecte le client Discord, puis ferme SQLite (`closeDb` +
  `wal_checkpoint(TRUNCATE)`). Filet de sécurité : sortie forcée après 5 s.
- **Garde anti-chevauchement sur `refreshAllMembers`** : un cycle ne peut plus se superposer
  au précédent s'il dépasse l'intervalle.

### 🛡️ Sécurité du dashboard (`web/server.js`)
- **`state` OAuth anti login-CSRF** : nonce aléatoire posé en cookie httpOnly (5 min) et
  revérifié au `/callback` (rejet → `?error=state`), à usage unique.
- **Re-vérification admin par requête** (cache 60 s) : on ne se fie plus au flag `isAdmin`
  figé 1 j dans le JWT. Un admin déchu perd l'accès en ≤ 60 s (`403 accès révoqué`).
- **Anti mass-assignment** sur `PUT /api/config/:section` : le body est filtré sur les clés
  déjà présentes dans le schéma de config courant (plus d'injection de champs arbitraires).

### ✨ UX
- **Cache LRU des vidéos de combos** (`combos.js`) : plus de re-téléchargement en RAM à chaque
  navigation. TTL 1 h, budget total ~80 Mo, plafond 12 Mo/fichier, éviction des plus anciennes.
- **Bonus XP week-end en heure FR** (`levels.js`) : `Europe/Paris` au lieu d'UTC → le double-XP
  couvre exactement samedi/dimanche locaux.
- **Carte profil** (`profileCard.js`) : suppression de l'emoji `🗡` (rendu en carré "tofu" avec
  les polices Arial/DejaVu/Liberation) → libellé texte propre `Main : …`.

### ✅ Vérifications
- `npm run check` : 47 fichiers OK. `npm test` : **82/82**.

---

## Session — Migration des derniers caches JSON vers SQLite

Fin de la Priorité 1 (intégrité des données) : les trois derniers caches encore en gros JSON
réécrits avec debounce (2 s) passent en tables SQLite dédiées. Plus aucun blob réécrit en
entier → écritures atomiques par ligne, zéro corruption possible, un seul fichier à sauvegarder.

### 🗄️ Caches migrés (profils / recherches / index leaderboard)
- **`profiles.json` → table `profiles`** (`brawlhalla_id`, `ts`, `last_access`, `data` JSON) :
  cache profils joueurs. UPSERT atomique par accès au lieu de réécrire tout le fichier.
- **`searches.json` → table `searches`** (`query`, `ts`, `results` JSON) : cache des recherches
  par pseudo.
- **`leaderboard.json` → table `leaderboard`** (~25k joueurs classés) : `norm` (pseudo
  normalisé indexé) permet la **recherche en SQL** (exact > commence par > contient, trié par
  rating) au lieu de scanner 25k entrées en mémoire. `syncedAt` conservé en `kv`.
- **Migration automatique unique** par cache (garde `runOnce`), fichiers d'origine renommés
  `.migrated` comme filet de sécurité. Le dossier de données suit désormais l'emplacement de la
  base → **tests totalement isolés** (aucun JSON réel lu/renommé pendant `npm test`).
- **11 nouveaux tests** (`test/stores.migration.test.js`) : set/get, profils chauds, tri de
  recherche, insensibilité accents/casse, échappement des jokers LIKE. Suite : **71 → 82 tests**.

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
