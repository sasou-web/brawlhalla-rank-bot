# Déploiement & mise à jour du bot (procédure de Kaya)

> ⚠️ ASSISTANT : quand Kaya demande « pousser sur le serv », « déployer », « les commandes
> pour mon serveur », etc. → donner EXACTEMENT les commandes ci-dessous. Ne JAMAIS inventer
> d'autre chemin. Le dossier de prod est **`/root/brawlhalla-rank-bot`** (PAS `/home/kaya/...`).

## TL;DR — la seule séquence à donner

Le cycle normal : modifier en local → commit + push GitHub → déployer sur le serveur.

### 1. Côté PC (local) — commit + push

```bash
git add -A
git commit -m "message clair"
git push origin main
```

### 2. Côté serveur — déployer

Se connecter puis lancer `update.sh` (git pull → npm install → lint+tests → npm run deploy → pm2 restart) :

```bash
ssh $SSH_CIBLE
```

> **`$SSH_CIBLE`** (utilisateur + IP réels) est dans **`.kiro/steering/serveur.local.md`**,
> non versionné : ce dépôt est public, on n'y publie pas les coordonnées du serveur.
> Ce fichier est chargé comme les autres steering, donc l'assistant y a accès en local.

```bash
sudo bash -c "cd /root/brawlhalla-rank-bot && bash update.sh"
```

> C'est LA commande de déploiement (Kaya n'a pas l'écriture directe sur `/root`, d'où le `sudo bash -c`).
> Elle s'occupe de tout. Ne pas proposer scp/cp manuels par défaut.

### 3. Vérifier

```bash
sudo pm2 list
sudo pm2 logs brawl-bot --lines 30
```

Doit afficher « Connecte en tant que ... » et un statut `online`.
Pour le dashboard web : recharger le navigateur en **Ctrl+F5** (nouveau `app.js`).

## Faits serveur (à ne pas oublier)

- SSH : `ssh $SSH_CIBLE` (voir `serveur.local.md`) — jamais root en direct.
- Dossier de prod (clone git) : **`/root/brawlhalla-rank-bot`**.
- Process pm2 : **`brawl-bot`** (lancé via `sudo`, donc utiliser `sudo pm2 ...`).
- `update.sh` stoppe si lint/tests échouent (filet de sécurité), donc pas de restart sur du code cassé.
- Données gitignorées (`data/`, `bot.db`, `.env`, `backup.env`) : **jamais touchées** par le pull.

## CI (avant de pousser)

- En local : `npm run ci` (= `npm run check` + `npm run lint` + `npm test`).
- GitHub Actions (`.github/workflows/ci.yml`) relance ça à chaque push/PR (coche verte avant de déployer).
- `npm run lint` (ESLint) est une **devDependency** : absente du serveur (`npm install --omit=dev`).
  C'est pourquoi `update.sh` se limite à `npm run check` — ne JAMAIS y ajouter `npm run lint`.

## Documentation complète

Ce fichier est le **mémo opérationnel** (les commandes à donner, rien de plus).
La doc détaillée vit dans **`DEPLOY.md`** à la racine du dépôt : première installation,
reverse proxy HTTPS, sauvegardes et restauration, surveillance externe `/health`.
En cas de divergence entre les deux, `DEPLOY.md` fait référence.

## Si le chemin de prod semble introuvable

Le retrouver sans deviner :
```bash
sudo pm2 info brawl-bot | grep -i "cwd\|script path"
# ou
find / -type d -name "brawlhalla-rank-bot" 2>/dev/null
```

## Si le clone git est cassé

Le réparer sur place plutôt que de recopier des fichiers à la main :
```bash
sudo bash -c "cd /root/brawlhalla-rank-bot && git fetch origin && git reset --hard origin/main"
```
> `git reset --hard` n'écrase QUE les fichiers suivis. `data/`, `.env` et `backup.env`
> sont gitignorés : ils ne sont jamais touchés. Demander confirmation avant de la donner,
> car elle jette les modifications locales non commitées du serveur.

## Ne JAMAIS faire

- Ne pas écraser/copier `data/` ni `.env` en prod (détruit XP, liaisons, config).
- Ne pas donner `/home/kaya/brawlhalla-rank-bot` comme dossier de prod (n'existe pas).
- Ne pas proposer de `scp` : le dossier de prod est un clone git, `update.sh` suffit.
- Ne pas confondre `install-server.sh` (première installation d'un serveur vierge,
  une seule fois) et `update.sh` (toutes les mises à jour).
