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
cd /home/kaya/brawlhalla-rank-bot
cp backup.env.example backup.env
nano backup.env     # renseigne UNE cible : webhook Discord, rclone, ou scp
```

Le plus simple : un **webhook Discord** (salon privé `#backups` → Intégrations → Webhooks →
copier l'URL → la coller dans `BACKUP_WEBHOOK_URL`). L'archive `data/` est minuscule.

Puis automatise (cron quotidien à 4h) avec `crontab -e` :
```
0 4 * * * cd /home/kaya/brawlhalla-rank-bot && bash backup-data.sh >> backup.log 2>&1
```

Teste tout de suite : `bash backup-data.sh` (tu dois voir « Envoye au webhook Discord ✅ »).

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
