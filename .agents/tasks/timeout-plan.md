# Plan d'implémentation : `/timeout` par rôle + section dashboard « Timeout par rôle »

Projet : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot` (noté `BOT` dans le texte ; les listes « Fichiers » donnent les chemins absolus).
Contraintes : aucune dépendance ajoutée, aucun commit, ne jamais lancer `npm start` / `npm run deploy`, ne jamais toucher `data/bot.db` (tests via `npm test`, qui impose `BOT_DB_PATH` temporaire). Commandes de vérification lancées depuis la racine du workspace (`c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl`). Arbre git propre au départ (`git status` vide) ; `.agents/` n'est pas gitignoré : ce plan apparaîtra comme fichier non suivi.

## 0. Constats de l'investigation

- (a) Aucune commande ni module de timeout. Le seul timeout existant est l'exclusion automatique interne du filtre de mots (`maybeTimeout` dans `BOT\src\wordfilter.js` : `member.moderatable`, `member.timeout(ms, reason)`, borne 1 à 40 320 min). Ce n'est pas une commande : rien à étendre. On reprend ses conventions (contrôle `moderatable`, borne 28 j, journal).
- (b) Journaux existants : `wordfilter.logChannelId` (« Journal de modération » du dashboard, embeds envoyés par `postLog`) et le salon d'audit `settings.auditChannelId` via `logAudit(guild, text)` (`BOT\src\commands\shared.js`, utilisé notamment par `/clear`).
- (c) Réglages : documents JSON dans la table `kv` via `loadDoc/saveDoc` (`BOT\src\db.js`). Forme par serveur `{ guilds: { [guildId]: {...} } }`, config séparée de l'état (`wordfilter` / `wordfilterState`). Dashboard : `buildSections()` dans `BOT\src\web\server.js`, `GET /api/config`, `PUT /api/config/:section` (protégée par `requireAdmin`, filtre anti mass-assignment sur les clés de `get()`, toute erreur → 500). Front : `configForm(section)` n'envoie que les clés modifiées ; `moduleSwitch` envoie `{ enabled }` seul.
- (d) `BOT\src\commands\cooldowns.js` : `checkCooldown` arme le cooldown pendant la vérification elle-même et ne garde rien en mémoire après un redémarrage. Il ne convient pas : le cooldown ne doit être consommé qu'après un timeout réussi, et un cooldown pouvant atteindre 24 h doit survivre aux redémarrages pm2 et aux déploiements. Le fichier reste inchangé.
- (e) Commandes : `SlashCommandBuilder…toJSON()` dans `commandsData` (`BOT\src\commands\definitions.js`), aiguillage `switch` dans `handleChatInput` (`BOT\src\commands.js`), gardes `MANAGE_GUILD_COMMANDS` / `MANAGE_MESSAGES_COMMANDS`. Aucune sous-commande dans tout le bot. Enregistrement Discord par `npm run deploy` (lancé par `update.sh` en prod).
- (f) Dashboard : scripts classiques à portée globale partagée (un nom de premier niveau ne doit exister que dans un seul fichier ; ESLint dérive les globales de ces déclarations). Navigation dans `NAV_GROUPS` (`dash-shell.js`). Page modèle : `renderWordFilter` (`dash-pages-moderation.js`) : `pageHeader` + `moduleSwitch`, `infoStrip` avec squelettes, `inlineError` + réessayer, `callout`, `settingsGroup` / `field` / `multiRolePicker` / `numberInput`. La route PUT est protégée par `requireAdmin` (JWT signé, cookie httpOnly sameSite=lax, revérification de ManageGuild en direct avec cache de 60 s). Aucune route non authentifiée n'est ajoutée. Mock sans Discord : `BOT\scripts\dash-mock.js`.
- Versions installées : discord.js 14.26.4 (`RESTJSONErrorCodes.MissingPermissions` = 50013, `UnknownMember` = 10007, `GuildMember#moderatable` = non admin + `manageable` + le bot a ModerateMembers), Express 4.22.2.

## 1. Décisions

- D1 Plusieurs rôles : `allowedRoleIds: string[]` (25 au maximum), même forme que `wordfilter.exemptRoleIds`, édité avec le `multiRolePicker` existant.
- D2 Contournement par les modérateurs natifs : un membre ayant ModerateMembers peut toujours utiliser `/timeout`, même module désactivé, sans cooldown (ni vérifié ni armé). `permissions.has(ModerateMembers)` couvre aussi Administrator et le propriétaire. Désactiver le module ne coupe que la délégation par rôle.
- D3 Cibles refusées pour tous les exécutants, modérateurs compris (ils gardent l'interface native de Discord pour les cas staff contre staff) : soi-même ; tout bot (message dédié pour le bot lui-même) ; propriétaire du serveur ; membre ayant Administrator ou ModerateMembers ; membre dont le rôle le plus haut est égal ou supérieur à celui de l'exécutant (sauf si l'exécutant est propriétaire) ; `!member.moderatable` ; membre déjà exclu. Ce dernier refus empêche un rôle délégué de raccourcir, donc de lever en pratique, une sanction posée par le staff.
- D4 Durée : option texte `duree` qui reprend la grammaire de `parseDuration` des giveaways (`w/d/h/m/s` combinables, nombre seul = minutes), en version stricte. Elle refuse « 2.5h » ou « 10x », que `parseDuration` interprète à tort (5 h, 10 min). Bornes : 1 min à 28 j (2 419 200 000 ms = 40 320 min, comme le filtre de mots). Le code vit dans un module pur sans import, réutilisable par le mock (même principe que `wordfilterEngine.js`).
- D5 Cooldown : `cooldownSec`, entier de 0 à 86 400 (24 h), 300 par défaut, 0 = désactivé. L'unité est la seconde comme pour `levels.cooldownSec` ; le dashboard affiche aussi la valeur lisible avec `fmtDuration`. Il est compté par (serveur, exécutant), persisté dans kv `roletimeoutState` et écrit uniquement après un `member.timeout()` réussi. Un verrou en mémoire par (serveur, exécutant) bloque les doubles envois simultanés.
- D6 Journal : embed dans `wordfilter.logChannelId` s'il est défini et textuel (« Journal de modération »), sinon `logAudit` (salon d'audit). Envoi au mieux, sans jamais lever d'erreur. Contenu : exécutant, cible, durée, fin, raison, autorisation (rôle ou modérateur).
- D7 Levée du timeout : non implémentée. Le bot n'utilise aucune sous-commande et `/timeout` reste une commande plate comme demandé. Suggestion en §7.
- D8 Validation serveur : les valeurs invalides sont rejetées avec un 400 et un message en français, sans correction silencieuse. Les erreurs portent `httpStatus`. Le handler PUT est extrait dans `BOT\src\web\configApi.js` pour être testable sans Express ni Discord. Les rôles ne sont vérifiés auprès de Discord que si `allowedRoleIds` figure dans le patch ; si Discord ne répond pas, la route renvoie 503.
- D9 Réponses : toutes éphémères (succès compris), avec `allowedMentions: { parse: [] }`. Pas de `setDefaultMemberPermissions` sur `/timeout` : le contrôle se fait dans le handler.

## 2. Stockage (table `kv`, via `loadDoc` / `saveDoc`)

```text
kv "roletimeout"      : { guilds: { [guildId]: { enabled: boolean, allowedRoleIds: string[], cooldownSec: integer } } }
                        défauts : { enabled: false, allowedRoleIds: [], cooldownSec: 300 }
kv "roletimeoutState" : { guilds: { [guildId]: { lastUse: { [executorUserId]: tsMs } } } }
                        écrit seulement après un timeout réussi ; entrées > 24 h purgées à chaque écriture ; jamais exposé au dashboard
```

## 3. Commande `/timeout`

```text
/timeout membre:<User, requis> duree:<String, requis, max 20> [raison:<String, facultatif, max 400>]
```

Description : « Exclut temporairement un membre (rôles autorisés dans le dashboard). »
Option `duree` : « Durée : 10m, 2h, 1d… (nombre seul = minutes, max 28d). »
Handler `handleTimeout` dans `BOT\src\commands\moderation.js`, dans cet ordre :
1. Hors serveur → « Cette commande s'utilise sur un serveur. »
2. `cfg = await getRoleTimeoutConfig(guild.id)`. Exécutant = `interaction.member` s'il a `roles.cache`, sinon `guild.members.fetch(user.id)`. Cible = `guild.members.fetch(options.getUser("membre", true).id)` ; si introuvable → « Ce membre n'est pas (ou plus) sur le serveur. »
3. `evaluateTimeoutRequest({ config: cfg, executor: describeMember(...), target: describeMember(...), botUserId: client.user.id, now })` → refus éphémère avec le message renvoyé.
4. `parseTimeoutDuration(options.getString("duree", true))` → refus éphémère.
5. Sans contournement : `getTimeoutCooldownRemaining(...)` > 0 → « ⏳ Tu pourras réutiliser /timeout dans **{formatDuration(arrondi à la seconde)}**. » (`formatDuration` vient de `BOT\src\giveaway.js`).
6. Verrou : déjà en cours → « ⏳ Un timeout est déjà en cours de traitement, patiente un instant. » ; sinon ajout au Set, retiré dans `finally`.
7. `deferReply({ flags: EPHEMERAL })`, puis `target.timeout(ms, raisonAudit)` avec `raisonAudit = "{raison || 'Aucune raison précisée'} · par {user.tag} via /timeout"`, tronquée à 512 caractères.
8. Erreur Discord : rien n'est enregistré. Codes : 50013 → « Discord a refusé : il me manque la permission « Exclure temporairement des membres » ou le rôle de ce membre est au-dessus du mien. » ; 10007 → « Ce membre a quitté le serveur. » ; autre → « Le timeout a échoué : {message} ». Chaque message se termine par « Ton cooldown n'est pas consommé. »
9. Succès : `recordTimeoutUse` (sauf pour un modérateur), journal (D6), `console.log` (visible dans le journal du dashboard), puis `editReply` : « ✅ <@cible> est exclu pour **{durée}** (fin <t:unix:R>). », suivi, si un cooldown est armé, de la ligne `-# Prochain /timeout possible dans {durée}.`

Messages d'`evaluateTimeoutRequest` (codes en gras), testés par regex :
- **disabled** « La commande /timeout est désactivée sur ce serveur. »
- **forbidden** « Tu n'as pas la permission d'utiliser /timeout. »
- **self** « Tu ne peux pas t'exclure toi-même. »
- **self-bot** « Je ne peux pas m'exclure moi-même. »
- **bot** « Impossible d'exclure un bot. »
- **owner** « Impossible d'exclure le propriétaire du serveur. »
- **staff** « Impossible d'exclure un administrateur ou un modérateur. »
- **hierarchy** « Ce membre a un rôle égal ou supérieur au tien. »
- **unmoderatable** « Je ne peux pas exclure ce membre : son rôle est au-dessus du mien ou il me manque la permission « Exclure temporairement des membres ». »
- **already** « Ce membre est déjà exclu jusqu'à <t:unix:f>. »

## 4. Dashboard

- Navigation (`dash-shell.js`, groupe « Modération », après « Filtre de mots ») : `{ id: "roletimeout", label: "Timeout par rôle", icon: "clock", keywords: "timeout exclusion temporaire mute sanction rôle cooldown modération", render: (ctx) => renderRoleTimeout(ctx) }`, sans onglets.
- Page `renderRoleTimeout(ctx)` (`dash-pages-moderation.js`, préfixe `rt` pour les noms de premier niveau) :
  - `pageHeader` : titre « Timeout par rôle », description « Autorise des rôles à exclure temporairement des membres avec la commande /timeout. », action `moduleSwitch("roletimeout", "Timeout par rôle")`.
  - Bandeau d'état (`infoStrip`) : « Rôles autorisés » (compteur `watch`), « Cooldown » (`fmtDuration` ou « Aucun »), « Permission du bot » (squelette pendant le chargement de `GET /api/roletimeout/status`, puis `statusDot` ok « Accordée » ou danger « Manquante »). En cas d'erreur : `inlineError("État du bot indisponible : …", réessayer)`.
  - Alertes recalculées (`watch`) : permission manquante (danger) ; module actif sans rôle (warn : « Aucun rôle autorisé : seuls les membres ayant « Exclure temporairement des membres » peuvent utiliser /timeout. ») ; aucun journal configuré (info).
  - Groupes :
    - « Rôles autorisés » : `multiRolePicker(c, "allowedRoleIds")` ; l'état vide affiche déjà « Aucun rôle sélectionné. ». Aide : les modérateurs natifs l'utilisent toujours, sans cooldown.
    - « Cooldown » : `numberInput(c, "cooldownSec", { min: 0, max: 86400, step: 1, suffix: "s", size: "md" })`, aide « 0 : pas de cooldown. Maximum 86 400 s (24 h). Seuls les timeouts réussis le déclenchent. », résumé `fmtDuration`.
    - « Règles appliquées » : liste statique de D3, plus la durée (1 min à 28 j) et le rappel « commande à enregistrer avec `npm run deploy` ».
    - « Journal » : salon effectif (`CONFIG.wordfilter.logChannelId`, sinon `CONFIG.settings.auditChannelId`, via `channelName`), avec le bouton `navigate("wordfilter", "sanctions")`.
  - Enregistrement : barre d'enregistrement existante (`configForm`). Une erreur 400 ou 503 du serveur s'affiche en toast via `runBusy`, et la barre reste visible.
- Vue d'ensemble (`dash-pages-overview.js`) : ajout à `MODULES` (`{ section: "roletimeout", label: "Timeout par rôle", page: "roletimeout" }`) et à `configWarnings` (actif sans rôle).
- Serveur : section `roletimeout` dans `buildSections`, `GET /api/roletimeout/status` (`requireAdmin`) → `{ permissions: { moderateMembers }, botRoleName }`.

## 5. Tests Node à ajouter (`BOT\test\`)

`roleTimeout.rules.test.js` (module pur) :
1. `parseTimeoutDuration` : unités simples et combinées (`10m`=600000, `2h`, `1d`, `1w`, `1h30m`), casse et espaces tolérés (`1D 12H`).
2. Nombre seul = minutes (`15` → 900000).
3. Bornes : `1m` et `28d` / `4w` acceptés (= `TIMEOUT_MAX_MS`) ; `30s` (trop courte), `29d` (trop longue) et `0` refusés.
4. Syntaxe invalide refusée : `""`, `abc`, `2.5h`, `10x`, `-5m`, `1h abc`.
5. `cooldownRemainingMs` bloque pendant la fenêtre : last = now − 100 000, 300 s → 200 000.
6. `cooldownRemainingMs` vaut 0 après expiration ou si le membre n'a jamais utilisé la commande (`lastTs` 0 ou undefined).
7. `cooldownRemainingMs` avec `cooldownSec` 0 = désactivé → 0.
8. `validateRoleTimeoutPatch` : patch valide accepté et nettoyé (rôles dédoublonnés, clés inconnues ignorées).
9. Cooldown hors bornes (−1, 86 401), non entier (2.5), non numérique (`"300"`, `null`) → refus, message `/cooldown/i`.
10. Bornes 0 et 86 400 acceptées.
11. Rôle inconnu → `/introuvable/` ; `@everyone` → `/everyone/` ; id non textuel → introuvable ; plus de 25 rôles → `/25/`.
12. `enabled` non booléen refusé ; `allowedRoleIds` qui n'est pas un tableau refusé.
13. `allowedRoleIds` sans `roleIds` fournis → refus (aucune validation à l'aveugle).
14. `evaluateTimeoutRequest` : rôle autorisé → ok, `via: "role"`, `roleId`, `bypassCooldown: false`.
15. Rôle non autorisé → `forbidden`.
16. Module désactivé → `disabled` pour un membre du rôle.
17. Contournement ModerateMembers : ok sans rôle et module désactivé, `bypassCooldown: true`, `via: "moderator"`.
18. Hiérarchie égale ou supérieure → `hierarchy` ; un exécutant propriétaire n'est pas soumis à la hiérarchie.
19. Auto-timeout → `self`, y compris pour un modérateur.
20. Cible = le bot lui-même → `self-bot` ; autre bot → `bot`.
21. Cible administrateur ou modérateur → `staff` ; propriétaire → `owner`.
22. Cible non modérable → `unmoderatable`.
23. Cible déjà exclue (`timedOutUntil` > now) → `already` ; exclusion expirée → ok.

`roleTimeout.config.test.js` (stockage + route PUT du dashboard via `configPutHandler` et la vraie section `roleTimeoutSection`, avec un faux `res`) :
1. `getRoleTimeoutConfig` renvoie les défauts pour un serveur inconnu.
2. `setRoleTimeoutConfig` : un patch valide est persisté ; `resolveRoles` n'est pas appelé si `allowedRoleIds` est absent du patch.
3. `recordTimeoutUse` / `getTimeoutCooldownRemaining` : > 0 juste après ; 0 pour un autre membre ou un autre serveur ; 0 si `cooldownSec` vaut 0.
4. PUT, cooldown hors bornes (−1, 86 401) → 400, message en français, config inchangée.
5. PUT, cooldown non entier (2.5) → 400.
6. PUT, rôle inexistant → 400 « Rôle introuvable » ; `@everyone` → 400 ; config inchangée dans les deux cas.
7. PUT, patch valide → 200 et config renvoyée ; clés inconnues (`foo`, `isAdmin`) non persistées.
8. PUT, section inconnue → 404.
9. PUT, `resolveRoles` qui rejette → 503.
10. PUT, une autre section qui lève une erreur sans `httpStatus` → 500 (comportement historique conservé).

`roleTimeout.command.test.js` (handler avec mocks d'interaction, de guild et de membres ; le `timeout()` simulé renseigne `communicationDisabledUntilTimestamp`, d'où une cible différente à chaque essai) :
1. Rôle autorisé : `timeout(600000, raison)` appelé ; la raison contient le texte saisi et l'exécutant ; réponse éphémère ✅ ; cooldown armé (> 0).
2. Cooldown bloquant : un 2e `/timeout` (autre cible) est refusé avec « ⏳ » et le temps restant (`/\d+ (min|s)/`) ; ni `timeout` ni `deferReply` appelés.
3. Échec API (rejet avec code 50013) : message éphémère en français mentionnant la permission ; cooldown NON consommé (restant = 0) ; un nouvel essai atteint bien `timeout`.
4. Échec API 10007 → « a quitté le serveur ».
5. `cooldownSec` 0 : deux timeouts consécutifs réussissent.
6. Membre sans rôle autorisé : refus éphémère, ni `timeout` ni `deferReply`.
7. Module désactivé : refus pour le rôle ; un exécutant ModerateMembers réussit deux fois de suite (cooldown ni vérifié ni armé).
8. Hiérarchie (cible de rôle égal) → refus, `timeout` non appelé.
9. Auto-timeout → refus ; cible = le bot → refus.
10. Durée invalide (`2.5h`) → refus, `timeout` non appelé.
11. Cible déjà exclue → refus.

Extension de `BOT\test\permissions.test.js` :
12. `/timeout` n'a pas de `default_member_permissions` ; options `membre` (type 6, requis), `duree` (type 3, requis, `max_length` 20), `raison` (type 3, facultatif) ; absente de `MANAGE_GUILD_COMMANDS` et `MANAGE_MESSAGES_COMMANDS`.
13. `handleChatInput` aiguille `timeout` vers le handler : un membre non autorisé reçoit le refus « permission » de `/timeout`, pas « Réservé aux administrateurs ».

## 6. Tâches ordonnées

- [x] 1. Créer le module pur des règles.
      Créer `roleTimeoutRules.js` sans aucun import. Exports : `TIMEOUT_MIN_MS` (60 000), `TIMEOUT_MAX_MS` (28 × 86 400 000), `COOLDOWN_MAX_SEC` (86 400), `DEFAULT_COOLDOWN_SEC` (300), `MAX_ALLOWED_ROLES` (25), `defaultRoleTimeoutConfig()` (objet neuf), `parseTimeoutDuration(input)` → `{ ok, ms } | { ok: false, error }`, `cooldownRemainingMs(lastTs, cooldownSec, now)`, `validateRoleTimeoutPatch(patch, { roleIds, everyoneRoleId })` → `{ ok, value } | { ok: false, error }`, `evaluateTimeoutRequest({ config, executor, target, botUserId, now })` → `{ ok: true, bypassCooldown, via, roleId } | { ok: false, code, message }`, avec les messages et l'ordre du §3. Descripteur de membre attendu : `{ id, isBot, isOwner, isAdmin, isModerator, roleIds, highestPosition, moderatable, timedOutUntil }`. La validation de patch n'exige pas le format snowflake (le mock utilise des ids courts) : un rôle est valide s'il est textuel, fait 32 caractères au plus, figure dans `roleIds` et n'est pas `everyoneRoleId`. Messages : « Durée invalide. Exemples : 10m, 2h, 1d, 1h30m (nombre seul = minutes). », « Durée trop courte : minimum 1 minute. », « Durée trop longue : maximum 28 jours (limite Discord). », « Le cooldown doit être un nombre entier de secondes entre 0 et 86 400 (24 h). », « Rôle introuvable sur le serveur : {id}. », « Le rôle @everyone ne peut pas être autorisé : tout le monde pourrait exclure. », « 25 rôles autorisés au maximum. ». Écrire ensuite les tests 1 à 23 de `roleTimeout.rules.test.js`.
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\roleTimeoutRules.js` (nouveau), `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\test\roleTimeout.rules.test.js` (nouveau)
      Vérification : `npm run check --prefix xray-kaya-bot` et `npm test --prefix xray-kaya-bot` → les nouveaux tests passent, les tests existants restent verts.

- [x] 2. Créer le stockage par serveur (dépend de 1).
      `roleTimeout.js` importe `loadDoc` / `saveDoc` de `./db.js` et `roleTimeoutRules.js`. Documents en cache comme dans `wordfilter.js` (`configs()` / `states()`). Exports : `getRoleTimeoutConfig(guildId)` (copie avec défauts, tableau copié) ; `class RoleTimeoutConfigError extends Error` (`httpStatus`, 400 par défaut) ; `setRoleTimeoutConfig(guildId, patch, { resolveRoles } = {})`. Ce dernier n'appelle `await resolveRoles()` que si `"allowedRoleIds" in patch` ; s'il rejette → `RoleTimeoutConfigError("Impossible de vérifier les rôles du serveur (Discord injoignable). Réessaie.", 503)` ; une validation KO → `RoleTimeoutConfigError(error, 400)` sans rien écrire ; sinon `Object.assign` + `saveDoc`, puis retour de `get`. Également `roleTimeoutSection(guildId, resolveRoles)` → `{ get, set }`, `getTimeoutCooldownRemaining(guildId, userId, cooldownSec, now = Date.now())` et `recordTimeoutUse(guildId, userId, now = Date.now())` (purge des entrées de plus de 24 h). Écrire ensuite les tests 1 à 3 de `roleTimeout.config.test.js` (ids de guild uniques par test).
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\roleTimeout.js` (nouveau), `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\test\roleTimeout.config.test.js` (nouveau)
      Vérification : `npm run check --prefix xray-kaya-bot` puis `npm test --prefix xray-kaya-bot` → tests verts.

- [x] 3. Extraire la route PUT et brancher la section dans le serveur (dépend de 2).
      Dans `configApi.js`, `export function configPutHandler(sections)` reprend à l'identique la logique du `app.put("/api/config/:section", …)` actuel (404 si la section est inconnue, filtre anti mass-assignment sur `Object.keys(await s.get())`, `res.json(updated)`). Dans le `catch`, le statut vaut `err.httpStatus` si c'est un entier entre 400 et 599, sinon 500. Dans `server.js` :
      - importer `configPutHandler` et `roleTimeoutSection` ;
      - `buildSections(guildId, client)` ajoute `roletimeout: roleTimeoutSection(guildId, async () => { const guild = await client.guilds.fetch(guildId); await guild.roles.fetch(); return { roleIds: new Set(guild.roles.cache.keys()), everyoneRoleId: guild.id }; })` ;
      - l'appel devient `buildSections(config.guildId, client)` ;
      - la route inline est remplacée par `app.put("/api/config/:section", requireAdmin, configPutHandler(sections));` ;
      - ajouter, après les routes du filtre de mots, `app.get("/api/roletimeout/status", requireAdmin, …)` qui renvoie `{ permissions: { moderateMembers: me.permissions.has(PermissionFlagsBits.ModerateMembers) }, botRoleName: me.roles.highest.name }` (500 avec `{ error }` en cas d'échec).
      Écrire ensuite les tests 4 à 10 de `roleTimeout.config.test.js`.
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\web\configApi.js` (nouveau), `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\web\server.js`, `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\test\roleTimeout.config.test.js`
      Vérification : `npm run check --prefix xray-kaya-bot`, `npm run lint --prefix xray-kaya-bot` (0 erreur), `npm test --prefix xray-kaya-bot` → tests verts.

- [x] 4. Ajouter la commande slash et son handler (dépend de 1 et 2).
      - `definitions.js` : ajouter `/timeout` après `clear`, selon le §3, sans `setDefaultMemberPermissions`, avec `setMaxLength(20)` sur `duree` et `setMaxLength(400)` sur `raison`.
      - `moderation.js` : exporte `handleTimeout(interaction, ctx)`. Fonctions internes : `describeMember(member, guild)` (lecture défensive de `permissions.has`, `roles.cache.keys()`, `roles.highest.position`, `moderatable` dans un try, `communicationDisabledUntilTimestamp ?? 0`), `inFlight` (Set), `apiErrorMessage(err)` (`RESTJSONErrorCodes`), `logRoleTimeout(guild, entry)` (D6 : embed couleur `0xd6a13b`, champs Fin `<t:unix:f>`, Autorisation `Rôle <@&id>` ou « Modérateur », Raison ; `allowedMentions: { parse: [] }` ; repli `logAudit(guild, "⏳ <@exec> a exclu <@cible> pour **durée** via /timeout — raison")`). Imports : `../roleTimeout.js`, `../roleTimeoutRules.js`, `formatDuration` de `../giveaway.js`, `getWordFilterConfig` de `../wordfilter.js`, `EPHEMERAL` / `logAudit` de `./shared.js`.
      - `commands.js` : importer le handler, ajouter `case "timeout": return handleTimeout(interaction, ctx);` et un commentaire expliquant pourquoi `timeout` n'est dans aucun ensemble MANAGE_* (droits vérifiés dans le handler).
      - Écrire `roleTimeout.command.test.js` (tests 1 à 11) et ajouter les tests 12 et 13 à `permissions.test.js`.
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\commands\definitions.js`, `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\commands\moderation.js` (nouveau), `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\commands.js`, `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\test\roleTimeout.command.test.js` (nouveau), `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\test\permissions.test.js`
      Vérification : `npm run check --prefix xray-kaya-bot`, `npm run lint --prefix xray-kaya-bot`, `npm test --prefix xray-kaya-bot` → tests verts, aucun appel réseau (le journal est vide sur la base de test).

- [x] 5. Ajouter la page « Timeout par rôle » au dashboard (dépend de 3 pour l'API).
      Ajouter l'entrée de navigation (§4) dans `dash-shell.js`, la page `renderRoleTimeout` (§4, noms de premier niveau préfixés `rt`, réutilisation exclusive des composants existants : `configForm`, `moduleSwitch`, `infoStrip`, `skel`, `inlineError`, `callout`, `settingsGroup`, `field`, `multiRolePicker`, `numberInput`, `statusDot`, `fmtDuration`, `channelName`, `button`, `navigate`) en fin de `dash-pages-moderation.js`, et l'entrée `MODULES` plus l'alerte « actif sans rôle » dans `dash-pages-overview.js`. Tous les textes sont en français.
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\web\public\dash-shell.js`, `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\web\public\dash-pages-moderation.js`, `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\src\web\public\dash-pages-overview.js`
      Vérification : `npm run check --prefix xray-kaya-bot` et `npm run lint --prefix xray-kaya-bot` (pas de `no-undef`, pas de nom global en double).

- [x] 6. Étendre le mock du dashboard (dépend de 1).
      Dans `dash-mock.js` :
      - importer `validateRoleTimeoutPatch` de `../src/roleTimeoutRules.js` ;
      - `baseConfig()` reçoit `roletimeout: { enabled: scenario !== "empty", allowedRoleIds: scenario === "empty" ? [] : [roleId("Staff")], cooldownSec: 300 }` ;
      - dans `PUT /api/config/:section`, pour `roletimeout`, valider avec `{ roleIds: new Set(roles.map((r) => r.id)), everyoneRoleId: guild.id }` → `fail(res, v.error, 400)` si KO, sinon appliquer `v.value` ;
      - ajouter `GET /api/roletimeout/status` → `{ permissions: { moderateMembers: scenario !== "empty" }, botRoleName: "XK Bot" }` ;
      - ajouter `"/roletimeout/status"` à la liste des erreurs simulées du scénario `errors`.
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\scripts\dash-mock.js`
      Vérification : `npm run lint --prefix xray-kaya-bot` → 0 erreur.

- [x] 7. Vérifier le parcours dashboard avec Playwright sur le mock (dépend de 5 et 6).
      Lancer `npm run dash:mock --prefix xray-kaya-bot` en arrière-plan (http://127.0.0.1:4173, sans Discord), puis :
      - scénario `full` (`/__mock/scenario/full`) : ouvrir `#/roletimeout` ; la page, le bandeau et le rôle « Staff » s'affichent. Ajouter un rôle et mettre le cooldown à 600, enregistrer → toast « Modifications enregistrées ». Saisir 2.5, enregistrer → toast d'erreur « Le cooldown doit être un nombre entier… », la barre d'enregistrement reste visible. L'interrupteur du module fonctionne.
      - `empty` : « Aucun rôle sélectionné. » et alerte de permission manquante.
      - `slow` : squelette visible pendant le chargement.
      - `errors` : `inlineError` avec « Réessayer ».
      - Console navigateur sans erreur ; navigation et Ctrl+K trouvent « Timeout par rôle ».
      Arrêter le mock à la fin.
      Fichiers : aucun (vérification).
      Vérification : captures et snapshots Playwright conformes ; noter tout écart.

- [x] 8. Mettre à jour le README (dépend de 4 et 5).
      - « Commandes › Staff / Admin » : ajouter `/timeout <membre> <durée> [raison]`.
      - Nouvelle section concise « Timeout par rôle » : réglage dans Modération › Timeout par rôle (activation, rôles autorisés, cooldown de 0 à 24 h par membre, persistant, consommé seulement après succès) ; modérateurs natifs toujours autorisés sans cooldown ; protections D3 ; durée de 1 min à 28 j au format `10m` / `2h` / `1d` ; journal (D6) ; permission « Exclure temporairement des membres » requise pour le bot, rôle placé au-dessus des cibles ; commande enregistrée par `npm run deploy` (lancé par `update.sh`).
      - Ajouter `moderation.js` à la liste des modules de `src/commands/` (section Architecture).
      Fichiers : `c:\Users\ogsas\Documents\Projets\Apps\workspace bot brawl\xray-kaya-bot\README.md`
      Vérification : relecture ; cohérence avec les messages et les bornes du code.

- [x] 9. Vérification complète et relecture (dépend de tout).
      Lancer `npm run ci --prefix xray-kaya-bot` (check + lint + tests), relire le diff (`git -C xray-kaya-bot diff` + fichiers nouveaux), confirmer que `data/bot.db` n'a pas changé, qu'aucune dépendance n'a été ajoutée (`package.json` et `package-lock.json` intacts), et que `start` / `deploy` n'ont pas été lancés. Signaler précisément ce qui a été vérifié et ce qui ne l'a pas été : le comportement réel sur Discord (permissions, hiérarchie, rendu du journal) n'est pas testable sans enregistrer la commande.
      Fichiers : aucun.
      Vérification : `npm run ci --prefix xray-kaya-bot` → succès.

## 7. Hors périmètre et suggestions

- Commande plate `/untimeout membre [raison]` qui réutilise `evaluateTimeoutRequest` (sans la règle « déjà exclu »), sans cooldown, journalisée.
- Durée maximale configurable pour les rôles délégués (aujourd'hui 28 j, comme Discord).
- Alias `j` (jours) dans la grammaire des durées, si on l'ajoute aussi aux giveaways.
- MP à la cible lors d'un timeout.
- Ajouter `roletimeout` / `roletimeoutState` à la liste des clés `kv` de `.kiro/steering/projet.md`. Les sauvegardes couvrent déjà toute la table `kv`.

## 8. Journal d'exécution (itération 1)

Commandes lancées depuis la racine du workspace :
- Avant tout changement : `npm test --prefix xray-kaya-bot` → 160 tests, 160 OK.
- `npm run check --prefix xray-kaya-bot` → « 85 fichiers OK (node --check) ».
- `npm run lint --prefix xray-kaya-bot` → code de sortie 0, aucune erreur ni avertissement.
- `npm test --prefix xray-kaya-bot` → 208 tests, 208 OK, 0 échec (48 nouveaux : 24 dans `roleTimeout.rules.test.js`, 10 dans `roleTimeout.config.test.js`, 12 dans `roleTimeout.command.test.js`, 2 dans `permissions.test.js`).
- `npm run ci --prefix xray-kaya-bot` (final) → code de sortie 0 : check 85 fichiers OK, lint propre, 208/208 tests OK.
- `package.json` et `package-lock.json` inchangés (`git diff --quiet`). `data/bot.db` non ouvert (tests sur base temporaire, mock sans base) : dernière écriture antérieure à la session. Ni `start` ni `deploy` lancés. Aucun script Python exécuté.

Écarts et ajouts par rapport au plan :
- Test supplémentaire dans `roleTimeout.command.test.js` : deux `/timeout` simultanés du même exécutant, un seul passe (verrou D5).
- Exécutant introuvable (fetch en échec) : refus « Impossible de vérifier tes rôles. Réessaie dans un instant. » (cas non prévu par le plan).
- Journal (D6) : si l'envoi de l'embed dans le journal de modération échoue, repli sur `logAudit`.
- Bandeau du dashboard en erreur : les cellules « Rôles autorisés » et « Cooldown » restent affichées, « Permission du bot » passe à « Inconnue », suivi de `inlineError` + « Réessayer ».

Vérification Playwright sur `npm run dash:mock` (http://127.0.0.1:4173), mock arrêté à la fin :
- `full` : page `#/roletimeout` affichée (en-tête + interrupteur « Actif », bandeau 1 rôle / 5 min / Accordée, puce « Staff », cooldown 300, règles, journal « #audit · Journal de modération »). Ajout du rôle « Tournoi » + cooldown 600 → bandeau et résumé mis à jour en direct, barre d'enregistrement visible ; enregistrement → toast « Modifications enregistrées », config du mock = 2 rôles / 600. Cooldown 2.5 → 400, toast « Le cooldown doit être un nombre entier de secondes entre 0 et 86 400 (24 h). », barre toujours visible, config inchangée. Interrupteur : Inactif puis Actif (toast « Module « Timeout par rôle » activé »).
- `empty` : « Aucun rôle sélectionné. », alerte danger « Permission manquante » ; module activé → alerte « Aucun rôle autorisé… » ; vue d'ensemble : ligne de module + avertissement « actif sans rôle autorisé ».
- `slow` : squelette dans la cellule « Permission du bot » pendant le chargement, puis « Accordée ».
- `errors` : `inlineError` « État du bot indisponible : Erreur interne simulée » + « Réessayer » ; après retour en `full`, « Réessayer » recharge l'état.
- Console : seules erreurs = réponses HTTP simulées (500 du scénario `errors`, 400 attendu de la validation) ; aucune exception JS. Navigation : entrée après « Filtre de mots » ; Ctrl+K « mute » → « Timeout par rôle ».

Non vérifié (impossible sans enregistrer la commande sur Discord) : comportement réel de `/timeout` sur un serveur (permissions, hiérarchie, `member.moderatable`, rendu de l'embed du journal, autocomplétion des options), et route `GET /api/roletimeout/status` du vrai serveur (testée seulement via le mock).

## 9. Journal d'exécution (itération 2 : corrections de la revue `timeout-review.json`)

Corrections (seuls `src/commands/moderation.js` et `test/roleTimeout.command.test.js` ont changé) :
- Finding 1 (bloquant) : le repli de `logRoleTimeout` passe à `logAudit` l'objet `{ content, allowedMentions: { parse: [] } }`. La signature de `logAudit` (`shared.js`) n'a pas changé ; `ch.send` accepte déjà un objet.
- Finding 2 : 3 tests du journal avec des salons simulés (`setWordFilterConfig` pour `logChannelId`, `setSetting("auditChannelId")` restauré dans un `finally`), avec une raison piégée `@everyone @here <@&999> <@t2>` :
  - embed dans le Journal de modération : `allowedMentions` vide, raison et autorisation présentes, rien dans le salon d'audit ;
  - envoi de l'embed en échec (50013) : repli sur le salon d'audit avec un objet et `allowedMentions` vide, réponse ✅ conservée ;
  - aucun Journal de modération : salon d'audit, `allowedMentions` vide.
- Finding 3 : la récupération de la cible distingue `RESTJSONErrorCodes.UnknownMember` (10007 → « Ce membre n'est pas (ou plus) sur le serveur. ») des autres erreurs (→ « Impossible de récupérer ce membre auprès de Discord. Réessaie dans un instant. »). 2 tests : cible absente (10007) et erreur 503 (message « Réessaie », aucun timeout, cooldown non consommé).

Commandes lancées depuis la racine du workspace :
- `npm run check --prefix xray-kaya-bot` → « 85 fichiers OK (node --check) », code de sortie 0.
- `npm run lint --prefix xray-kaya-bot` → code de sortie 0, aucune sortie d'erreur.
- `npm test --prefix xray-kaya-bot` → code de sortie 0, les 17 tests de `roleTimeout.command.test.js` OK (12 existants + 5 nouveaux).
- `npm run ci --prefix xray-kaya-bot` → code de sortie 0 : check 85 fichiers OK, lint propre, tests 213, pass 213, fail 0.
- `package.json` / `package-lock.json` inchangés (`git diff --quiet` → 0) ; `data/bot.db` non modifié ; ni `start` ni `deploy` lancés ; aucun script Python exécuté.
- Playwright : pas relancé, car le dashboard n'a pas changé dans cette itération.
