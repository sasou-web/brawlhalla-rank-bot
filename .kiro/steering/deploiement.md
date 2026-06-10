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
ssh kaya@91.98.17.48
```

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

- SSH : `ssh kaya@91.98.17.48` — utilisateur **kaya**, jamais root en direct.
- Dossier de prod (clone git) : **`/root/brawlhalla-rank-bot`**.
- Process pm2 : **`brawl-bot`** (lancé via `sudo`, donc utiliser `sudo pm2 ...`).
- `update.sh` stoppe si lint/tests échouent (filet de sécurité), donc pas de restart sur du code cassé.
- Données gitignorées (`data/`, `bot.db`, `.env`, `backup.env`) : **jamais touchées** par le pull.

## CI (avant de pousser)

- En local : `npm run ci` (= `npm run check` + `npm test`).
- GitHub Actions (`.github/workflows/ci.yml`) relance ça à chaque push/PR (coche verte avant de déployer).

## Si le chemin de prod semble introuvable

Le retrouver sans deviner :
```bash
sudo pm2 info brawl-bot | grep -i "cwd\|script path"
# ou
find / -type d -name "brawlhalla-rank-bot" 2>/dev/null
```

## Méthode scp (LEGACY — uniquement si le clone git est cassé/absent)

Ne donner que si le git ne marche plus. Tampon : `/home/kaya/src/`.
```powershell
scp -r "c:\Users\ogsas\Downloads\a\brawlhalla-rank-bot\src" kaya@91.98.17.48:/home/kaya/
```
```bash
sudo cp -r /home/kaya/src/* /root/brawlhalla-rank-bot/src/
sudo bash -c "cd /root/brawlhalla-rank-bot && npm run deploy"
sudo pm2 restart brawl-bot
```

## Ne JAMAIS faire

- Ne pas écraser/copier `data/` ni `.env` en prod (détruit XP, liaisons, config).
- Ne pas donner `/home/kaya/brawlhalla-rank-bot` comme dossier de prod (n'existe pas).
