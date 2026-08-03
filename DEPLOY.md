# Déploiement sur serveur Hetzner (Ubuntu/Debian)

Le bot ne nécessite **aucun port entrant** (connexion sortante vers Discord). Garde le firewall fermé en entrée sauf SSH.

## Étape 1 — Envoyer le projet sur le serveur

Depuis **PowerShell sur ton PC Windows**, dans le dossier parent du projet.

> ⚠️ Supprime d'abord `node_modules` du dossier local (lourd, réinstallé sur le serveur).

```powershell
scp -r "c:\Users\ogsas\Downloads\a\brawlhalla-rank-bot" kaya@91.98.17.48:/home/kaya/
```

(ou, si ton code est sur GitHub : connecte-toi en SSH puis `git clone <url>`)

## Étape 2 — Se connecter au serveur

```powershell
ssh kaya@91.98.17.48
```

## Étape 3 — Préparer le .env (si pas déjà fait)

```bash
cd /home/kaya/brawlhalla-rank-bot
cp .env.example .env
nano .env      # renseigne DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

## Étape 4 — Tout installer et démarrer (une seule commande)

```bash
bash deploy.sh
```

Ce script installe Node, pm2, les dépendances, enregistre les slash commands, démarre le bot 24/7 et configure le redémarrage au boot.

## Vérifier

```bash
pm2 status
pm2 logs brawl-bot      # tu dois voir "Connecte en tant que ..."
```

## Mettre à jour le bot plus tard

Le dossier de prod est un clone git sous `/root/brawlhalla-rank-bot`. Pour déployer une mise à jour, pousse ton code sur GitHub puis, sur le serveur :

```bash
sudo bash -c "cd /root/brawlhalla-rank-bot && bash update.sh"
```

`update.sh` enchaîne : `git pull` → `npm install` → lint + tests → `npm run deploy` → `pm2 restart brawl-bot`. Les données (`data/`, `.env`, `bot.db`) sont gitignorées et ne sont jamais touchées.

## Sauvegardes automatiques des données (XP, liaisons)

Le script `backup-data.sh` crée une archive locale **et** l'envoie vers un stockage
**externe** (pour survivre à une perte du serveur). Configure la cible externe :

```bash
cd /root/brawlhalla-rank-bot
sudo cp backup.env.example backup.env
sudo nano backup.env   # renseigne UNE cible : webhook Discord, rclone, ou scp
```

Le plus simple : un **webhook Discord** (salon privé `#backups` → Intégrations → Webhooks →
copier l'URL → la coller dans `BACKUP_WEBHOOK_URL`).

Puis automatise (cron quotidien à 4h) avec `sudo crontab -e` :
```
0 4 * * * cd /root/brawlhalla-rank-bot && bash backup-data.sh >> backup.log 2>&1
```

Teste tout de suite : `sudo bash backup-data.sh` (tu dois voir « Envoye au webhook Discord ✅ »).

### Ce qui est sauvegardé (et pourquoi c'est léger)

L'archive n'est **pas** `data/` brut mais un instantané allégé de `bot.db` :

| Sauvegardé | Retiré de la copie (reconstructible depuis l'API) |
|---|---|
| `kv` (liaisons, réglages, configs, tournois) | `leaderboard` — miroir du classement Brawlhalla, ~40 000 lignes |
| `xp`, `rating_history` | `profiles`, `searches` — caches de l'API |
| `achievements`, `counters` | `pending` — file de récupération (7 j) |
| `giveaways`, `giveaway_entries` | |

À elle seule, la table `leaderboard` représentait l'essentiel des 14 Mo de la base. En la
retirant, l'archive passe de **~6,7 Mo à ~330 Ko**. La taille suit désormais le nombre de
membres, plus celle du ladder Brawlhalla — donc plus de risque de dépasser en silence la
limite d'upload de 25 Mo de Discord.

L'instantané est produit par `VACUUM INTO`, qui lit la base **sans arrêter le bot** et garantit
un fichier cohérent. Un `PRAGMA integrity_check` est fait avant archivage : une base corrompue
n'est jamais sauvegardée. En cas d'échec, une alerte est postée sur le webhook (un cron cassé
ne passe plus inaperçu).

`.env` n'est **jamais** sauvegardé (il contient le token du bot) — garde-le dans un
gestionnaire de mots de passe.

### Vérifier une archive (sans rien restaurer)

À faire au moins une fois : une sauvegarde jamais vérifiée est une hypothèse, pas une garantie.

```bash
sudo bash -c 'A=$(ls -1t /root/brawlhalla-rank-bot/backups/bot_*.db.gz | head -1); echo "Archive : $A"; gunzip -c "$A" > /tmp/verif.db'
sudo sqlite3 /tmp/verif.db "PRAGMA integrity_check;"
sudo sqlite3 -header -column /tmp/verif.db "SELECT (SELECT COUNT(*) FROM kv) AS kv, (SELECT COUNT(*) FROM xp) AS xp, (SELECT COUNT(*) FROM rating_history) AS ratings, (SELECT COUNT(*) FROM leaderboard) AS leaderboard;"
sudo rm -f /tmp/verif.db
```

Attendu : `ok`, des compteurs non nuls pour `kv` / `xp` / `ratings`, et `leaderboard` **à 0**
(preuve que la purge a bien eu lieu).

⚠️ **Toujours des chemins absolus.** L'utilisateur `kaya` ne peut pas faire `cd /root/...`
(permission refusée) : la commande échouerait, et `sqlite3` créerait alors une base **vide**
sur laquelle `integrity_check` répond `ok`. Un `ok` sur une base inexistante ne prouve rien —
vérifie toujours que les compteurs de lignes sont cohérents.

### Restaurer une sauvegarde

```bash
sudo pm2 stop brawl-bot
sudo mv /root/brawlhalla-rank-bot/data/bot.db /root/brawlhalla-rank-bot/data/bot.db.avant-restauration
sudo rm -f /root/brawlhalla-rank-bot/data/bot.db-wal /root/brawlhalla-rank-bot/data/bot.db-shm
sudo bash -c 'gunzip -c /root/brawlhalla-rank-bot/backups/bot_AAAA-MM-JJ_HH-MM-SS.db.gz > /root/brawlhalla-rank-bot/data/bot.db'
sudo pm2 start brawl-bot
sudo pm2 logs brawl-bot --lines 20
```

⚠️ Le `rm` des fichiers `-wal` / `-shm` est **indispensable** : laissés en place, SQLite
rejouerait l'ancien journal par-dessus la base restaurée. Les caches (classement, profils,
recherches) se reconstruisent tout seuls dans les minutes qui suivent.

L'ancienne base est conservée sous `bot.db.avant-restauration` : en cas de mauvaise surprise,
tu peux revenir en arrière en refaisant l'opération dans l'autre sens.

## Rappel important

Active **Server Members Intent** dans le [Discord Developer Portal](https://discord.com/developers/applications) → ton app → Bot.
(Message Content Intent n'est PAS nécessaire.)

## Sécuriser le dashboard (HTTPS + reverse proxy)

Le bot applique déjà : cookies `secure`/`httpOnly`/`sameSite`, en-têtes de sécurité
(HSTS, X-Frame-Options, nosniff), redirection HTTP→HTTPS et **rate-limiting** sur l'API et
l'OAuth. Mais le chiffrement TLS doit être assuré par un **reverse proxy** devant le bot.

### 1. Avoir un nom de domaine

Fais pointer un domaine (ex: `dash.tondomaine.com`) vers l'IP du serveur (enregistrement A).

### 2. Caddy (le plus simple, HTTPS automatique)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Édite `/etc/caddy/Caddyfile` :

```
dash.tondomaine.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul.

### 3. Mettre à jour le .env

```bash
nano /root/brawlhalla-rank-bot/.env
```
- `PUBLIC_URL=https://dash.tondomaine.com`  (sans `:3000`, sans `/` final)
- garde `WEB_PORT=3000`

Puis dans le **Discord Developer Portal → OAuth2 → Redirects**, ajoute
`https://dash.tondomaine.com/callback`.

```bash
sudo pm2 restart brawl-bot
```

### 4. Fermer le port 3000 au public

Le dashboard ne doit être joignable que par le proxy local. Avec ufw :
```bash
sudo ufw deny 3000
```
(Le proxy parle au bot via `127.0.0.1:3000`, donc ça reste fonctionnel.)

## CI + déploiement par git (remplace le scp manuel)

### Intégration continue (GitHub Actions)

Le dépôt contient `.github/workflows/ci.yml` : à chaque push / pull request, GitHub lance
**lint syntaxique (`npm run check`) + tests (`npm test`)** sur Node 20. Tu vois une coche
verte ✅ ou une croix rouge ❌ avant de déployer. En local, avant de pousser :
```powershell
npm run ci   # = npm run check && npm test
```

### Passer le serveur en clone git (une seule fois)

> Les données (`data/`, `.env`, `backup.env`, `bot.db`) sont gitignorées : le pull n'y touche jamais.

1. **Crée un dépôt GitHub privé** (ex: `brawlhalla-rank-bot`).
2. **Depuis ton PC**, dans le dossier du projet, pousse le code :
   ```powershell
   cd "c:\Users\ogsas\Downloads\a\brawlhalla-rank-bot"
   git init
   git add .
   git commit -m "Initial"
   git branch -M main
   git remote add origin https://github.com/<toi>/brawlhalla-rank-bot.git
   git push -u origin main
   ```
3. **Sur le serveur**, transforme l'install existante en clone git (sans perdre les données) :
   ```bash
   cd /root/brawlhalla-rank-bot
   sudo git init
   sudo git remote add origin https://github.com/<toi>/brawlhalla-rank-bot.git
   sudo git fetch origin
   sudo git reset --hard origin/main   # aligne le CODE sur le dépôt ; data/ .env intacts (gitignorés)
   ```

### Mettre à jour le bot (désormais)

À la place du scp + cp, une seule commande sur le serveur :
```bash
cd /root/brawlhalla-rank-bot && sudo bash update.sh
```
`update.sh` fait : `git pull` → `npm install` → lint + tests (stoppe si rouge) → `npm run deploy` → `pm2 restart`.

Cycle de travail : tu modifies en local → `npm run ci` → `git push` (CI vérifie) → sur le serveur `sudo bash update.sh`.
