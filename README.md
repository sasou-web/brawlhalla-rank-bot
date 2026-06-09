# Brawlhalla Rank Bot

Bot Discord (Node.js / discord.js v14) qui attribue automatiquement des roles selon le rank Brawlhalla d'un membre, en **1v1** et **2v2**.

## Fonctionnement

1. Un membre lie son compte avec `/lier <pseudo>`.
2. Le bot cherche le pseudo dans le leaderboard ranked de l'API officielle Brawlhalla **v1** (publique, sans clé) et propose les comptes correspondants (boutons de confirmation, utile en cas d'homonymes).
3. Une fois confirmé, le bot lit `/player/stats` (1v1) et `/player/teams` (2v2) et attribue les rôles de tier (ex. `1v1 Gold`, `2v2 Diamond`).
4. Toutes les `REFRESH_INTERVAL_MINUTES`, le bot remet à jour les rôles de tous les membres liés.

Le client API (`src/brawlhalla.js`) utilise l'API officielle **v1** (`https://api.brawlhalla.com/v1`), qui depuis la version 1.0 **ne nécessite plus aucune clé API**. Le calcul du tier à partir du rating et la gestion du tier `Valhallan` (que l'API renvoie parfois vide/`null`) sont inspirés du package bhapi de [corehalla](https://github.com/djobbo/corehalla).

Les rôles gérés sont, pour chaque mode (`1v1` / `2v2`) et chaque tier (`Tin`, `Bronze`, `Silver`, `Gold`, `Platinum`, `Diamond`, `Valhallan`). Ils sont créés automatiquement au démarrage s'ils n'existent pas.

## Prerequis

- Node.js >= 18
- Un bot Discord avec l'intent **Server Members** active (Developer Portal > Bot > Privileged Gateway Intents)
- La permission **Manage Roles** pour le bot, et son role place **au-dessus** des roles de rank dans la hierarchie
- Aucune cle API Brawlhalla n'est requise (API v1 publique)

## Installation

```bash
npm install
cp .env.example .env   # puis remplis les valeurs (token, client id, guild id)
npm run deploy         # enregistre les slash commands sur ta guild
npm start              # demarre le bot
```

## Commandes

**Membres**
- `/lier <pseudo>` — lie ton compte Brawlhalla (cooldown 30 s)
- `/delier` — supprime ta liaison et retire tes rôles
- `/stats [membre|pseudo]` — niveau, winrate, ranks, légende #1, Glory estimée
- `/rank [membre|pseudo]` — détail rank 1v1 et 2v2 (rating, peak, rang mondial)
- `/legendes [membre|pseudo]` — top 5 des légendes les plus jouées + winrate
- `/equipe [membre|pseudo]` — équipes 2v2 et coéquipiers
- `/leaderboard [mode] [région]` — top 10 du classement
- `/top` — classement 1v1 des membres liés du serveur

**Staff / Admin**
- `/setup` — config : salon de validation, rôle validateur, salon d'audit, salon d'annonces, seuil d'auto-validation
- `/whois <membre>` — compte Brawlhalla lié à un membre
- `/forcelink <membre> <pseudo>` — lier sans validation
- `/unlink <membre>` — supprimer la liaison d'un membre
- `/refresh` — mettre à jour tous les membres liés
- `/reset-saison` — retirer les rôles de rank saisonniers (tiers + Top), avec confirmation

## Rôles gérés automatiquement

- **Tiers** : `1v1 <tier>` et `2v2 <tier>` (Tin → Valhallan)
- **Paliers de niveau** : `Niveau 25+`, `50+`, `75+`, `100+` (le plus haut atteint)
- **Top mondial** : `Top 100 (1v1)` si le joueur est classé ≤ 100 en 1v1
- **Validateur** : `🛡️ Valideur de Rank` (créé au démarrage)

Tous sont créés automatiquement au lancement. `/reset-saison` ne retire que les rôles **saisonniers** (tiers + Top), pas les paliers de niveau.

## Validation des liaisons

- **Unicité** : un compte Brawlhalla ne peut être lié que par un seul membre (revérifié à la validation).
- **Auto-validation** : les comptes dont le tier le plus haut est `<=` au seuil (`/setup`, défaut `Platinum`) sont liés automatiquement ; au-dessus, une demande part dans le salon de validation.
- **File de validation** : embed récap (tiers, rating, peak, région, rang) + boutons **Valider** / **Refuser** (refus avec motif via une fenêtre). Seul le rôle validateur (ou « Gérer le serveur ») peut agir.
- **Notifications** : DM au membre à la validation/refus.
- **Annonces de montée** : si un salon d'annonces est configuré, le bot publie quand un membre monte de tier (détecté au refresh).
- **Audit** : journalisation des liaisons/déliaisons/reset dans le salon d'audit.

## Limites connues

- Recherche par **pseudo** (l'API v1 ne permet plus la recherche par Steam ID). Seuls les joueurs ayant joué en ranked cette saison apparaissent. Les caractères spéciaux non supportés par l'API (ex. `#`) sont nettoyés avant la recherche.
- Le tier 2v2 retenu est celui de l'**équipe au plus haut rating**.
- Le tier `Valhallan` est déduit quand l'API renvoie un tier vide/`null` sur un joueur à fort rating (≥ 2000).
- La **Glory** est une **estimation** (formule communautaire reprise de corehalla), pas une valeur officielle.
- Le bot doit avoir **Send Messages** + **Embed Links** dans les salons de validation, d'audit et d'annonces.
