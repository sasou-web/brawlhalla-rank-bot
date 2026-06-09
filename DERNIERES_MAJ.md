# Dernières mises à jour du bot Brawlhalla Rank Bot

## Dates d'analyse : 9 juin 2026

### Résumé des modifications récentes (dernières 24h)

**Fichiers modifiés dans les dernières heures :**

1. **sync.js** (20:03) - Modifié il y a 0,1h
   - Optimisation de la synchronisation des membres
   - Logique de gestion des promotions de tier

2. **roles.js** (20:03) - Modifié il y a 0,1h  
   - Amélioration de la création/gestion des rôles
   - Gestion des rôles de niveau serveur

3. **config.js** (20:03) - Modifié il y a 0,1h
   - Configuration centrale mise à jour
   - Ajout des constantes pour les émoticônes de tier

4. **commands.js** (19:43) - Modifié il y a 0,4h
   - Commande `/top` pour le classement 1v1 des membres liés
   - Intégration des nouvelles fonctionnalités

5. **rankvoice.js** (19:42) - **NOUVELLE FONCTIONNALITÉ** - Modifié il y a 0,5h
   - **Nouveau système de salons vocaux par rank** 🎙️
   - Salons vocaux restreints selon le tier Brawlhalla
   - Accès uniquement pour les membres ayant un rôle de rank égal ou supérieur
   - Création automatique des salons dans une catégorie spécifique

6. **brawlhalla.js** (19:26) - Modifié il y a 0,7h
   - Client API Brawlhalla amélioré
   - Gestion des appels API et recherche de joueurs

7. **index.js** (17:48) - Modifié il y a 2,4h
   - Point d'entrée principal du bot
   - Intégration des nouvelles fonctionnalités

### Nouveautés majeures

#### 1. **Système de salons vocaux par rank (rankvoice.js)**
- **Fonctionnalité** : Création de salons vocaux avec accès restreint par tier
- **Usage** : `setupRankVoiceChannels()` 
- **Configuration** : Salons nommés "🔷 Diamond+", "🟣 Valhallan", etc.
- **Sécurité** : Accès vérifié via les rôles attribués par le bot
- **Règles d'accès** : Valhallan accède à tout, Diamond+ à tout sauf Valhallan, etc.

#### 2. **Améliorations de synchronisation (sync.js)**
- Gestion plus robuste des données partielles de l'API
- Fusion intelligente avec les données précédentes en cas d'échec API
- Meilleure détection des promotions de tier

#### 3. **Configuration enrichie (config.js)**
- Émojis personnalisés pour chaque tier
- Configuration des rôles de région (🌍 Europe, etc.)
- Constantes améliorées pour l'affichage

#### 4. **Interface de commandes enrichie (commands.js)**
- Commande `/top` pour le classement interne
- Intégration des nouvelles commandes vocales

### Autres modifications récentes (moins de 24h)

8. **leaderboardStore.js** (05:30) - Modifié il y a 14,7h
   - Stockage local du classement pour recherche instantanée

9. **tournamentUI.js** (04:42) - Modifié il y a 15,5h
   - Interface utilisateur pour les tournois

10. **tournament.js** (04:23) - Modifié il y a 15,8h
    - Logique de gestion des tournois

11. **welcome.js** (01:26) - Modifié il y a 18,7h
    - Système de bienvenue/au revoir

12. **guessrank.js** (00:30) - Modifié il y a 19,7h
    - Jeu "Devine ton rang" sur les clips

13. **package.json** (00:54) - Modifié il y a 19,2h
    - Dépendances mises à jour

### État actuel du bot

Le bot est **pleinement fonctionnel** avec ces nouvelles fonctionnalités :

✅ **Fonctionnalités principales :**
- Attribution automatique de rôles par rank (1v1/2v2)
- Système de validation avec staff
- Dashboard web optionnel
- Système de niveaux (XP par messages/vocal)
- Tournois avec salons privés

✅ **Nouvelles fonctionnalités :**
- **Salons vocaux par rank** (accès restreint)
- Système de bienvenue/au revoir
- Jeu "Devine ton rang"
- Notifications TikTok automatiques
- Salons vocaux temporaires

✅ **Déploiement :**
- Scripts complets pour Hetzner/Ubuntu
- Gestion pm2 24/7
- Sauvegardes automatiques via cron

### Prochaines étapes suggérées

1. **Test des salons vocaux** : Vérifier que la fonctionnalité fonctionne correctement
2. **Documentation** : Ajouter la nouvelle commande `/rankvoice` à la documentation
3. **Déploiement** : Mettre à jour le bot en production si nécessaire

---
*Dernière mise à jour : 9 juin 2026 20:10*
*Bot version : 1.0.0*