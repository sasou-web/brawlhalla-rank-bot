// Configuration pm2 pour faire tourner le bot 24/7 avec redemarrage automatique.
// Fichier en .cjs car le projet est en ESM ("type": "module" dans package.json),
// or pm2 attend une config au format CommonJS.
//
// Utilisation (sur le serveur, dans le dossier du projet) :
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup     # suivre la commande affichee pour le demarrage au boot
//
// Logs :     pm2 logs brawl-bot
// Statut :   pm2 status
// Restart :  pm2 restart brawl-bot

module.exports = {
  apps: [
    {
      name: "brawl-bot",
      script: "src/index.js",
      // Redemarre si le process plante, mais evite une boucle infinie de crash.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,
      // Garde la conso memoire sous controle (le bot est leger).
      max_memory_restart: "300M",
      // Horodatage dans les logs.
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
