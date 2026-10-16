#!/usr/bin/env bash
# Met a jour le bot depuis git (remplace le scp manuel).
# A lancer sur le serveur, dans le dossier du projet (clone git) :
#   sudo bash update.sh
#
# Etapes : instantane de la base -> pull du code -> install des deps si besoin
#          -> (re)deploy des commandes -> restart.
# Les donnees (data/, .env, backup.env) sont gitignorees : jamais touchees par le pull.

set -e
cd "$(dirname "$0")"

echo "==> Instantane de la base avant mise a jour..."
# Point de retour si la nouvelle version migre mal les donnees (la sauvegarde de 4h peut
# dater de 24h) : backups/pre-update_<date>_<commit>.db, les 5 derniers sont gardes.
# Pris AVANT le pull et avant `npm run deploy`, qui ouvre deja la base. Via node et
# better-sqlite3 : le CLI sqlite3 n'est pas forcement installe (install-server.sh ne le met pas).
# NON BLOQUANT : un echec ne doit jamais empecher la mise a jour.
mkdir -p backups && node scripts/snapshot-db.js "$(git rev-parse --short HEAD 2>/dev/null)" \
  || echo "    !! Instantane impossible : mise a jour poursuivie SANS point de retour."

echo "==> Recuperation du code (git pull)..."
# package-lock.json est regenere par 'npm install' sur le serveur, ce qui bloque
# le pull. On jette sa version locale avant de tirer le code (fichier genere, sans risque).
git checkout -- package-lock.json 2>/dev/null || true
# data/combos.json est versionne mais reecrit par "Mettre a jour la base de combos" du
# dashboard : la version du depot fait reference, sinon le pull echoue des qu'un commit le modifie.
git checkout -- data/combos.json 2>/dev/null || true
git pull --ff-only

echo "==> Installation des dependances..."
npm install --omit=dev

echo "==> Verification rapide (lint + tests)..."
npm run check
npm test || { echo "!! Tests en echec : on arrete avant de redemarrer."; exit 1; }

echo "==> Enregistrement des slash commands..."
npm run deploy

echo "==> Redemarrage du bot..."
# Le process pm2 s'appelait "brawl-bot" avant le renommage en Xray Kaya (XK) Bot.
# Si l'ancien nom tourne encore, on bascule proprement vers "xk-bot".
if pm2 describe xk-bot > /dev/null 2>&1; then
  pm2 restart xk-bot
else
  echo "    (bascule du process pm2 vers 'xk-bot')"
  pm2 delete brawl-bot > /dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs
  pm2 save
fi

echo ""
echo "============================================================"
echo " Mise a jour terminee. Logs : pm2 logs xk-bot"
echo "============================================================"
