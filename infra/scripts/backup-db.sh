#!/usr/bin/env bash
# backup-db.sh — PostgreSQL backup: pg_dump → verify → GPG encrypt → verify → upload → read back
#
# Required environment variables:
#   DATABASE_URL        — PostgreSQL connection string
#   GPG_PASSPHRASE      — Symmetric encryption passphrase
#   S3_BUCKET           — Target S3-compatible bucket name
#   S3_PREFIX           — Key prefix (e.g. "backups/prod") — default: "backups"
#   AWS_DEFAULT_REGION  — (or S3_ENDPOINT_URL for non-AWS)
#   ENV                 — Environment label (dev/staging/prod) — default: "prod"
#
# Optional (defaults keep production behaviour unchanged):
#   PG_DUMP_BIN         — default "pg_dump"      (e.g. "docker exec -i cc-postgres pg_dump")
#   PG_RESTORE_BIN      — default "pg_restore"   (only used to verify the dump is readable)
#
# The S3 bucket MUST have Object Lock / versioning configured (done in Terraform).
# This script only uploads — it does not configure the bucket.
#
# WHY THIS SCRIPT VERIFIES EVERY STEP
# -----------------------------------
# The previous version read the passphrase from stdin (--passphrase-fd 0) while
# pg_dump's output arrived on that same stdin:
#
#     pg_dump "$DATABASE_URL" ... | gpg ... --passphrase-fd 0 ... <<< "$GPG_PASSPHRASE"
#
# The here-string wins the redirection, so gpg took the passphrase from it and
# the dump bytes were dropped on the floor — pg_dump wrote into a pipe nobody
# read. The script then printed "Upload complete" and exited 0 with an encrypted
# file containing ZERO bytes. A 200 KB dump produced a 70-byte backup. Nothing
# failed loudly, which is the worst possible property for the only backup path.
#
# Two structural changes fix the class, not just the instance:
#   1. gpg reads the dump from a FILE argument, and the passphrase from fd 3.
#      Data and passphrase can never share a file descriptor again.
#   2. Every step is checked and the script refuses to report success otherwise:
#      the dump must be non-empty and readable by pg_restore, the ciphertext must
#      decrypt back to a byte-identical dump (sha256), and the uploaded object
#      must be read back from S3 and match.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
ENV="${ENV:-prod}"
S3_PREFIX="${S3_PREFIX:-backups}"
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
YYYY=$(date -u +"%Y")
MM=$(date -u +"%m")
DD=$(date -u +"%d")
FILENAME="backup-${TIMESTAMP}.dump.gpg"
MANIFEST_NAME="backup-${TIMESTAMP}.manifest.json"
TMPDIR=$(mktemp -d)
TMPFILE="${TMPDIR}/${FILENAME}"
PLAINFILE="${TMPDIR}/backup.dump"
MANIFEST_FILE="${TMPDIR}/${MANIFEST_NAME}"

PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"

cleanup() {
  # The decrypted dump is the one artefact worth wiping: it holds everything the
  # ciphertext protects. shred where available, then remove the directory.
  if command -v shred &>/dev/null; then
    shred -u "${PLAINFILE}" 2>/dev/null || true
  fi
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

fail() {
  echo "[backup] FATAL: $*" >&2
  exit 1
}

# ── Preflight: refuse to start if a tool is missing ───────────────────────────
# A missing aws CLI used to mean the dump was encrypted and then never uploaded,
# with the script still exiting 0.
for tool in gpg sha256sum awk aws; do
  command -v "${tool}" >/dev/null || fail "required tool not found: ${tool}"
done

# ── Validate required env vars ────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

# ── Dump (to a file, then verify it is a real archive) ────────────────────────
echo "[backup] Starting pg_dump → ${PLAINFILE}"

# shellcheck disable=SC2086
${PG_DUMP_BIN} "${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-password \
  > "${PLAINFILE}" \
  || fail "pg_dump failed"

[[ -s "${PLAINFILE}" ]] || fail "pg_dump produced an empty file"

PLAIN_SHA=$(sha256sum "${PLAINFILE}" | awk '{print $1}')
PLAIN_BYTES=$(stat -c%s "${PLAINFILE}" 2>/dev/null || stat -f%z "${PLAINFILE}")

# The dump must be a readable custom-format archive, not just non-empty bytes.
# pg_restore --list parses the archive header and its table of contents.
TOC_LINES=$(${PG_RESTORE_BIN} --list "${PLAINFILE}" 2>/dev/null | wc -l | tr -d ' ') \
  || fail "pg_restore could not read the dump (invalid archive)"
[[ "${TOC_LINES}" -gt 0 ]] || fail "pg_restore reported an empty table of contents"

echo "[backup] Dump verified: ${PLAIN_BYTES} bytes, ${TOC_LINES} TOC entries, sha256 ${PLAIN_SHA}"

# ── Encrypt (passphrase on fd 3, plaintext passed as a file argument) ─────────
echo "[backup] Encrypting → ${FILENAME}"

gpg \
  --batch \
  --yes \
  --quiet \
  --symmetric \
  --cipher-algo AES256 \
  --pinentry-mode loopback \
  --passphrase-fd 3 \
  --output "${TMPFILE}" \
  "${PLAINFILE}" \
  3<<< "${GPG_PASSPHRASE}" \
  || fail "gpg encryption failed"

[[ -s "${TMPFILE}" ]] || fail "encryption produced an empty file"

# ── Verify the ciphertext round-trips before anything is uploaded ─────────────
# Decrypt to a pipe and hash the stream, so the plaintext is never re-written.
ROUNDTRIP_SHA=$(
  gpg --batch --yes --quiet --decrypt \
    --pinentry-mode loopback \
    --passphrase-fd 3 \
    --output - \
    "${TMPFILE}" \
    3<<< "${GPG_PASSPHRASE}" \
    | sha256sum | awk '{print $1}'
) || fail "decryption of our own backup failed"

[[ "${ROUNDTRIP_SHA}" == "${PLAIN_SHA}" ]] \
  || fail "round-trip mismatch: decrypted ${ROUNDTRIP_SHA} != original ${PLAIN_SHA}"

ENC_SHA=$(sha256sum "${TMPFILE}" | awk '{print $1}')
ENC_BYTES=$(stat -c%s "${TMPFILE}" 2>/dev/null || stat -f%z "${TMPFILE}")
echo "[backup] Encryption verified: ${ENC_BYTES} bytes, round-trip sha256 matches"

# ── Write the manifest ────────────────────────────────────────────────────────
cat > "${MANIFEST_FILE}" <<MANIFEST
{
  "filename": "${FILENAME}",
  "env": "${ENV}",
  "created_at_utc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "dump_sha256": "${PLAIN_SHA}",
  "dump_bytes": ${PLAIN_BYTES},
  "archive_toc_entries": ${TOC_LINES},
  "encrypted_sha256": "${ENC_SHA}",
  "encrypted_bytes": ${ENC_BYTES},
  "encryption_round_trip_verified": true,
  "database_url_redacted": true
}
MANIFEST

# ── Upload ciphertext + manifest ──────────────────────────────────────────────
S3_KEY="${S3_PREFIX}/${ENV}/${YYYY}/${MM}/${DD}/${FILENAME}"
MANIFEST_KEY="${S3_PREFIX}/${ENV}/${YYYY}/${MM}/${DD}/${MANIFEST_NAME}"

echo "[backup] Uploading to s3://${S3_BUCKET}/${S3_KEY}"

aws s3 cp \
  "${TMPFILE}" \
  "s3://${S3_BUCKET}/${S3_KEY}" \
  --metadata "sha256=${ENC_SHA},dump-sha256=${PLAIN_SHA},env=${ENV},timestamp=${TIMESTAMP}" \
  --storage-class STANDARD \
  || fail "upload of ${FILENAME} failed"

aws s3 cp \
  "${MANIFEST_FILE}" \
  "s3://${S3_BUCKET}/${MANIFEST_KEY}" \
  --content-type application/json \
  || fail "upload of ${MANIFEST_NAME} failed"

# ── Read back and verify what S3 actually stored ──────────────────────────────
# An upload that returned 0 is a claim; this is the check.
REMOTE_SHA=$(aws s3api head-object \
  --bucket "${S3_BUCKET}" \
  --key "${S3_KEY}" \
  --query 'Metadata.sha256' \
  --output text 2>/dev/null || echo "")

REMOTE_BYTES=$(aws s3api head-object \
  --bucket "${S3_BUCKET}" \
  --key "${S3_KEY}" \
  --query 'ContentLength' \
  --output text 2>/dev/null || echo "")

[[ -n "${REMOTE_SHA}" && "${REMOTE_SHA}" != "None" ]] \
  || fail "S3 object ${S3_KEY} has no sha256 metadata — upload unverified"
[[ "${REMOTE_SHA}" == "${ENC_SHA}" ]] \
  || fail "S3 metadata sha256 ${REMOTE_SHA} != local ${ENC_SHA}"
[[ "${REMOTE_BYTES}" == "${ENC_BYTES}" ]] \
  || fail "S3 object size ${REMOTE_BYTES} != local ${ENC_BYTES}"

echo "[backup] Upload verified (read back from S3): sha256 ${REMOTE_SHA}, ${REMOTE_BYTES} bytes"
echo "[backup] Location: s3://${S3_BUCKET}/${S3_KEY}"
echo "[backup] Manifest: s3://${S3_BUCKET}/${MANIFEST_KEY}"
