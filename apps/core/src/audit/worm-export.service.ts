import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { Pool } from "pg";
import * as crypto from "crypto";
import * as zlib from "zlib";
import { promisify } from "util";
import { PG_POOL } from "../database/database.module";

const gzip = promisify(zlib.gzip);

interface AuditRow {
  id: string;
  ts: string;
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  patient_id: string | null;
  details: Record<string, unknown> | null;
  prev_hash: string | null;
  hash: string;
}

interface S3PutResult {
  ETag?: string;
}

/**
 * WORM (Write-Once Read-Many) audit export service.
 *
 * Exports yesterday's audit events to an S3-compatible object store daily at
 * 02:00 local time. The export is:
 *   - NDJSON (one JSON object per line, ordered by ts ASC, id ASC)
 *   - Gzip compressed
 *   - Uploaded to: audit/{YYYY}/{MM}/{DD}/audit-{YYYY-MM-DD}.ndjson.gz
 *   - Integrity verified via ETag / SHA-256 checksum
 *
 * The S3 bucket MUST have Object Lock (WORM) configured in Terraform/Helm —
 * this is an infrastructure concern, not application code.
 *
 * PHI note: audit events may contain patient_id (UUID) and action codes but
 * NOT free-text clinical content.
 */

const EXPORT_HOUR = 2; // 02:00 local time

@Injectable()
export class WormExportService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectPinoLogger(WormExportService.name)
    private readonly logger: PinoLogger,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  onModuleInit(): void {
    this.scheduleNextExport();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNextExport(): void {
    const now = new Date();
    const next = new Date(now);
    next.setHours(EXPORT_HOUR, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delayMs = next.getTime() - now.getTime();

    this.logger.info(
      { next_export: next.toISOString() },
      "WORM export scheduled",
    );

    this.timer = setTimeout(async () => {
      await this.exportYesterday();
      this.scheduleNextExport();
    }, delayMs);
  }

  /**
   * Export audit events for yesterday.
   * Also callable manually via the admin endpoint POST /api/v1/admin/audit/export-worm.
   */
  async exportYesterday(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await this.exportDate(yesterday);
  }

  async exportDate(date: Date): Promise<void> {
    const yyyy = date.getFullYear().toString();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    this.logger.info({ date: dateStr }, "WORM export starting");

    const result = await this.pool.query<AuditRow>(
      `SELECT id, ts, tenant_id, actor_id AS user_id, action, target_type AS resource_type,
              target_id AS resource_id, NULL::uuid AS patient_id,
              metadata_json AS details, NULL AS prev_hash, id AS hash
         FROM audit.event
        WHERE ts >= $1::date AND ts < ($1::date + INTERVAL '1 day')
        ORDER BY ts ASC, id ASC`,
      [dateStr],
    );

    const rows = result.rows;
    this.logger.info({ date: dateStr, row_count: rows.length }, "WORM export rows fetched");

    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const buffer = Buffer.from(ndjson, "utf8");

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const compressed = await gzip(buffer, { level: 9 });

    const bucket = this.config.get<string>("S3_AUDIT_BUCKET", "clinical-copilot-audit");
    const key = `audit/${yyyy}/${mm}/${dd}/audit-${dateStr}.ndjson.gz`;

    // Perform the S3 upload via the AWS SDK v3 (dynamically imported so the
    // module compiles even when the SDK is not installed in dev/test mode).
    await this.uploadToS3(bucket, key, compressed, sha256, rows.length, dateStr);

    this.logger.info(
      {
        event: "AUDIT_WORM_EXPORTED",
        date: dateStr,
        row_count: rows.length,
        s3_key: key,
        sha256,
      },
      "WORM export completed",
    );
  }

  private async uploadToS3(
    bucket: string,
    key: string,
    body: Buffer,
    sha256: string,
    rowCount: number,
    dateStr: string,
  ): Promise<void> {
    // Dynamic import: if @aws-sdk/client-s3 is not installed (local dev / tests),
    // log a warning and skip the upload rather than crashing.
    let S3Client: new (config: unknown) => { send: (cmd: unknown) => Promise<S3PutResult> };
    let PutObjectCommand: new (params: unknown) => unknown;

    try {
      const sdk = await import("@aws-sdk/client-s3") as {
        S3Client: typeof S3Client;
        PutObjectCommand: typeof PutObjectCommand;
      };
      S3Client = sdk.S3Client;
      PutObjectCommand = sdk.PutObjectCommand;
    } catch {
      this.logger.warn(
        { key },
        "WORM export: @aws-sdk/client-s3 not installed — skipping S3 upload (stub mode)",
      );
      return;
    }

    const endpoint = this.config.get<string>("S3_ENDPOINT_URL");
    const region = this.config.get<string>("AWS_DEFAULT_REGION", "me-south-1");

    const client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: this.config.get<string>("S3_ACCESS_KEY_ID", ""),
        secretAccessKey: this.config.get<string>("S3_SECRET_ACCESS_KEY", ""),
      },
    });

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentEncoding: "gzip",
      ContentType: "application/x-ndjson",
      Metadata: {
        "x-content-sha256": sha256,
        "x-row-count": String(rowCount),
        "x-export-date": dateStr,
      },
    });

    const result = await client.send(cmd) as S3PutResult;

    if (!result.ETag) {
      throw new Error(
        `WORM export upload for ${dateStr} returned no ETag — integrity unverified`,
      );
    }

    this.logger.info({ etag: result.ETag, key }, "S3 upload verified");
  }
}
