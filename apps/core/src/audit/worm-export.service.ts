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
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  metadata_json: Record<string, unknown> | null;
  request_id: string | null;
  hash_prev: string | null;
  hash_self: string;
}

/**
 * WORM (Write-Once Read-Many) audit export service.
 *
 * Exports yesterday's audit events to an S3-compatible object store daily at
 * 02:00 local time. The export is:
 *   - NDJSON (one JSON object per line, ordered by ts ASC, id ASC)
 *   - Gzip compressed
 *   - Uploaded to: audit/{YYYY}/{MM}/{DD}/audit-{YYYY-MM-DD}.ndjson.gz
 *   - Accompanied by a manifest at the same path, .manifest.json
 *   - Read back from the object store and compared before success is reported
 *
 * The S3 bucket MUST have Object Lock (WORM) configured in Terraform/Helm --
 * this is an infrastructure concern, not application code.
 *
 * PHI note: audit events may contain patient_id (UUID) and action codes but
 * NOT free-text clinical content.
 *
 * WHY SUCCESS IS ONLY REPORTED AFTER A READ-BACK
 * ----------------------------------------------
 * This service used to log "WORM export completed" (event
 * AUDIT_WORM_EXPORTED) in every case, including when the S3 SDK failed to load
 * and nothing was uploaded at all: the upload helper returned early and the
 * caller carried on as if the data were safely in WORM storage. An audit trail
 * that reports success for objects that do not exist is worse than one that
 * reports nothing, because it stops anyone from looking.
 *
 * It also stamped x-content-sha256 with the hash of the *uncompressed* buffer
 * while the object stored alongside it was the *gzip* stream, so any verifier
 * that downloaded the object and hashed it would compute a different digest and
 * conclude the file had been tampered with.
 *
 * Now: the object is written, then read back (HeadObject) and its size and
 * digest compared against what was sent, and a manifest records the hash of the
 * exact bytes stored. Only a verified upload emits the success event.
 */

const EXPORT_HOUR = 2; // 02:00 local time

export interface WormExportResult {
  /** True only when bytes reached the object store. */
  readonly uploaded: boolean;
  /** True only when the stored object was read back and matched. */
  readonly verified: boolean;
  readonly key: string;
  readonly manifest_key: string | null;
  readonly row_count: number;
  /** SHA-256 of the exact bytes stored (the gzip stream). */
  readonly content_sha256: string;
  readonly content_bytes: number;
  /** SHA-256 of the plaintext NDJSON, for anyone who decompresses first. */
  readonly ndjson_sha256: string;
  /** Why nothing was uploaded. Present only when `uploaded` is false. */
  readonly reason?: string | undefined;
}

interface PutResult {
  ETag?: string;
}

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

    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- scheduled task, errors logged internally
      this.timer = setTimeout(async () => {
      // A failed export must not crash the API process; log and continue so the
      // next day's export is still scheduled. The failure is loud: nothing
      // reports success unless the object was read back from the store.
      try {
        await this.exportYesterday();
      } catch (err) {
        this.logger.error(
          { err, event: "AUDIT_WORM_EXPORT_FAILED" },
          "WORM export failed",
        );
      }
      this.scheduleNextExport();
    }, delayMs);
  }

  /**
   * Export audit events for yesterday.
   * Also callable manually via the admin endpoint POST /api/v1/admin/audit/export-worm.
   */
  async exportYesterday(): Promise<WormExportResult> {
    // "Yesterday" is the last COMPLETE UTC day. Deriving it from the local clock
    // made the export depend on where the process happens to run: at a local
    // midnight ahead of UTC the window being exported was still open.
    const now = new Date();
    const target = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    return this.exportDate(target);
  }

  async exportDate(date: Date): Promise<WormExportResult> {
    // An export day is a UTC day, and the window is passed as explicit
    // timestamps rather than a bare ::date, so the slice does not shift with the
    // server's or the session's timezone. audit.event.ts is timestamptz.
    const yyyy = date.getUTCFullYear().toString();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const windowStart = `${dateStr}T00:00:00.000Z`;
    const windowEnd = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
    ).toISOString();

    this.logger.info(
      { date: dateStr, window_start: windowStart, window_end: windowEnd },
      "WORM export starting",
    );

    const result = await this.pool.query<AuditRow>(
      `SELECT id, ts, actor_id, actor_role, action, target_type, target_id,
              outcome, metadata_json, request_id, hash_prev, hash_self
         FROM audit.event
        WHERE ts >= $1::timestamptz AND ts < $2::timestamptz
        ORDER BY ts ASC, id ASC`,
      [windowStart, windowEnd],
    );

    const rows = result.rows;
    this.logger.info({ date: dateStr, row_count: rows.length }, "WORM export rows fetched");

    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const buffer = Buffer.from(ndjson, "utf8");
    const ndjsonSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const compressed = await gzip(buffer, { level: 9 });
    // The digest of the bytes actually stored. Hashing the plaintext and putting
    // that in the object's metadata is what made verification impossible.
    const contentSha256 = crypto.createHash("sha256").update(compressed).digest("hex");

    const bucket = this.config.get<string>("S3_AUDIT_BUCKET", "clinical-copilot-audit");
    const key = `audit/${yyyy}/${mm}/${dd}/audit-${dateStr}.ndjson.gz`;
    const manifestKey = `audit/${yyyy}/${mm}/${dd}/audit-${dateStr}.manifest.json`;

    const first = rows[0];
    const last = rows[rows.length - 1];

    const manifest = {
      export_date: dateStr,
      export_window_start_utc: windowStart,
      export_window_end_utc: windowEnd,
      generated_at_utc: new Date().toISOString(),
      bucket,
      key,
      row_count: rows.length,
      // Which slice of the hash chain this file covers: first.hash_prev links to
      // the previous export, last.hash_self is the tip inside this file.
      chain_first_id: first?.id ?? null,
      chain_first_ts: first?.ts ?? null,
      chain_prev_of_first: first?.hash_prev ?? null,
      chain_last_id: last?.id ?? null,
      chain_last_ts: last?.ts ?? null,
      chain_tip: last?.hash_self ?? null,
      content_sha256: contentSha256,
      content_bytes: compressed.length,
      content_encoding: "gzip",
      ndjson_sha256: ndjsonSha256,
      ndjson_bytes: buffer.length,
    };

    const upload = await this.uploadToS3(bucket, key, compressed, contentSha256, {
      row_count: String(rows.length),
      export_date: dateStr,
      ndjson_sha256: ndjsonSha256,
    });

    if (!upload.uploaded) {
      // Stub mode is an explicit, configured state -- never reported as success.
      this.logger.warn(
        {
          event: "AUDIT_WORM_EXPORT_SKIPPED",
          date: dateStr,
          row_count: rows.length,
          reason: upload.reason,
        },
        "WORM export not uploaded -- no success reported",
      );
      return {
        uploaded: false,
        verified: false,
        key,
        manifest_key: null,
        row_count: rows.length,
        content_sha256: contentSha256,
        content_bytes: compressed.length,
        ndjson_sha256: ndjsonSha256,
        reason: upload.reason,
      };
    }

    if (!upload.verified) {
      throw new Error(
        `WORM export for ${dateStr} was uploaded but failed read-back verification`,
      );
    }

    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const manifestUpload = await this.uploadToS3(
      bucket,
      manifestKey,
      manifestBuffer,
      crypto.createHash("sha256").update(manifestBuffer).digest("hex"),
      { export_date: dateStr, kind: "manifest" },
      "application/json",
    );

    if (!manifestUpload.uploaded || !manifestUpload.verified) {
      throw new Error(
        `WORM export for ${dateStr}: manifest upload unverified (${manifestUpload.reason ?? "no reason given"})`,
      );
    }

    this.logger.info(
      {
        event: "AUDIT_WORM_EXPORTED",
        date: dateStr,
        row_count: rows.length,
        s3_key: key,
        manifest_key: manifestKey,
        content_sha256: contentSha256,
        ndjson_sha256: ndjsonSha256,
        content_bytes: compressed.length,
        read_back_verified: true,
      },
      "WORM export completed and verified",
    );

    return {
      uploaded: true,
      verified: true,
      key,
      manifest_key: manifestKey,
      row_count: rows.length,
      content_sha256: contentSha256,
      content_bytes: compressed.length,
      ndjson_sha256: ndjsonSha256,
    };
  }

  /**
   * Put an object, then read it back and compare size and digest.
   *
   * Returns `uploaded: false` only in explicit stub mode (see
   * WORM_EXPORT_ALLOW_STUB). Any other problem throws, because a caller that
   * cannot tell "not uploaded" from "uploaded fine" is how this service
   * previously reported success for objects that were never written.
   */
  private async uploadToS3(
    bucket: string,
    key: string,
    body: Buffer,
    contentSha256: string,
    metadata: Record<string, string>,
    contentType = "application/x-ndjson",
  ): Promise<{ uploaded: boolean; verified: boolean; reason?: string }> {
    let S3Client: new (config: unknown) => { send: (cmd: unknown) => Promise<PutResult> };
    let PutObjectCommand: new (params: unknown) => unknown;
    let HeadObjectCommand: new (params: unknown) => unknown;

    try {
      const sdk = await import("@aws-sdk/client-s3") as {
        S3Client: typeof S3Client;
        PutObjectCommand: typeof PutObjectCommand;
        HeadObjectCommand: typeof HeadObjectCommand;
      };
      S3Client = sdk.S3Client;
      PutObjectCommand = sdk.PutObjectCommand;
      HeadObjectCommand = sdk.HeadObjectCommand;
    } catch (err) {
      if (this.config.get<string>("WORM_EXPORT_ALLOW_STUB") === "true") {
        return {
          uploaded: false,
          verified: false,
          reason: `@aws-sdk/client-s3 unavailable and WORM_EXPORT_ALLOW_STUB=true: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      throw new Error(
        `@aws-sdk/client-s3 could not be loaded and WORM_EXPORT_ALLOW_STUB is not set: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const endpoint = this.config.get<string>("S3_ENDPOINT_URL");
    const region = this.config.get<string>("AWS_DEFAULT_REGION", "me-south-1");

    const client = new S3Client({
      region,
      // A custom endpoint (dev MinIO, or any S3-compatible store) must use
      // path-style addressing -- virtual-host style would resolve
      // <bucket>.localhost, which doesn't exist outside real AWS S3.
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: this.config.get<string>("S3_ACCESS_KEY_ID", ""),
        secretAccessKey: this.config.get<string>("S3_SECRET_ACCESS_KEY", ""),
      },
    });

    const put = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentEncoding: "gzip",
        ContentType: contentType,
        Metadata: {
          // The digest of the stored bytes, under the name a verifier will look
          // for. The plaintext digest rides alongside for decompressing readers.
          "x-content-sha256": contentSha256,
          ...metadata,
        },
      }),
    );

    if (!put.ETag) {
      throw new Error(
        `WORM export upload for ${key} returned no ETag -- integrity unverified`,
      );
    }

    // Read back what the store actually holds.
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    ) as {
      ContentLength?: number;
      Metadata?: Record<string, string>;
    };

    if (typeof head.ContentLength === "number" && head.ContentLength !== body.length) {
      throw new Error(
        `WORM export read-back size mismatch for ${key}: stored ${head.ContentLength}, uploaded ${body.length}`,
      );
    }

    const storedSha = (head.Metadata ?? {})["x-content-sha256"];
    if (!storedSha) {
      throw new Error(
        `WORM export read-back for ${key} has no x-content-sha256 metadata`,
      );
    }
    if (storedSha !== contentSha256) {
      throw new Error(
        `WORM export read-back digest mismatch for ${key}: stored ${storedSha}, uploaded ${contentSha256}`,
      );
    }

    this.logger.info(
      { key, etag: put.ETag, content_sha256: contentSha256, bytes: body.length },
      "S3 upload verified by read-back",
    );

    return { uploaded: true, verified: true };
  }
}
