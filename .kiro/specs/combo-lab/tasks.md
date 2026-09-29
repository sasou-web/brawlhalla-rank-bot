# Combo Lab — tâches

- [x] 1. `src/comboData.js` (pur) + refactor `combos.js` : exports vidéo, `comboById`, ralenti ffmpeg.
- [x] 2. Progression : `comboMastery.js`, `addBonusXp`, succès combos.
- [x] 3. Viewer Discord : boutons ralenti / maîtrise / Combo Lab, progression par arme, handlers (`commands/combos.js`), panneau.
- [x] 4. `src/web/comboLab.js` (routes + Range) monté dans `server.js` et `dash-mock.js`.
- [x] 5. Front `public/lab/` : lecteur, contrôles, raccourcis, états vide/chargement/erreur, mobile.
- [x] 6. Docs : README, DEPLOY.md (ffmpeg), `.env.example`, `install-server.sh`, steering, lien dans le dashboard.
- [x] 7. Vérifications : `npm run ci`, contrôles ponctuels hors dépôt (Range, table, XP, succès, payload
      du viewer, ralenti ffmpeg), Playwright sur le mock (combo, vitesse, image par image, A-B, zoom,
      miroir, états vide/erreur/lent, erreur vidéo, mobile 390 px, lien du dashboard).
      Pas de nouveau fichier de test (convention du projet : tests ajoutés sur demande).
- [ ] 8. En prod : `sudo apt-get install -y ffmpeg` sur le serveur, déployer, republier le panneau
      de combos depuis le dashboard (l'ancien message garde l'ancien texte), essai réel dans Discord.
