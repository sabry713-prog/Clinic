#!/usr/bin/env bash
# backup-db.sh — PostgreSQL backup: pg_dump → GPG encrypt → upload to S3
#
# Required environment variables:
#   DATABASE_URL        — PostgreSQL connection string
#   GPG_PASSPHRASE      — Symmetric encryption passphrase
#   S3_BUCKET           — Target S3-compatible bucket name
#   S3_PREFIX           — Key prefix (e.g. "backups/prod") — default: "backups"
#   AWS_DEFAULT_REGION  — (or S3_ENDPOINT_URL for non-AWS)
#   ENV                 — Environment label (dev/staging/prod) — default: "prod"
#
# The S3 bucket MUST have Object Lock / versioning configured (done in Terraform).
# This script only uploads — it does not configure the bucket.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
ENV="${ENV:-prod}"
S3_PREFIX="${S3_PREFIX:-backups}"
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
YYYY=$(date -u +"%Y")
MM=$(date -u +"%m")
DD=$(date -u +"%d")
FILENAME="backup-${TIMESTAMP}.dump.gpg"
TMPDIR=$(mktemp -d)
TMPFILE="${TMPDIR}/${FILENAME}"

cleanup() {
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

# ── Validate required env vars ────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

# ── Dump, compress, encrypt ───────────────────────────────────────────────────
echo "[backup] Starting pg_dump → encrypt → ${TMPFILE}"

pg_dump "${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-password \
  | gpg \
      --batch \
      --yes \
      --symmetric \
      --cipher-algo AES256 \
      --passphrase-fd 0 \
      --output "${TMPFILE}" \
  <<< "${GPG_PASSPHRASE}"

echo "[backup] Dump + encrypt complete: ${FILENAME}"

# ── Compute SHA-256 ───────────────────────────────────────────────────────────
SHA256=$(sha256sum "${TMPFILE}" | awk '{print $1}')
echo "[backup] SHA-256: ${SHA256}"

# ── Upload to S3 ──────────────────────────────────────────────────────────────
S3_KEY="${S3_PREFIX}/${ENV}/${YYYY}/${MM}/${DD}/${FILENAME}"

echo "[backup] Uploading to s3://${S3_BUCKET}/${S3_KEY}"

aws s3 cp \
  "${TMPFILE}" \
  "s3://${S3_BUCKET}/${S3_KEY}" \
  --metadata "sha256=${SHA256},env=${ENV},timestamp=${TIMESTAMP}" \
  --storage-class STANDARD

echo "[backup] Upload complete."
echo "[backup] Location: s3://${S3_BUCKET}/${S3_KEY}"
echo "[backup] SHA-256:  ${SHA256}"
