#!/usr/bin/env bash
# Met a jour le bot depuis git (remplace le scp manuel).
# A lancer sur le serveur, dans le dossier du projet (clone git) :
#   sudo bash update.sh
#
# Etapes : pull du code -> install des deps si besoin -> (re)deploy des commandes -> restart.
# Les donnees (data/, .env, backup.env) sont gitignorees : jamais touchees par le pull.

set -e
cd "$(dirname "$0")"

echo "==> Recuperation du code (git pull)..."
# package-lock.json est regenere par 'npm install' sur le serveur, ce qui bloque
# le pull. On jette sa version locale avant de tirer le code (fichier genere, sans risque).
git checkout -- package-lock.json 2>/dev/null || true
git pull --ff-only

echo "==> Installation des dependances..."
npm install --omit=dev

echo "==> Verification rapide (lint + tests)..."
npm run check
npm test || { echo "!! Tests en echec : on arrete avant de redemarrer."; exit 1; }

echo "==> Enregistrement des slash commands..."
npm run deploy

echo "==> Redemarrage du bot..."
pm2 restart brawl-bot

echo ""
echo "============================================================"
echo " Mise a jour terminee. Logs : pm2 logs brawl-bot"
echo "============================================================"
