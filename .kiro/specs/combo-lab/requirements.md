# Combo Lab & entraînement aux combos — exigences

Objectif : transformer le viewer de combos (`/combos` + panneau) en vrai outil d'apprentissage.
Le lecteur vidéo de Discord ne peut pas être piloté par un bot : les réglages fins vivent sur
une page web publique, Discord garde un ralenti prêt à l'emploi et une progression.

## 1. Combo Lab (page web publique `/lab/`)
- Servie par le serveur du dashboard (`<PUBLIC_URL>/lab/`), **sans connexion**.
- Choix de l'arme, liste des combos (recherche, tri par facilité), combo précis via `?c=<id>`
  (lien partageable, mis à jour quand on change de combo), vitesse initiale via `?speed=`.
- Lecteur : lecture/pause, vitesse 0.1x → 1x, image par image (1/60 s), barre de lecture avec
  numéro d'image, boucle A-B, zoom 1x → 4x centré sur le pointeur + déplacement (souris, doigt,
  pincement), miroir horizontal, boucle, plein écran, son coupé par défaut.
- Notation découpée en étapes, stats (facilité, dégâts, dextérité, dégâts moyens), lien BrawlDB.
- Raccourcis clavier (aide `?`), inactifs pendant la saisie dans la recherche.
- États : chargement (squelette), base vide, erreur API (réessayer), vidéo indisponible (lien BrawlDB),
  combo inconnu dans l'URL (message + premier combo de l'arme).
- Utilisable au clavier, sur mobile, libellés accessibles (aria), contraste suffisant.

## 2. Ralenti dans Discord
- Bouton « 🐌 Ralenti x0.25 » dans le viewer privé : remplace la vidéo par une version ralentie
  (x0.25, qualité d'origine, jouée 3 fois, sans son) ; bouton « ▶️ Vitesse normale » pour revenir.
- Généré avec ffmpeg à la demande SANS réencodage (horodatages étirés), mis en cache mémoire ;
  au plus 2 traitements simultanés. Coût négligeable sur un petit serveur.
- Sans ffmpeg sur le serveur : bouton masqué. Échec : vidéo normale + message.

## 3. Progression « Je maîtrise ce combo »
- Bouton bascule dans le viewer ; état visible (✅), progression par arme (x/y) dans le viewer
  et dans les menus (armes et combos).
- Stockage SQLite `combo_mastery` (par serveur, membre, combo), sauvegardé par `backup-data.sh`.
- XP : 10 XP la première fois qu'un combo est maîtrisé, au plus 5 combos récompensés par jour,
  jamais deux fois pour le même combo (décocher/recocher ne rapporte rien). Respecte l'activation
  des niveaux et le plafond journalier ; la montée de niveau suit le flux habituel.
- Succès : 1, 10 et 50 combos maîtrisés, et « tous les combos d'une arme ».

## 4. Sécurité
- Routes publiques en lecture seule, hors `/api` (compteur de rate-limit distinct), aucune donnée membre.
- Le proxy vidéo ne résout qu'un **id du dataset** (jamais une URL fournie) : pas de SSRF.
- CSP inchangée (vidéo servie par la même origine).

## Critères d'acceptation
- `/lab/` affiche un combo lisible au ralenti, image par image, zoomable, sur desktop et mobile.
- Les requêtes Range renvoient 206 + `Content-Range` ; plage invalide → 416.
- `/lab/api/combos` vide → état vide ; en erreur → message + « Réessayer ».
- Dans Discord : ralenti aller-retour, maîtrise aller-retour, XP accordée une seule fois par combo.
- `npm run ci` passe ; le mock (`npm run dash:mock`) sert le Lab pour les tests Playwright.
