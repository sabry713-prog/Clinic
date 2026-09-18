# Infrastructure Scripts

## backup-db.sh

Daily PostgreSQL backup with encryption. Every step is verified before the next
one runs, and the script only reports success after the object has been read back
from the object store.

```bash
DATABASE_URL=postgres://user:***@host/dbname \
GPG_PASSPHRASE=your-passphrase \
S3_BUCKET=clinical-copilot-backups \
ENV=prod \
./infra/scripts/backup-db.sh
```

Process:
1. Preflight — `gpg`, `sha256sum`, `awk` and `aws` must all be present; a missing
   tool is a hard failure rather than a skipped step.
2. `pg_dump` in custom format with level-9 compression, written to a temp file.
3. The dump is verified: non-empty, and `pg_restore --list` can read its archive
   header and table of contents.
4. GPG symmetric encryption, AES-256. The passphrase is read from **file
   descriptor 3** and the dump is passed as a file argument, so data and
   passphrase never share standard input.
5. The ciphertext is decrypted again and its SHA-256 compared with the dump's —
   a byte-exact round trip. A backup that cannot be decrypted is not uploaded.
6. A manifest (`backup-<timestamp>.manifest.json`) recording both digests, both
   sizes, the TOC entry count and the verification results is written alongside.
7. Both objects are uploaded to `s3://$S3_BUCKET/$S3_PREFIX/$ENV/$YYYY/$MM/$DD/`.
8. The uploaded ciphertext is read back with `HeadObject` and its size and
   SHA-256 compared with the local values.

### Why the verification is not optional

An earlier version read the passphrase from stdin while `pg_dump`'s output
arrived on that same stdin:

```bash
pg_dump "$DATABASE_URL" ... | gpg ... --passphrase-fd 0 ... <<< "$GPG_PASSPHRASE"
```

The here-string wins the redirection, so gpg took the passphrase from it and the
dump bytes went nowhere. A 200 KB dump produced a 70-byte file containing zero
bytes, and the script exited 0 reporting "Upload complete". Since this is the
only backup path, that failure was silent data-loss insurance that did not exist.

## restore-drill.sh

Proves a backup can actually be restored, without touching the live database.

```bash
S3_BUCKET=clinical-copilot-backups \
GPG_PASSPHRASE=your-passphrase \
DATABASE_URL=postgres://user:***@host/clinical_copilot \
./infra/scripts/restore-drill.sh
```

Process:
1. Resolves the newest `*.dump.gpg` under `$S3_PREFIX/` (or takes `S3_KEY`).
   Manifests are excluded: they are written after their dump, so they are always
   newer and would otherwise always be selected.
2. Downloads the ciphertext and its manifest, and checks the ciphertext SHA-256
   against `encrypted_sha256` in the manifest.
3. Decrypts and checks the plaintext SHA-256 against `dump_sha256`.
4. Confirms `pg_restore` can read the archive, then creates a scratch database
   named `restore_drill_<UTC timestamp>` on the same server and restores into it.
5. Compares row counts table-by-table between the live database and the restored
   copy, and fails on any mismatch.
6. Drops the scratch database (set `KEEP_SCRATCH=1` to inspect it first).

The live database is only ever read. The only database dropped is the scratch one
this script created, and only when its name carries the `restore_drill_` prefix.

Run it after changing anything in the backup path, and periodically in
production — a backup nobody has restored is a hypothesis, not a backup.

## restore-db.sh

Disaster recovery restore.

```bash
S3_KEY=backups/prod/2026/06/10/backup-20260610-020000.dump.gpg \
DATABASE_URL=postgres://user:***@host/newdb \
GPG_PASSPHRASE=your-passphrase \
S3_BUCKET=clinical-copilot-backups \
./infra/scripts/restore-db.sh
```

**WARNING**: This drops and recreates the target database. Use only for disaster
recovery. To verify a backup without destroying anything, use `restore-drill.sh`.

## Scheduling

The backup is run daily at 02:00 by a Kubernetes CronJob (or cron on the database
node) invoking `just backup-db`. The WORM audit export is scheduled by the core
service itself at 02:00 local time.

The two are **not** coordinated in code: the backup CronJob and the in-process
WORM export each fire independently at 02:00, and a `HeadObject` read-back is what
tells either of them whether its own upload actually landed. Schedule them apart
(for example the WORM export at 02:00 and the backup at 02:30) if you want the
backup to observe a settled audit table.

## RPO and RTO — the position today, and what production must decide

Nothing in this repository stated either, so here it is read off the scripts rather than
asserted.

**Recovery point (how much data may be lost): 24 hours, as the system stands.** One
encrypted dump a night at 02:00 (`backup-db.sh`). There is no WAL archiving and no
point-in-time recovery: the Terraform postgres module *names* the knobs and leaves them
commented out (`infra/terraform/modules/postgres/main.tf:51-59` — `backup_retention_period`,
`backup_window`, `skip_final_snapshot`), so what retention a deployment actually gets is
whatever the provider defaults to. For a clinical system a 24-hour loss window is a
decision, not a default, and the pilot has to be told the number.

**Recovery time: not measured.** `restore-drill.sh` proves a backup is *restorable* — it
decrypts it, lists the archive, restores into a scratch database and compares row counts
table by table — but it does not time anything, and no timed restore of a
production-sized database has been recorded. *Restorable* and *recoverable within an
hour* are different claims, and only the first one is supported today.

**What the drill needs (checked today):** `GPG_PASSPHRASE` plus the `S3_*`/`AWS_*`
variables. None of those names appear in the repository's `.env` — they come from the
operator's secret store, so only someone given them can run a drill. That is right for a
passphrase and is exactly why the drill has to be scheduled rather than remembered.

```
S3_BUCKET=... GPG_PASSPHRASE=... ./infra/scripts/restore-drill.sh
```

Run it after any change to the backup path — it is that change's regression test — and
periodically in production. Proposed cadence, for sign-off rather than assumed: monthly,
recording the measured restore time each run, so the RTO stops being a hypothesis.

**To close L06, production must decide and then verify:** a site-specific RPO and RTO with
a named owner; WAL archiving or provider PITR to back the RPO; the restore time measured
on production-sized data; and a failover drill that covers the graph and the object store,
not only Postgres. Trigger: before the first operational pilot loads real data.
