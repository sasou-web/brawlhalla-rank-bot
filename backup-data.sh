#!/usr/bin/env bash
# ============================================================================
#  Sauvegarde de la base du bot (liaisons, XP, succes, tournois, giveaways).
# ============================================================================
#  Principe : on N'ARCHIVE PAS data/ brut, mais un instantane ALLEGE de bot.db.
#
#  Pourquoi : la table `leaderboard` (miroir local du classement Brawlhalla,
#  ~40 000 lignes) pesait a elle seule l'essentiel des 14 Mo de la base, alors
#  qu'elle est entierement reconstructible depuis l'API. Idem pour les caches
#  `profiles` / `searches` et la file `pending`. En les retirant de la copie,
#  l'archive passe de ~6,7 Mo a ~330 Ko -- et sa taille suit desormais le
#  nombre de membres, plus la taille du ladder Brawlhalla (l'upload Discord
#  est limite a 25 Mo : on ne risque plus de le depasser silencieusement).
#
#  data/combos.json n'est pas sauvegarde : il est versionne dans git.
#
#  Etapes :
#    1. VACUUM INTO  -> instantane atomique et coherent, SANS arreter le bot
#    2. integrity_check sur la copie (on ne sauvegarde pas une base corrompue)
#    3. purge des tables reconstructibles + VACUUM (compaction)
#    4. gzip -> backups/bot_<horodatage>.db.gz
#    5. rotation (14 archives) + export offsite
#
#  Lancer manuellement :  sudo bash backup-data.sh
#  Automatiser (cron quotidien a 4h), avec `sudo crontab -e` :
#    0 4 * * * cd /root/brawlhalla-rank-bot && bash backup-data.sh >> backup.log 2>&1
#
# ---------------------------------------------------------------------------
#  RESTAURATION  (chemins ABSOLUS : `cd /root/...` echoue pour l'utilisateur kaya)
# ---------------------------------------------------------------------------
#   D=/root/brawlhalla-rank-bot
#   sudo pm2 stop brawl-bot
#   sudo mv $D/data/bot.db $D/data/bot.db.avant-restauration
#   sudo rm -f $D/data/bot.db-wal $D/data/bot.db-shm       # <-- INDISPENSABLE
#   sudo bash -c "gunzip -c $D/backups/bot_AAAA-MM-JJ_HH-MM-SS.db.gz > $D/data/bot.db"
#   sudo pm2 start brawl-bot
#
#   Le retrait de bot.db-wal / bot.db-shm est critique : laisses en place, ils
#   seraient rejoues par SQLite par-dessus la base restauree.
#   Les caches (leaderboard, profils, recherches) se reconstruisent seuls.
#
#   Verifier une archive sans restaurer (voir DEPLOY.md) : attention, sqlite3
#   CREE la base si le fichier est absent -> un integrity_check "ok" sur une
#   base vide ne prouve rien. Controle toujours les compteurs de lignes.
#
# ---------------------------------------------------------------------------
#  Export externe (offsite)
# ---------------------------------------------------------------------------
#  Variables a mettre dans un fichier "backup.env" a cote de ce script
#  (voir backup.env.example). Active UNE OU PLUSIEURS cibles :
#    BACKUP_WEBHOOK_URL   : webhook Discord (salon prive) -> upload de l'archive
#    BACKUP_RCLONE_REMOTE : remote rclone, ex: "b2:mon-bucket/brawlbot"
#    BACKUP_SCP_DEST      : destination scp, ex: "user@autreserveur:/backups/brawlbot"
#
#  NOTE : .env (token Discord) n'est volontairement JAMAIS sauvegarde ici --
#  garde-le dans un gestionnaire de mots de passe.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")"

# Charge la config externe si presente (ne casse pas si absente).
if [ -f backup.env ]; then
  # shellcheck disable=SC1091
  set -a; . ./backup.env; set +a
fi

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
ARCHIVE="backups/bot_${STAMP}.db.gz"
SNAPSHOT="$(mktemp -t bot_snapshot_XXXXXXXX.db)"

# Tables reconstructibles depuis l'API : retirees de la copie sauvegardee.
DISPOSABLE_TABLES="leaderboard profiles searches pending"

# Nettoyage de l'instantane temporaire quoi qu'il arrive.
cleanup() { rm -f "$SNAPSHOT" "$SNAPSHOT-wal" "$SNAPSHOT-shm"; }
trap cleanup EXIT

# Alerte en cas d'echec : sans ca, un cron casse passe inapercu jusqu'au jour
# ou on a besoin de la sauvegarde. On previent sur le webhook s'il est configure.
notify_failure() {
  echo "[$(date '+%F %T')] [backup] ECHEC : $1"
  if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
    curl -sf -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"❌ **Sauvegarde échouée** \`${STAMP}\` — $1\"}" \
      "$BACKUP_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}
trap 'notify_failure "erreur inattendue ligne $LINENO"' ERR

mkdir -p backups

# --- Prerequis ---
if ! command -v sqlite3 >/dev/null 2>&1; then
  notify_failure "sqlite3 introuvable (apt install sqlite3)"
  exit 1
fi
if [ ! -f data/bot.db ]; then
  notify_failure "data/bot.db introuvable"
  exit 1
fi

# --- 1. Instantane coherent de la base en cours d'utilisation ---
# VACUUM INTO ne fait que LIRE la source : sans danger sur une base live en WAL,
# et le fichier produit est deja compacte + coherent (pas besoin du WAL).
rm -f "$SNAPSHOT"
sqlite3 data/bot.db "VACUUM INTO '${SNAPSHOT}'"

# --- 2. Controle d'integrite : on refuse de sauvegarder une base corrompue ---
INTEGRITY="$(sqlite3 "$SNAPSHOT" "PRAGMA integrity_check;" | head -n 1)"
if [ "$INTEGRITY" != "ok" ]; then
  notify_failure "integrity_check a echoue : ${INTEGRITY}"
  exit 1
fi

# --- 3. Purge des tables reconstructibles, puis compaction ---
# Chaque DELETE est tolerant : une table absente (ancienne/future version du
# schema) ne doit pas faire echouer la sauvegarde.
for t in $DISPOSABLE_TABLES; do
  sqlite3 "$SNAPSHOT" "DELETE FROM ${t};" 2>/dev/null || true
done
sqlite3 "$SNAPSHOT" "VACUUM;"

# --- 4. Compression ---
gzip -c "$SNAPSHOT" > "$ARCHIVE"
RAW_H="$(du -h "$SNAPSHOT" | cut -f1)"
GZ_H="$(du -h "$ARCHIVE" | cut -f1)"
echo "[$(date '+%F %T')] Sauvegarde creee : ${ARCHIVE} (${GZ_H} compresse, ${RAW_H} decompresse)"

# --- 5. Rotation : 14 archives les plus recentes de chaque format ---
# Le motif `data_*.tar.gz` couvre les archives de l'ancien format (data/ brut),
# encore presentes le temps qu'elles vieillissent.
ls -1t backups/bot_*.db.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t backups/data_*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

# A partir d'ici, un echec d'export NE DOIT PAS faire echouer le script : la
# copie locale est deja faite. On desactive l'arret sur erreur et le piege ERR.
set +e
trap - ERR

SIZE_BYTES=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)

# ---------- 1) Webhook Discord (offsite, sans infra) ----------
if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  # Limite d'upload Discord ~25 Mo. Avec l'archive allegee on en est tres loin,
  # mais on garde le garde-fou (et on previent au lieu d'echouer en silence).
  if [ "$SIZE_BYTES" -gt 24000000 ]; then
    echo "[backup] Archive > 24 Mo : upload Discord ignore (utilise rclone/scp)."
    notify_failure "archive de ${GZ_H} > 24 Mo : upload Discord impossible"
  else
    if curl -sf -X POST \
        -F "payload_json={\"content\":\"🗄️ Backup base \`${STAMP}\` (${GZ_H})\"}" \
        -F "file1=@${ARCHIVE}" \
        "$BACKUP_WEBHOOK_URL" >/dev/null; then
      echo "[backup] Envoye au webhook Discord ✅"
    else
      echo "[backup] ⚠️ Echec de l'envoi au webhook Discord."
    fi
  fi
fi

# ---------- 2) rclone (cloud : Backblaze B2, S3, Google Drive...) ----------
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy "$ARCHIVE" "$BACKUP_RCLONE_REMOTE" >/dev/null 2>&1; then
      echo "[backup] Copie vers rclone (${BACKUP_RCLONE_REMOTE}) ✅"
    else
      echo "[backup] ⚠️ Echec rclone vers ${BACKUP_RCLONE_REMOTE}."
    fi
  else
    echo "[backup] ⚠️ rclone non installe (apt install rclone, puis 'rclone config')."
  fi
fi

# ---------- 3) scp vers un autre serveur ----------
if [ -n "${BACKUP_SCP_DEST:-}" ]; then
  if scp -q -o BatchMode=yes "$ARCHIVE" "$BACKUP_SCP_DEST" 2>/dev/null; then
    echo "[backup] Copie scp vers ${BACKUP_SCP_DEST} ✅"
  else
    echo "[backup] ⚠️ Echec scp vers ${BACKUP_SCP_DEST} (cle SSH configuree ?)."
  fi
fi

if [ -z "${BACKUP_WEBHOOK_URL:-}${BACKUP_RCLONE_REMOTE:-}${BACKUP_SCP_DEST:-}" ]; then
  echo "[backup] ⚠️ Aucune cible externe configuree (backup.env) — sauvegarde LOCALE uniquement."
fi
