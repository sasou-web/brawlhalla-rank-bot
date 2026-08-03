# Déploiement sur serveur Hetzner (Ubuntu/Debian)

Le bot ne nécessite **aucun port entrant** (connexion sortante vers Discord). Garde le firewall fermé en entrée sauf SSH.

> **Déjà installé ?** Va directement à [Mettre à jour le bot](#mettre-à-jour-le-bot-plus-tard).
> Les étapes ci-dessous ne servent qu'à la **première installation** d'un serveur vierge.

Le dossier de production est **`/root/brawlhalla-rank-bot`** et le process pm2 s'appelle
**`brawl-bot`**. Comme tout vit sous `/root`, les commandes serveur passent par `sudo`.

## Étape 1 — Se connecter au serveur

```bash
ssh <utilisateur>@<ip-du-serveur>
```

## Étape 2 — Cloner le projet

```bash
sudo git clone https://github.com/<toi>/brawlhalla-rank-bot.git /root/brawlhalla-rank-bot
```

## Étape 3 — Préparer le .env

```bash
sudo cp /root/brawlhalla-rank-bot/.env.example /root/brawlhalla-rank-bot/.env
sudo nano /root/brawlhalla-rank-bot/.env   # DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

## Étape 4 — Tout installer et démarrer (une seule commande)

```bash
sudo bash -c "cd /root/brawlhalla-rank-bot && bash install-server.sh"
```

`install-server.sh` installe Node et pm2, installe les dépendances, enregistre les slash
commands, démarre le bot 24/7 et configure le redémarrage au boot.

> À ne pas confondre avec `update.sh` : `install-server.sh` ne sert qu'**une fois**, pour
> préparer un serveur neuf. Les mises à jour suivantes passent toutes par `update.sh`.

## Vérifier

```bash
sudo pm2 status
sudo pm2 logs brawl-bot      # tu dois voir "Connecte en tant que ..."
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

Attends que la propagation soit faite avant de continuer — sinon Caddy échouera à obtenir
le certificat. Depuis ton PC :

```powershell
nslookup dash.tondomaine.com
```

Tu dois voir l'IP de ton serveur. Compte de quelques minutes à une heure.

### 2. Ouvrir les ports 80 et 443

Caddy en a besoin : le **80** pour la validation Let's Encrypt, le **443** pour le HTTPS.
Vérifie-les depuis ton PC :

```powershell
Test-NetConnection -ComputerName <ip-du-serveur> -Port 80  -InformationLevel Quiet
Test-NetConnection -ComputerName <ip-du-serveur> -Port 443 -InformationLevel Quiet
```

> ⚠️ Si tu utilises ufw et qu'il est **inactif**, ne fais surtout pas `sudo ufw enable`
> sans avoir autorisé SSH d'abord : la politique par défaut est « tout refuser en entrée »,
> et tu te couperais l'accès au serveur. Dans cet ordre, jamais l'inverse :
> ```bash
> sudo ufw allow OpenSSH
> sudo ufw allow 80
> sudo ufw allow 443
> sudo ufw enable
> ```
> Pense aussi au pare-feu de ton hébergeur (Hetzner Cloud Firewall), qui est distinct d'ufw.

### 3a. Si nginx est DÉJÀ installé sur le serveur

Vérifie avant toute chose — deux serveurs web ne peuvent pas écouter le même port, et Caddy
refuserait de démarrer avec `bind: address already in use` :

```bash
sudo ss -tlnp '( sport = :80 or sport = :443 )'
ls -l /etc/nginx/sites-enabled/
sudo nginx -T 2>/dev/null | grep -E "server_name|proxy_pass|root " | sort -u
```

Si nginx sert déjà un site, **garde-le** et fais-en le reverse proxy du dashboard. Saute
l'étape Caddy (3b).

```bash
sudo nano /etc/nginx/sites-available/dash.tondomaine.com
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name dash.tondomaine.com;

    # La page Annonces accepte des images jusqu'a 8 Mo, encodees en base64 (~11 Mo).
    # Sans ca, nginx coupe a 1 Mo par defaut et l'upload echoue en 413.
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # INDISPENSABLE : le bot lit cet en-tete pour savoir qu'il est derriere du HTTPS.
        # Sans lui, PUBLIC_URL en https provoque une boucle de redirection infinie.
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dash.tondomaine.com /etc/nginx/sites-enabled/
sudo nginx -t                 # doit dire "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```

Puis le certificat, via certbot (idempotent, ne casse rien s'il est déjà installé) :

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dash.tondomaine.com
```

Choisis la redirection HTTP→HTTPS quand certbot la propose. Il ajoute le bloc `listen 443
ssl` et gère le renouvellement automatiquement.

> Si Caddy a été installé avant de découvrir nginx, désactive-le pour qu'il n'essaie plus
> de démarrer à chaque boot : `sudo systemctl disable --now caddy`.

Passe ensuite directement à l'étape 4.

### 3b. Caddy (si aucun serveur web n'occupe déjà 80/443)

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

```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager     # doit être "active (running)"
```

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul. En cas d'échec du
certificat, la cause est presque toujours le DNS pas encore propagé ou le port 80 fermé :

```bash
sudo journalctl -u caddy -n 40 --no-pager
```

### 4. Mettre à jour le .env

```bash
sudo nano /root/brawlhalla-rank-bot/.env
```
- `PUBLIC_URL=https://dash.tondomaine.com`  (sans `:3000`, sans `/` final)
- garde `WEB_PORT=3000`

Puis dans le **Discord Developer Portal → OAuth2 → Redirects**, ajoute
`https://dash.tondomaine.com/callback`.

```bash
sudo pm2 restart brawl-bot
```

Le passage de `PUBLIC_URL` en `https` active automatiquement, côté code : le cookie de
session en `secure`, l'en-tête HSTS et la redirection HTTP→HTTPS. Le message
d'avertissement au démarrage doit disparaître (`sudo pm2 logs brawl-bot`).

### 5. Ne plus exposer le port 3000

Le dashboard ne doit plus être joignable qu'à travers le proxy. **À faire seulement une
fois que le HTTPS fonctionne**, sinon tu perds l'accès.

Ajoute dans le `.env` :

```
WEB_HOST=127.0.0.1
```

```bash
sudo pm2 restart brawl-bot
```

Le bot n'écoute alors plus que en local : le port 3000 devient injoignable depuis Internet,
et Caddy continue de lui parler via `127.0.0.1:3000`. C'est préférable à une règle de
pare-feu — aucun risque de se couper SSH au passage.

Vérifie depuis ton PC (doit échouer) :
```powershell
Test-NetConnection -ComputerName <ip-du-serveur> -Port 3000 -InformationLevel Quiet
```

### 6. Mettre à jour la surveillance

L'URL du moniteur UptimeRobot change : `https://dash.tondomaine.com/health`.

## Être alerté si le bot tombe (surveillance externe)

Le bot sait déjà prévenir en cas de déconnexion Discord ou d'API Brawlhalla injoignable
(`src/health.js`) — mais il envoie ces alertes **dans un salon Discord, via lui-même**.
Si le process est mort, personne n'est prévenu. pm2 relance, mais un crash-loop passerait
inaperçu jusqu'à ce qu'un membre s'en plaigne.

D'où l'endpoint **`/health`**, à surveiller depuis l'extérieur.

```bash
curl -s https://dash.tondomaine.com/health
```

```json
{
  "status": "ok",
  "uptimeSec": 3421,
  "discord": { "connected": true, "pingMs": 42 },
  "brawlhallaApi": { "reachable": true, "lastCheckTs": 1767303600000 }
}
```

Les codes de réponse sont ce que surveille le moniteur :

| Code | `status` | Signification |
|---|---|---|
| `200` | `ok` | Bot connecté, API Brawlhalla joignable |
| `200` | `degraded` | Bot connecté, API Brawlhalla injoignable |
| `503` | `down` | Bot non connecté à Discord (crash, crash-loop, gateway perdue) |

Le cas `degraded` renvoie volontairement **200** : le bot fonctionne, la panne est chez
Brawlhalla. Ça ne doit pas déclencher une alerte d'indisponibilité (`health.js` prévient
déjà sur Discord pour ce cas précis).

### Mettre en place le moniteur

N'importe quel service de ping HTTP gratuit convient (UptimeRobot, Better Stack,
healthchecks.io…). Configuration :

- **URL** : `https://dash.tondomaine.com/health`
- **Intervalle** : 5 minutes
- **Alerte si** : code différent de 200
- **Notification** : e-mail, ou webhook vers un salon Discord privé

⚠️ **Utilise bien le domaine, pas `http://IP:3000`.** Si tu as fermé le port 3000 au public
(section précédente), l'IP directe n'est plus joignable de l'extérieur — le moniteur
t'alerterait en permanence.

### Ce que l'endpoint expose (et n'expose pas)

`/health` est **volontairement public, sans authentification** : un moniteur externe doit
pouvoir l'interroger. Il ne renvoie donc que de l'état technique — **aucun nom de serveur,
aucun compteur de membres, aucune configuration, aucune donnée de membre**. Il est
rate-limité à 60 requêtes par minute, et sa réponse n'est pas mise en cache.

## Intégration continue (GitHub Actions)

Le dépôt contient `.github/workflows/ci.yml` : à chaque push / pull request, GitHub lance
**`npm run check`** (syntaxe), **`npm run lint`** (ESLint) et **`npm test`** sur Node 20.
Coche verte ✅ ou croix rouge ❌ avant de déployer.

En local, avant de pousser :
```powershell
npm run ci   # check + lint + test
```

> `npm run lint` n'existe que grâce à une **devDependency** (ESLint), donc absente du
> serveur qui installe avec `--omit=dev`. C'est pourquoi `update.sh` se limite à
> `npm run check` : y ajouter `npm run lint` casserait le déploiement.

## Cycle de travail

```
modifier en local  →  npm run ci  →  git push  (la CI vérifie)  →  update.sh sur le serveur
```

Le dossier de prod étant un clone git, une seule commande suffit pour déployer :

```bash
sudo bash -c "cd /root/brawlhalla-rank-bot && bash update.sh"
```

`update.sh` enchaîne : `git pull` → `npm install --omit=dev` → `npm run check` + `npm test`
(**s'arrête si c'est rouge**, donc pas de redémarrage sur du code cassé) → `npm run deploy`
→ `sudo pm2 restart brawl-bot`.

> Les données (`data/`, `.env`, `backup.env`) sont gitignorées : le pull n'y touche jamais.

Après un déploiement qui modifie le dashboard, recharge le navigateur en **Ctrl+F5**
(sinon `app.js` et `style.css` restent en cache).
