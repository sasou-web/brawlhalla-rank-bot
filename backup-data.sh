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
#  data/combos.json n'est pas sauvegarde : il est versionne dans git (et
#  data/combos.live.json, rafraichi depuis le dashboard, se re-scrape a volonte).
#
#  Etapes :
#    1. VACUUM INTO  -> instantane atomique et coherent, SANS arreter le bot
#    2. integrity_check sur la copie (on ne sauvegarde pas une base corrompue)
#    3. purge des tables reconstructibles + retrait du jeton start.gg + VACUUM
#       puis compteurs de lignes (alerte si base quasi vide, sans bloquer)
#    4. gzip -> backups/bot_<horodatage>.db.gz, relu par gzip -t (alerte sans bloquer)
#    5. rotation (14 archives) + export offsite (alerte si aucune cible n'a reussi)
#
#  Lancer manuellement :  sudo bash backup-data.sh
#  Automatiser (cron quotidien a 4h), avec `sudo crontab -e` :
#    0 4 * * * cd /root/xray-kaya-bot && bash backup-data.sh >> backup.log 2>&1
#
# ---------------------------------------------------------------------------
#  RESTAURATION  (chemins ABSOLUS : `cd /root/...` echoue pour l'utilisateur kaya)
# ---------------------------------------------------------------------------
#   D=/root/xray-kaya-bot
#   sudo pm2 stop xk-bot
#   sudo mv $D/data/bot.db $D/data/bot.db.avant-restauration
#   sudo rm -f $D/data/bot.db-wal $D/data/bot.db-shm       # <-- INDISPENSABLE
#   sudo bash -c "gunzip -c $D/backups/bot_AAAA-MM-JJ_HH-MM-SS.db.gz > $D/data/bot.db"
#   sudo pm2 start xk-bot
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
#    BACKUP_RCLONE_REMOTE : remote rclone, ex: "b2:mon-bucket/xk-bot"
#    BACKUP_SCP_DEST      : destination scp, ex: "user@autreserveur:/backups/xk-bot"
#
#  NOTE : .env (token Discord) n'est volontairement JAMAIS sauvegarde ici --
#  garde-le dans un gestionnaire de mots de passe. Le jeton start.gg (kv.settings)
#  est retire de la copie : a ressaisir dans le dashboard apres une restauration.
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

# Alerte NON bloquante : l'archive est quand meme produite et envoyee (une sauvegarde
# douteuse vaut mieux que pas de sauvegarde), mais on previent sur le webhook.
notify_warning() {
  echo "[$(date '+%F %T')] [backup] ALERTE : $1"
  if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
    curl -sf -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"⚠️ **Sauvegarde suspecte** \`${STAMP}\` — $1\"}" \
      "$BACKUP_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

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
# Secret retire de la COPIE (la base live n'est pas touchee) : le jeton start.gg vit dans
# kv.settings et partirait sinon en clair sur le webhook. A ressaisir dans le dashboard
# apres une restauration. Place AVANT le VACUUM, qui reecrit le fichier sans l'ancienne page.
sqlite3 "$SNAPSHOT" "UPDATE kv SET value = json_remove(value, '\$.startggToken') WHERE key = 'settings';" 2>/dev/null \
  || echo "[backup] ⚠️ Retrait du jeton start.gg impossible : il reste present dans l'archive."
sqlite3 "$SNAPSHOT" "VACUUM;"

# --- 3 bis. Controle du contenu (ALERTE seulement, ne bloque jamais l'archivage) ---
# integrity_check ne voit pas une base valide mais VIDE (bot relance sur une base neuve
# apres une fausse manipulation) : archivee chaque nuit, elle evincerait les bonnes
# archives en 14 jours. On compte donc les lignes des tables irremplacables.
count_rows() { sqlite3 "$SNAPSHOT" "SELECT COUNT(*) FROM $1;" 2>/dev/null || echo "?"; }
KV_N="$(count_rows kv)"
XP_N="$(count_rows xp)"
RH_N="$(count_rows rating_history)"
# Un compteur illisible ("?") fait echouer le test numerique, donc declenche aussi l'alerte.
if ! [ "$KV_N" -ge 5 ] 2>/dev/null || ! [ "$XP_N" -gt 0 ] 2>/dev/null; then
  notify_warning "base quasi vide (kv=${KV_N}, xp=${XP_N}) : mauvaise base sauvegardee ? A verifier avant que la rotation n'evince les bonnes archives."
fi

# --- 4. Compression, puis relecture de l'archive ---
gzip -c "$SNAPSHOT" > "$ARCHIVE"
if ! gzip -t "$ARCHIVE" 2>/dev/null; then
  notify_warning "archive illisible (gzip -t en echec) : ${ARCHIVE}"
fi
RAW_H="$(du -h "$SNAPSHOT" | cut -f1)"
GZ_H="$(du -h "$ARCHIVE" | cut -f1)"
echo "[$(date '+%F %T')] Sauvegarde creee : ${ARCHIVE} (${GZ_H} compresse, ${RAW_H} decompresse ; kv=${KV_N}, xp=${XP_N}, ratings=${RH_N})"

# --- 5. Rotation : 14 archives les plus recentes de chaque format ---
# Le motif `data_*.tar.gz` couvre les archives de l'ancien format (data/ brut),
# encore presentes le temps qu'elles vieillissent.
# `find` et non `ls backups/motif` : sans aucune archive du motif, ls sort en erreur et,
# avec pipefail + set -e, le script s'arretait ICI, avant l'export offsite. Ne PAS
# remplacer par `shopt -s nullglob` : un `ls -1t` sans argument listerait le dossier
# courant et xargs rm supprimerait des fichiers du projet.
rotate() {
  find backups -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' \
    | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f
}
rotate 'bot_*.db.gz' || echo "[backup] ⚠️ Rotation des archives bot_*.db.gz en echec."
rotate 'data_*.tar.gz' || echo "[backup] ⚠️ Rotation des archives data_*.tar.gz en echec."

# A partir d'ici, un echec d'export NE DOIT PAS faire echouer le script : la
# copie locale est deja faite. On desactive l'arret sur erreur et le piege ERR.
set +e
trap - ERR

SIZE_BYTES=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)
# Passe a 1 des qu'une cible externe a recu l'archive (controle final ci-dessous).
OFFSITE_OK=0

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
      OFFSITE_OK=1
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
      OFFSITE_OK=1
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
    OFFSITE_OK=1
  else
    echo "[backup] ⚠️ Echec scp vers ${BACKUP_SCP_DEST} (cle SSH configuree ?)."
  fi
fi

if [ -z "${BACKUP_WEBHOOK_URL:-}${BACKUP_RCLONE_REMOTE:-}${BACKUP_SCP_DEST:-}" ]; then
  echo "[backup] ⚠️ Aucune cible externe configuree (backup.env) — sauvegarde LOCALE uniquement."
elif [ "$OFFSITE_OK" -eq 0 ]; then
  # Les echecs ci-dessus ne sont que dans backup.log : sans alerte, on decouvrirait
  # l'absence de copie externe le jour ou le disque du serveur lache.
  notify_failure "aucune cible externe n'a recu l'archive (copie LOCALE uniquement : ${ARCHIVE})"
fi
