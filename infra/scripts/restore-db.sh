#!/usr/bin/env bash
# restore-db.sh — Restore PostgreSQL from S3 backup
#
# Usage:
#   S3_KEY=backups/prod/2026/06/10/backup-20260610-020000.dump.gpg \
#   DATABASE_URL=postgres://... \
#   GPG_PASSPHRASE=... \
#   S3_BUCKET=clinical-copilot-backups \
#   ./restore-db.sh
#
# Required environment variables:
#   S3_KEY          — Full S3 object key to restore from
#   DATABASE_URL    — Target PostgreSQL connection string (will be WIPED)
#   GPG_PASSPHRASE  — Symmetric decryption passphrase
#   S3_BUCKET       — Source S3-compatible bucket name
#
# WARNING: This script drops and recreates the target database.
# Use only in disaster recovery or a new empty environment.

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${S3_KEY:?S3_KEY must be set (e.g. backups/prod/2026/06/10/backup-YYYYMMDD-HHMMSS.dump.gpg)}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

TMPDIR=$(mktemp -d)
ENCRYPTED_FILE="${TMPDIR}/backup.dump.gpg"
DECRYPTED_FILE="${TMPDIR}/backup.dump"

cleanup() {
  # Securely wipe temp files before removal
  if command -v shred &>/dev/null; then
    shred -u "${ENCRYPTED_FILE}" "${DECRYPTED_FILE}" 2>/dev/null || true
  fi
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

# ── Download from S3 ──────────────────────────────────────────────────────────
echo "[restore] Downloading s3://${S3_BUCKET}/${S3_KEY}"
aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "${ENCRYPTED_FILE}"
echo "[restore] Download complete."

# ── Verify SHA-256 (if stored in metadata) ────────────────────────────────────
EXPECTED_SHA=$(aws s3api head-object \
  --bucket "${S3_BUCKET}" \
  --key "${S3_KEY}" \
  --query 'Metadata.sha256' \
  --output text 2>/dev/null || echo "")

ACTUAL_SHA=$(sha256sum "${ENCRYPTED_FILE}" | awk '{print $1}')

if [[ -n "${EXPECTED_SHA}" && "${EXPECTED_SHA}" != "None" ]]; then
  if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
    echo "[restore] ERROR: SHA-256 mismatch!"
    echo "[restore]   Expected: ${EXPECTED_SHA}"
    echo "[restore]   Actual:   ${ACTUAL_SHA}"
    exit 1
  fi
  echo "[restore] SHA-256 verified: ${ACTUAL_SHA}"
else
  echo "[restore] WARNING: No SHA-256 metadata found. Proceeding without checksum verification."
  echo "[restore] SHA-256 of downloaded file: ${ACTUAL_SHA}"
fi

# ── Decrypt ───────────────────────────────────────────────────────────────────
echo "[restore] Decrypting backup..."
gpg \
  --batch \
  --yes \
  --decrypt \
  --passphrase-fd 0 \
  --output "${DECRYPTED_FILE}" \
  "${ENCRYPTED_FILE}" \
  <<< "${GPG_PASSPHRASE}"
echo "[restore] Decryption complete."

# ── Restore ───────────────────────────────────────────────────────────────────
echo "[restore] Restoring to ${DATABASE_URL%%@*}@..."
echo "[restore] WARNING: This will overwrite existing data. Proceeding in 5 seconds..."
sleep 5

pg_restore \
  --dbname="${DATABASE_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  "${DECRYPTED_FILE}"

echo "[restore] Restore complete."
