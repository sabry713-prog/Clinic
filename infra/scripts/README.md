# Infrastructure Scripts

## backup-db.sh

Daily PostgreSQL backup with encryption.

```bash
DATABASE_URL=postgres://user:pass@host/dbname \
GPG_PASSPHRASE=your-passphrase \
S3_BUCKET=clinical-copilot-backups \
ENV=prod \
./infra/scripts/backup-db.sh
```

Process:
1. `pg_dump` with custom format and level-9 compression
2. GPG symmetric encryption with AES-256
3. SHA-256 checksum of the encrypted file
4. Upload to `s3://$S3_BUCKET/$S3_PREFIX/$ENV/$YYYY/$MM/$DD/`

The S3 bucket must have Object Lock enabled (configured in Terraform).

## restore-db.sh

Disaster recovery restore.

```bash
S3_KEY=backups/prod/2026/06/10/backup-20260610-020000.dump.gpg \
DATABASE_URL=postgres://user:pass@host/newdb \
GPG_PASSPHRASE=your-passphrase \
S3_BUCKET=clinical-copilot-backups \
./infra/scripts/restore-db.sh
```

**WARNING**: This drops and recreates the target database. Use only for disaster recovery.

## Scheduling

The backup is run daily at 02:00 via `just backup-db` in a Kubernetes CronJob
(or cron on the database node). The WORM export also runs at 02:00 and is
coordinated so that the backup runs first.
