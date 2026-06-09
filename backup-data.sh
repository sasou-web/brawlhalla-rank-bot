#!/usr/bin/env bash
# Sauvegarde le dossier data/ (XP, liaisons, config) dans une archive horodatee,
# garde les 14 dernieres en local, ET l'envoie vers un stockage EXTERNE (offsite)
# pour survivre a un crash/perte du serveur.
#
# Lancer manuellement :  bash backup-data.sh
# Automatiser (cron quotidien a 4h), avec crontab -e :
#   0 4 * * * cd /home/kaya/brawlhalla-rank-bot && bash backup-data.sh >> backup.log 2>&1
#
# ---------- Configuration de l'export externe ----------
# Mets les variables ci-dessous dans un fichier "backup.env" a cote de ce script
# (voir backup.env.example). Active UNE OU PLUSIEURS cibles :
#   BACKUP_WEBHOOK_URL  : URL d'un webhook Discord (salon prive) -> upload de l'archive
#   BACKUP_RCLONE_REMOTE: remote rclone deja configure, ex: "b2:mon-bucket/brawlbot"
#   BACKUP_SCP_DEST     : destination scp, ex: "user@autreserveur:/backups/brawlbot"

set -euo pipefail
cd "$(dirname "$0")"

# Charge la config externe si presente (ne casse pas si absente).
if [ -f backup.env ]; then
  # shellcheck disable=SC1091
  set -a; . ./backup.env; set +a
fi

mkdir -p backups
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
ARCHIVE="backups/data_${STAMP}.tar.gz"

tar -czf "$ARCHIVE" data
echo "[$(date '+%F %T')] Sauvegarde locale creee : ${ARCHIVE}"

# Ne conserve que les 14 archives locales les plus recentes.
ls -1t backups/data_*.tar.gz | tail -n +15 | xargs -r rm -f

# A partir d'ici, un echec d'export NE DOIT PAS faire echouer le script (la copie
# locale est deja faite). On desactive l'arret sur erreur pour les envois externes.
set +e

SIZE_BYTES=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)

# ---------- 1) Webhook Discord (offsite, sans infra) ----------
if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  # Limite d'upload Discord ~25 Mo. L'archive de data/ est minuscule, mais on garde un garde-fou.
  if [ "$SIZE_BYTES" -gt 24000000 ]; then
    echo "[backup] Archive > 24 Mo : upload Discord ignore (utilise rclone/scp pour les gros volumes)."
  else
    if curl -sf -X POST \
        -F "payload_json={\"content\":\"🗄️ Backup data \`${STAMP}\`\"}" \
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
