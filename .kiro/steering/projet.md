# Brawlhalla Rank Bot — contexte projet

Infos à connaître dans toutes les sessions. (Le déploiement est dans `deploiement.md`.)

## Vue d'ensemble

Bot Discord (Node.js, ESM, **discord.js v14**) pour un serveur Brawlhalla. Il attribue
des rôles selon le rank Brawlhalla (1v1 / 2v2) et embarque plein de modules annexes
(niveaux, tournois, TikTok, vocaux temporaires, etc.). Langue : **français** (réponses,
messages du bot, commentaires).

- API Brawlhalla **v1 publique** (`https://api.brawlhalla.com/v1`) — **aucune clé API**.
- Node >= 18. Lancé en prod via **pm2** (process `brawl-bot`).
- Dépendances : discord.js, express, dotenv, cookie-parser, jsonwebtoken, @napi-rs/canvas (cartes profil).

## Démarrage / scripts

- `npm start` → `node src/index.js` (démarre le bot)
- `npm run deploy` → `node src/deploy-commands.js` (enregistre les slash commands sur la guild)

## Carte des fichiers `src/`

- **index.js** — point d'entrée : client, events (ready, interactions, messages, vocal), boucles (refresh rank, XP vocal, TikTok poll), level-up.
- **config.js** — constantes : TIERS, seuils rating→tier, couleurs, emojis, rôles de région, `SERVER_LEVEL_TIERS` (paliers de niveau serveur), helpers (`roleName`, `tierIndex`...).
- **commands.js** — définitions + handlers de TOUTES les slash commands, boutons, selects, modals.
- **brawlhalla.js** — client API (recherche joueur, profil, rankings, légendes, Glory), index local du leaderboard.
- **roles.js** — création/gestion des rôles (tiers, régions, top, niveaux), `applyMemberRoles`.
- **sync.js** — `syncMember` : fetch profil + applique rôles + annonce montée de tier.
- **levels.js** — système XP (messages + vocal), courbe type MEE6, récompenses de rôles.
- **store.js** — liaisons Discord↔Brawlhalla (`data/links.json`).
- **ratingStore.js** — historique de rating par joueur (`data/ratings.json`), alimenté à chaque sync, lu par `/progression`.
- **profileCard.js** — rendu d'une carte profil en image PNG via `@napi-rs/canvas` (commande `/carte`).
- **levelCard.js** — carte de niveau/XP en image (façon MEE6) via `@napi-rs/canvas` (commande `/niveau`).
- **settings.js** — réglages serveur (`data/settings.json`), priorité : /setup > .env > défaut.
- **searchStore.js / profileStore.js / leaderboardStore.js** — caches/persistance.
- **tournament.js / tournamentUI.js** — système de tournois (inscriptions, matchs, salons). Cast gate (`castFromTopN`, matchs verrouillés), podium/MVP (`tournamentPodium`), Hall of Fame.
- **bracketImage.js** — rendu visuel du bracket en image PNG via `@napi-rs/canvas` (commande `/bracket`).
- **tempvoice.js** — salons vocaux temporaires ("rejoindre pour créer").
- **rankvoice.js** — salons vocaux par rank (accès restreint selon le tier).
- **tiktok.js** — notifications TikTok via flux RSS.
- **clips.js** — réactions auto + modération des clips.
- **guessrank.js** — jeu "devine le rang".
- **welcome.js** — messages de bienvenue/au revoir + auto-rôles.
- **web/server.js** — dashboard web optionnel (OAuth Discord), actif seulement si `CLIENT_SECRET`+`PUBLIC_URL`+`SESSION_SECRET` définis.

## Données (dossier `data/`, NE JAMAIS écraser en prod)

- **Persistance principale : SQLite `data/bot.db`** (via `src/db.js`, table `kv` clé→JSON, mode WAL). Les données persistantes y vivent : `links`, `settings`, `levels`, `ratings`, `tiktok`, `clips`, `guessrank`, `tempvoice`, `welcome`, `tournament`.
- Migration auto au démarrage : les anciens `data/*.json` sont importés dans `bot.db` puis renommés `.migrated` (backup). `db.js` : `loadDoc(key, fallback)` / `saveDoc(key, value)` (synchrones).
- Restent en **JSON** (caches reconstruisibles) : `profiles.json`, `searches.json`, `leaderboard.json`.
- Backup : `backup-data.sh` archive tout `data/` (donc `bot.db` inclus) + envoi offsite.

## Concepts clés

- **Tiers Brawlhalla** : `Tin, Bronze, Silver, Gold, Platinum, Diamond, Valhallan`. Rôles `1v1 <tier>` et `2v2 <tier>`. Tier déduit du rating (seuils dans `RANKED_TIERS`). `Valhallan` = tier vide/null renvoyé par l'API sur rating ≥ 2000.
- **Paliers de niveau serveur** (`SERVER_LEVEL_TIERS`) : niveaux **5, 10, 20, 35, 50, 70, 100**, chacun avec un rôle coloré (dégradé style rank). Gérés par `levels.js`, distincts des rôles de rank.
- **Validation des liaisons** : auto-validation si tier ≤ seuil (`autoApproveTier`, défaut Platinum), sinon file de validation par le staff.
- **Stockage** : JSON dans `data/`, écritures atomiques (tmp + rename) pour éviter la corruption.

## Tests

- Runner natif **`node:test`** (aucune dépendance). Lancer : `npm test` (ou `node --test`).
- Dossier `test/` : `tier.test.js`, `xp.test.js`, `rss.test.js`, `clips.test.js` — couvrent les fonctions pures (calcul de tier, courbe d'XP, parsing RSS via `parseFeedXml`, parsing clips).
- Les modules qui importent `config.js` exigent des variables d'env au chargement : les tests les fixent en factice (`process.env.X ||= "test"`) avant un `import()` dynamique.
- Lancer les tests **avant chaque déploiement** comme filet de sécurité.

## Conventions de code
- ESM (`import`/`export`), `"type": "module"`.
- Embeds/composants souvent écrits en **JSON brut** (objets), pas seulement via les builders.
- Beaucoup d'opérations en **best-effort** (`.catch(() => {})`) pour ne pas casser le flux.
- Commentaires et textes utilisateur en français.

## À NE PAS faire

- Ne pas lire/afficher le `.env` (secrets : token, client secret).
- Ne pas écraser `data/` ni `.env` lors d'un déploiement.
- Ne pas ajouter de tests sauf demande explicite.
