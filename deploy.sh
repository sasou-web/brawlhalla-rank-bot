#!/usr/bin/env bash
# ============================================================
#  Installation tout-en-un du bot sur un serveur (Hetzner, Ubuntu/Debian)
# ============================================================
#  A lancer DANS le dossier du projet, sur le serveur :
#     bash deploy.sh
#
#  Le script :
#   1. installe Node.js 20 + git (si absents)
#   2. installe pm2 (gestionnaire de process 24/7)
#   3. installe les dependances du bot
#   4. verifie la presence du .env
#   5. enregistre les slash commands
#   6. demarre le bot avec pm2 et configure le redemarrage au boot
#
#  Relancer ce script est sans danger : il met simplement tout a jour.
# ============================================================

set -e  # stoppe au premier echec

echo "==> Verification de l'environnement..."

# --- 1. Node.js 20 + git ---
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
  echo "==> Installation de Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v git >/dev/null 2>&1; then
  echo "==> Installation de git..."
  apt-get install -y git
fi

echo "==> Node $(node -v) / npm $(npm -v)"

# --- 2. pm2 ---
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installation de pm2..."
  npm install -g pm2
fi

# --- 3. Dependances du bot ---
echo "==> Installation des dependances du bot..."
npm install --omit=dev

# --- 4. Verification du .env ---
if [ ! -f .env ]; then
  echo ""
  echo "!! ERREUR : fichier .env introuvable."
  echo "   Cree-le avec : cp .env.example .env  puis  nano .env"
  echo "   Renseigne au minimum DISCORD_TOKEN, CLIENT_ID et GUILD_ID, puis relance ce script."
  exit 1
fi

# --- 5. Enregistrement des slash commands ---
echo "==> Enregistrement des slash commands sur Discord..."
npm run deploy

# --- 6. Demarrage 24/7 avec pm2 ---
echo "==> Demarrage du bot avec pm2..."
pm2 start ecosystem.config.cjs --update-env || pm2 restart brawl-bot --update-env
pm2 save

echo ""
echo "==> Configuration du demarrage automatique au boot du serveur..."
pm2 startup systemd -u "$(whoami)" --hp "$HOME" | tail -n 1 | bash || true
pm2 save

echo ""
echo "============================================================"
echo " Termine. Le bot tourne maintenant 24/7."
echo "   Voir les logs :   pm2 logs brawl-bot"
echo "   Voir le statut :  pm2 status"
echo "   Redemarrer :      pm2 restart brawl-bot"
echo "============================================================"
