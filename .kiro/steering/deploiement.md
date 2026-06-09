# Déploiement & mise à jour du bot (procédure de Kaya)

> ⚠️ IMPORTANT pour l'assistant : c'est LA méthode officielle pour pousser les mises à jour.
> Toujours donner ces commandes-là, sans inventer d'autres chemins.

> 🟢 MÉTHODE PRÉFÉRÉE si le dépôt git est configuré : voir « Déploiement par git » plus bas.
> Sinon, méthode scp ci-dessous.

## CI (avant de déployer)

- Lint + tests en local : `npm run ci` (= `npm run check` + `npm test`).
- GitHub Actions (`.github/workflows/ci.yml`) relance ça à chaque push/PR.

## Déploiement par git (préféré, une fois le dépôt configuré)

Sur le serveur, une seule commande :
```bash
cd /root/brawlhalla-rank-bot && sudo bash update.sh
```
(`update.sh` : git pull → npm install → lint+tests → npm run deploy → pm2 restart)
Les données (`data/`, `.env`, `backup.env`, `bot.db`) sont gitignorées : jamais écrasées.

## Faits sur le serveur

- Connexion SSH : `ssh kaya@91.98.17.48` (utilisateur **kaya**, JAMAIS root en direct)
- Le bot tourne en réalité dans **`/root/brawlhalla-rank-bot/`** (sous pm2, lancé via `sudo`)
- Nom du process pm2 : **`brawl-bot`**
- Kaya n'a pas accès en écriture direct à `/root/...` → il passe par son home `/home/kaya/src/` puis copie avec `sudo`
- Le dossier tampon sur le serveur est **`/home/kaya/src/`**

## Procédure complète de mise à jour

### 1. Depuis le PC Windows (PowerShell) — envoyer le dossier `src` complet

⚠️ Méthode FIABLE : envoyer tout le dossier `src` (et pas des fichiers un par un, car
`/home/kaya/src/` peut ne pas exister et `scp` ne crée pas les chemins imbriqués).
`scp -r ...\src` vers `/home/kaya/` recrée `/home/kaya/src/` automatiquement.

```powershell
scp -r "c:\Users\ogsas\Downloads\a\brawlhalla-rank-bot\src" kaya@91.98.17.48:/home/kaya/
```

### 2. Se connecter au serveur

```powershell
ssh kaya@91.98.17.48
```

### 3. Sur le serveur — copier dans le vrai dossier, redéployer, redémarrer

Ce sont les 3 commandes que Kaya lance à chaque fois :

```bash
sudo cp -r /home/kaya/src/* /root/brawlhalla-rank-bot/src/
sudo bash -c "cd /root/brawlhalla-rank-bot && npm run deploy"
sudo pm2 restart brawl-bot
```

- `npm run deploy` n'est nécessaire que si des **commandes slash** ont changé, mais Kaya le lance systématiquement (sans danger).
- Vérifier ensuite : `sudo pm2 logs brawl-bot` (doit afficher « Connecte en tant que ... »).

## Ne JAMAIS écraser en prod

- Ne pas envoyer/copier `data/` (XP, liaisons, paramètres) ni `.env` : ça détruirait les données et la config de production.
