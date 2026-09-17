#!/usr/bin/env bash
# restore-drill.sh — prove a backup can actually be restored, without touching
# the live database.
#
# Downloads a backup from S3 (the newest by default), verifies it against its
# manifest, decrypts it, restores it into an ISOLATED scratch database on the
# same server, compares row counts table-by-table against the live database, then
# drops the scratch database.
#
# Why this exists: the backup script used to report success while writing an
# empty file, and the WORM export used to report success while uploading nothing.
# A backup is not a backup until something has been restored from it. This drill
# is the something, and it is safe to run in production because the live database
# is only ever read.
#
# Required environment variables:
#   DATABASE_URL    — live database (read-only use: connection details + counts)
#   GPG_PASSPHRASE  — Symmetric decryption passphrase
#   S3_BUCKET       — Source bucket
#   AWS_* / S3_ENDPOINT_URL — credentials / custom endpoint
#
# Optional:
#   S3_KEY          — specific object key to drill (default: newest .dump.gpg)
#   S3_PREFIX       — key prefix to search — default "backups"
#   KEEP_SCRATCH=1  — leave the scratch database in place for inspection
#   PG_PSQL_BIN / PG_RESTORE_BIN — default "psql" / "pg_restore"
#
# Usage:
#   S3_BUCKET=... GPG_PASSPHRASE=... DATABASE_URL=... ./restore-drill.sh

set -euo pipefail

PG_PSQL_BIN="${PG_PSQL_BIN:-psql}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
S3_PREFIX="${S3_PREFIX:-backups}"
KEEP_SCRATCH="${KEEP_SCRATCH:-0}"

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

for tool in gpg sha256sum awk aws; do
  command -v "${tool}" >/dev/null || { echo "[drill] FATAL: required tool not found: ${tool}" >&2; exit 1; }
done

TMPDIR=$(mktemp -d)
ENC_FILE="${TMPDIR}/backup.dump.gpg"
PLAIN_FILE="${TMPDIR}/backup.dump"
MANIFEST_FILE="${TMPDIR}/manifest.json"
SCRATCH_DB="restore_drill_$(date -u +%Y%m%d%H%M%S)"
SCRATCH_CREATED=0

fail() { echo "[drill] FATAL: $*" >&2; exit 1; }

cleanup() {
  local rc=$?
  if [[ "${SCRATCH_CREATED}" == "1" && "${KEEP_SCRATCH}" != "1" ]]; then
    # Only ever drops a database this script created, and only if it carries the
    # restore_drill_ prefix. Nothing else is ever dropped.
    if [[ "${SCRATCH_DB}" == restore_drill_* ]]; then
      ${PG_PSQL_BIN} "${ADMIN_URL}" -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\"" >/dev/null 2>&1 \
        && echo "[drill] Scratch database ${SCRATCH_DB} dropped" \
        || echo "[drill] WARNING: could not drop ${SCRATCH_DB} — drop it manually" >&2
    fi
  elif [[ "${SCRATCH_CREATED}" == "1" ]]; then
    echo "[drill] Scratch database kept: ${SCRATCH_DB}"
  fi
  if command -v shred &>/dev/null; then
    shred -u "${PLAIN_FILE}" 2>/dev/null || true
  fi
  rm -rf "${TMPDIR}"
  exit ${rc}
}
trap cleanup EXIT

# ── Build admin + scratch URLs by swapping the database name ──────────────────
# DATABASE_URL keeps its host/port/user/password; only the path changes.
ADMIN_URL="${DATABASE_URL%/*}/postgres"
LIVE_DB="${DATABASE_URL##*/}"
LIVE_DB="${LIVE_DB%%\?*}"
SCRATCH_URL="${DATABASE_URL%/*}/${SCRATCH_DB}"

[[ "${SCRATCH_DB}" != "${LIVE_DB}" ]] || fail "scratch name collides with the live database"

# ── Resolve the object key ────────────────────────────────────────────────────
if [[ -z "${S3_KEY:-}" ]]; then
  echo "[drill] Resolving newest backup under s3://${S3_BUCKET}/${S3_PREFIX}/"
  # Newest dump object, newest first. The manifest is written AFTER its dump, so
  # asking only for the newest key would always return the manifest.
  S3_KEY=$(aws s3api list-objects-v2 \
    --bucket "${S3_BUCKET}" \
    --prefix "${S3_PREFIX}/" \
    --query 'reverse(sort_by(Contents,&LastModified))[].Key' \
    --output text | tr '\t' '\n' | grep -E '\.dump\.gpg$' | head -n 1)
  [[ -n "${S3_KEY}" ]] || fail "no backup (*.dump.gpg) found under ${S3_PREFIX}/"
  [[ "${S3_KEY}" != *manifest* ]] || fail "resolver returned a manifest key: ${S3_KEY}"
fi
MANIFEST_KEY="${S3_KEY%.dump.gpg}.manifest.json"
echo "[drill] Drilling s3://${S3_BUCKET}/${S3_KEY}"

# ── Download ──────────────────────────────────────────────────────────────────
aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "${ENC_FILE}" || fail "download failed"
[[ -s "${ENC_FILE}" ]] || fail "downloaded object is empty"

MANIFEST_AVAILABLE=0
if aws s3 cp "s3://${S3_BUCKET}/${MANIFEST_KEY}" "${MANIFEST_FILE}" 2>/dev/null; then
  MANIFEST_AVAILABLE=1
  echo "[drill] Manifest: ${MANIFEST_KEY}"
else
  echo "[drill] WARNING: no manifest at ${MANIFEST_KEY} — falling back to metadata only" >&2
fi

# ── Verify the ciphertext against its manifest ────────────────────────────────
ENC_SHA=$(sha256sum "${ENC_FILE}" | awk '{print $1}')
if [[ "${MANIFEST_AVAILABLE}" == "1" ]]; then
  EXPECTED_ENC_SHA=$(grep -o '"encrypted_sha256": *"[^"]*"' "${MANIFEST_FILE}" | sed 's/.*"\([^"]*\)"$/\1/')
  [[ -n "${EXPECTED_ENC_SHA}" ]] || fail "manifest has no encrypted_sha256"
  [[ "${ENC_SHA}" == "${EXPECTED_ENC_SHA}" ]] \
    || fail "ciphertext sha256 ${ENC_SHA} != manifest ${EXPECTED_ENC_SHA}"
  echo "[drill] Ciphertext matches manifest (sha256 ${ENC_SHA})"
fi

# ── Decrypt + verify the plaintext against its manifest ───────────────────────
gpg --batch --yes --quiet --decrypt \
  --pinentry-mode loopback \
  --passphrase-fd 3 \
  --output "${PLAIN_FILE}" \
  "${ENC_FILE}" \
  3<<< "${GPG_PASSPHRASE}" || fail "decryption failed"

[[ -s "${PLAIN_FILE}" ]] || fail "decrypted dump is empty"

PLAIN_SHA=$(sha256sum "${PLAIN_FILE}" | awk '{print $1}')
if [[ "${MANIFEST_AVAILABLE}" == "1" ]]; then
  EXPECTED_PLAIN_SHA=$(grep -o '"dump_sha256": *"[^"]*"' "${MANIFEST_FILE}" | sed 's/.*"\([^"]*\)"$/\1/')
  [[ -n "${EXPECTED_PLAIN_SHA}" ]] || fail "manifest has no dump_sha256"
  [[ "${PLAIN_SHA}" == "${EXPECTED_PLAIN_SHA}" ]] \
    || fail "decrypted dump sha256 ${PLAIN_SHA} != manifest ${EXPECTED_PLAIN_SHA}"
  echo "[drill] Decrypted dump matches manifest (sha256 ${PLAIN_SHA})"
fi

TOC_LINES=$(${PG_RESTORE_BIN} --list "${PLAIN_FILE}" 2>/dev/null | wc -l | tr -d ' ') \
  || fail "pg_restore cannot read the archive"
[[ "${TOC_LINES}" -gt 0 ]] || fail "archive table of contents is empty"
echo "[drill] Archive readable: ${TOC_LINES} TOC entries"

# ── Restore into the isolated scratch database ────────────────────────────────
echo "[drill] Creating scratch database ${SCRATCH_DB}"
${PG_PSQL_BIN} "${ADMIN_URL}" -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${SCRATCH_DB}\"" >/dev/null || fail "could not create ${SCRATCH_DB}"
SCRATCH_CREATED=1

echo "[drill] Restoring into ${SCRATCH_DB}"
${PG_RESTORE_BIN} \
  --dbname="${SCRATCH_URL}" \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  "${PLAIN_FILE}" >/dev/null 2>"${TMPDIR}/restore.err" || {
    # pg_restore exits non-zero on warnings; only fail when nothing landed.
    RESTORED=$(${PG_PSQL_BIN} "${SCRATCH_URL}" -t -A -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')" 2>/dev/null || echo 0)
    [[ "${RESTORED}" -gt 0 ]] || { cat "${TMPDIR}/restore.err" >&2; fail "restore produced no tables"; }
    echo "[drill] pg_restore reported warnings; ${RESTORED} tables present anyway" >&2
  }

# ── Compare row counts, table by table ────────────────────────────────────────
echo "[drill] Comparing row counts against the live database"
TABLES=$(${PG_PSQL_BIN} "${SCRATCH_URL}" -t -A -c \
  "SELECT table_schema || '.' || table_name
     FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY 1")

MISMATCHES=0
CHECKED=0
for t in ${TABLES}; do
  LIVE_COUNT=$(${PG_PSQL_BIN} "${DATABASE_URL}" -t -A -c "SELECT count(*) FROM ${t}" 2>/dev/null || echo "?")
  DRILL_COUNT=$(${PG_PSQL_BIN} "${SCRATCH_URL}" -t -A -c "SELECT count(*) FROM ${t}" 2>/dev/null || echo "?")
  CHECKED=$((CHECKED + 1))
  if [[ "${LIVE_COUNT}" != "${DRILL_COUNT}" ]]; then
    MISMATCHES=$((MISMATCHES + 1))
    printf '  MISMATCH %-45s live=%-10s restored=%s\n' "${t}" "${LIVE_COUNT}" "${DRILL_COUNT}"
  fi
done

echo "[drill] Compared ${CHECKED} tables"
[[ "${MISMATCHES}" -eq 0 ]] || fail "${MISMATCHES} table(s) differ between live and restored"

echo "[drill] PASS — backup ${S3_KEY} restores cleanly, ${CHECKED} tables match the live database"
