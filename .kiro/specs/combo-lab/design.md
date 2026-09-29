# Combo Lab — conception

## Modules
| Fichier | Rôle |
|---|---|
| `src/comboData.js` | Module **pur** (ni Discord ni base) : `WEAPON_META`, libellés, `splitNotation`, `buildLabCatalog`. Importé par `combos.js` et par le mock. |
| `src/combos.js` | Dataset, cache vidéo LRU (désormais exporté : `getComboVideo`, `comboById`), ralenti ffmpeg (`getSlowComboVideo`, `slowmoAvailable`), payloads Discord. `WEAPON_META` ré-exporté. |
| `src/comboMastery.js` | Table `combo_mastery` + requêtes préparées : lecture, bascule, réclamation d'XP (transaction). |
| `src/levels.js` | `addBonusXp(guildId, userId, amount)` : gain fixe, respecte `enabled` et le plafond journalier. |
| `src/achievements.js` | Succès `combo1`, `combos10`, `combos50`, `weaponmaster` (stats `combos`, `weaponsCompleted`). |
| `src/commands.js` | Handlers `cbp_slow:` et `cbp_master:` ; les handlers existants passent le contexte membre au viewer. |
| `src/web/comboLab.js` | `mountComboLab(app, deps)` + `parseRange` : routes partagées par le serveur réel et le mock. |
| `src/web/public/lab/` | `index.html`, `lab.css`, `lab.js` (script classique dans une IIFE, aucune globale). |

## Routes publiques (montées avant le 404 `/api` et le fallback SPA)
- `GET /lab/api/combos` → `{ weapons: [{slug,label,emoji,count}], combos: [{id,weapon,notation,steps,usability,damage,dexterity,avgDamage,url}] }`, cache 5 min.
- `GET /lab/video/:id.mp4` → buffer depuis le cache LRU, `Accept-Ranges`, 200/206/416, cache 1 j.
- Rate-limit dédié : 60 req/min (API), 240 req/min (vidéo). 404 JSON sous `/lab/api`.
- Le mock fournit ses propres sources (lecture de `data/combos.json`, vidéo récupérée sur BrawlDB) et applique les scénarios `empty` / `errors` / `slow`.

## Table
```sql
CREATE TABLE IF NOT EXISTS combo_mastery (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, combo_id INTEGER NOT NULL,
  weapon TEXT NOT NULL, mastered INTEGER NOT NULL DEFAULT 1,
  xp_ts INTEGER NOT NULL DEFAULT 0,  -- date du gain d'XP (0 = jamais) : survit au décochage
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, combo_id)
);
```
Les ids BrawlDB sont uniques toutes armes confondues (vérifié : 187/187).

## Viewer Discord
- `buildComboViewer(weapon, id, { userId, guildId, slow, labBaseUrl })`.
- Rangée de boutons : ralenti (si ffmpeg), maîtrise (si serveur), Combo Lab (si `PUBLIC_URL`), BrawlDB.
- customIds : `cbp_slow:<weapon>:<id>:<0|1>`, `cbp_master:<weapon>:<id>:<0|1>` (le dernier champ garde la vitesse affichée).
- Mise à jour : `deferUpdate()` puis `editReply({ ...payload, attachments: [] })` (modèle existant).
- ffmpeg SANS réencodage : `-stream_loop <n-1> -itsscale 4 -i in.mp4 -map 0:v:0 -an -c:v copy -movflags +faststart`
  via fichiers temporaires, `-nostdin`, délai max 15 s. n = 3 répétitions, moins si la source est lourde
  (sortie ≈ source × n, plafonnée à 9 Mo). Mesuré sur le serveur de prod (2 vCPU partagés) : ~0,1 s de
  CPU et ~1,9 Mo pour 25 s. Un réencodage libx264 720p y coûtait ~25 s de CPU par combo : abandonné.
  Binaire : `FFMPEG_PATH` ou `ffmpeg` du PATH, détecté une fois.
