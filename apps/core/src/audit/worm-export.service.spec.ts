import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import * as zlib from "zlib";
import { promisify } from "util";
import * as crypto from "crypto";

const gunzip = promisify(zlib.gunzip);

// A miniature S3: remembers the last PutObject and answers HeadObject from it,
// so the service's read-back path is exercised rather than assumed.
interface FakePut {
  Bucket: string;
  Key: string;
  Body: Buffer;
  Metadata: Record<string, string>;
}
const s3State: {
  objects: Map<string, FakePut>;
  puts: FakePut[];
  failImport: boolean;
  corruptDigest: boolean;
  corruptSize: boolean;
} = {
  objects: new Map(),
  puts: [],
  failImport: false,
  corruptDigest: false,
  corruptSize: false,
};

jest.mock("@aws-sdk/client-s3", () => {
  if (s3State.failImport) {
    throw new Error("Cannot find module '@aws-sdk/client-s3'");
  }
  const key = (p: { Bucket: string; Key: string }): string => `${p.Bucket}/${p.Key}`;
  class PutObjectCommand {
    readonly kind = "put";
    constructor(readonly input: FakePut) {}
  }
  class HeadObjectCommand {
    readonly kind = "head";
    constructor(readonly input: { Bucket: string; Key: string }) {}
  }
  class S3Client {
    async send(cmd: PutObjectCommand | HeadObjectCommand): Promise<unknown> {
      if (cmd.kind === "put") {
        const stored: FakePut = { ...cmd.input, Body: Buffer.from(cmd.input.Body) };
        s3State.objects.set(key(stored), stored);
        s3State.puts.push(stored);
        return { ETag: '"fake-etag"' };
      }
      const found = s3State.objects.get(key(cmd.input));
      if (!found) throw new Error(`NoSuchKey: ${key(cmd.input)}`);
      const metadata = { ...found.Metadata };
      if (s3State.corruptDigest) metadata["x-content-sha256"] = "0".repeat(64);
      return {
        ContentLength: s3State.corruptSize ? found.Body.length + 1 : found.Body.length,
        Metadata: metadata,
      };
    }
  }
  return { S3Client, PutObjectCommand, HeadObjectCommand };
});

import { WormExportService } from "./worm-export.service";
import { PG_POOL } from "../database/database.module";

const ROW_A = {
  id: "11111111-1111-1111-1111-111111111111",
  ts: "2026-09-16T08:00:00.000Z",
  actor_id: null,
  actor_role: "physician",
  action: "HTTP_POST_/api/v1/draft",
  target_type: null,
  target_id: null,
  outcome: "SUCCESS",
  metadata_json: {},
  request_id: "req-1",
  hash_prev: "prev-hash",
  hash_self: "hash-a",
};
const ROW_B = {
  ...ROW_A,
  id: "22222222-2222-2222-2222-222222222222",
  ts: "2026-09-16T09:00:00.000Z",
  hash_prev: "hash-a",
  hash_self: "hash-b",
};

interface FakeLogger {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
}

function makeService(
  rows: unknown[],
  env: Record<string, string | undefined> = {},
): { service: WormExportService; logger: FakeLogger; pool: { query: jest.Mock } } {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const config = {
    get: (key: string, fallback?: string): string | undefined => {
      if (key in env) return env[key];
      if (key === "S3_AUDIT_BUCKET") return "clinical-copilot-audit";
      if (key === "AWS_DEFAULT_REGION") return "me-south-1";
      return fallback;
    },
  } as unknown as ConfigService;
  const pool = { query: jest.fn().mockResolvedValue({ rows }) };
  const service = new WormExportService(config, logger as never, pool as never);
  return { service, logger, pool };
}

/** Events the logger emitted, in order, as `event` field values. */
function loggedEvents(logger: FakeLogger): string[] {
  const events: string[] = [];
  for (const call of [...logger.info.mock.calls, ...logger.warn.mock.calls]) {
    const payload = call[0];
    if (payload && typeof payload === "object" && "event" in payload) {
      events.push(String((payload as { event: unknown }).event));
    }
  }
  return events;
}

const successLogged = (logger: FakeLogger): boolean =>
  loggedEvents(logger).includes("AUDIT_WORM_EXPORTED");

describe("WormExportService", () => {
  beforeEach(() => {
    s3State.objects.clear();
    s3State.puts.length = 0;
    s3State.failImport = false;
    s3State.corruptDigest = false;
    s3State.corruptSize = false;
  });

  // M08: "WORM export can log success without upload". The previous code logged
  // AUDIT_WORM_EXPORTED even when the SDK was missing and nothing was written.
  it("does not report success when the S3 SDK cannot be loaded", async () => {
    s3State.failImport = true;
    const { service, logger } = makeService([ROW_A, ROW_B]);

    await expect(service.exportDate(new Date("2026-09-17T02:00:00Z"))).rejects.toThrow(
      /WORM_EXPORT_ALLOW_STUB is not set/,
    );

    expect(successLogged(logger)).toBe(false);
  });

  it("reports SKIPPED rather than EXPORTED in explicit stub mode", async () => {
    s3State.failImport = true;
    const { service, logger } = makeService([ROW_A], { WORM_EXPORT_ALLOW_STUB: "true" });

    const result = await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    expect(result.uploaded).toBe(false);
    expect(result.verified).toBe(false);
    expect(successLogged(logger)).toBe(false);
    expect(loggedEvents(logger)).toContain("AUDIT_WORM_EXPORT_SKIPPED");
  });

  it("uploads, reads back, and only then reports success", async () => {
    const { service, logger } = makeService([ROW_A, ROW_B]);

    const result = await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    expect(result.uploaded).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.row_count).toBe(2);
    expect(result.key).toBe("audit/2026/09/17/audit-2026-09-17.ndjson.gz");
    expect(successLogged(logger)).toBe(true);

    // The object and the manifest were both written, and the manifest read back.
    const keys = s3State.puts.map((p) => p.Key);
    expect(keys).toContain(result.key);
    expect(keys).toContain(result.manifest_key);
  });

  it("stores the digest of the bytes that were actually uploaded", async () => {
    const { service } = makeService([ROW_A, ROW_B]);

    const result = await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    const stored = s3State.puts.find((p) => p.Key.endsWith(".ndjson.gz"));
    expect(stored).toBeDefined();

    // The digest advertised in the object metadata must match hashing the stored
    // object directly -- this is the check a third-party verifier performs.
    const directHash = crypto.createHash("sha256").update(stored!.Body).digest("hex");
    expect((stored!.Metadata as Record<string, string>)["x-content-sha256"]).toBe(directHash);
    expect(result.content_sha256).toBe(directHash);

    // The plaintext digest is kept separately, under its own name, for readers
    // that decompress first.
    const plaintext = await gunzip(stored!.Body);
    const plaintextHash = crypto.createHash("sha256").update(plaintext).digest("hex");
    expect(result.ndjson_sha256).toBe(plaintextHash);
    expect((stored!.Metadata as Record<string, string>)["ndjson_sha256"]).toBe(plaintextHash);
  });

  it("fails instead of reporting success when the read-back digest differs", async () => {
    s3State.corruptDigest = true;
    const { service, logger } = makeService([ROW_A]);

    await expect(service.exportDate(new Date("2026-09-17T02:00:00Z"))).rejects.toThrow(
      /read-back digest mismatch/,
    );
    expect(successLogged(logger)).toBe(false);
  });

  it("fails instead of reporting success when the stored size differs", async () => {
    s3State.corruptSize = true;
    const { service, logger } = makeService([ROW_A]);

    await expect(service.exportDate(new Date("2026-09-17T02:00:00Z"))).rejects.toThrow(
      /read-back size mismatch/,
    );
    expect(successLogged(logger)).toBe(false);
  });

  it("records the chain slice it covers in the manifest", async () => {
    const { service } = makeService([ROW_A, ROW_B]);

    const result = await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    const manifestPut = s3State.puts.find((p) => p.Key.endsWith(".manifest.json"));
    expect(manifestPut).toBeDefined();
    const manifest = JSON.parse(manifestPut!.Body.toString("utf8")) as Record<string, unknown>;

    expect(manifest.export_date).toBe("2026-09-17");
    expect(manifest.row_count).toBe(2);
    expect(manifest.chain_prev_of_first).toBe("prev-hash");
    expect(manifest.chain_tip).toBe("hash-b");
    expect(manifest.content_sha256).toBe(result.content_sha256);
    expect(manifest.ndjson_sha256).toBe(result.ndjson_sha256);
  });

  it("queries an explicit UTC window instead of relying on the session timezone", async () => {
    const { service, pool } = makeService([ROW_A]);

    await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    const params = pool.query.mock.calls[0][1] as string[];
    expect(params).toEqual([
      "2026-09-17T00:00:00.000Z",
      "2026-09-18T00:00:00.000Z",
    ]);
    // The bounds are timestamptz, not a bare ::date.
    const sql = pool.query.mock.calls[0][0] as string;
    expect(sql).toContain("$1::timestamptz");
    expect(sql).not.toContain("::date");
  });

  it("still exports an empty day, with zero rows recorded honestly", async () => {
    const { service, logger } = makeService([]);

    const result = await service.exportDate(new Date("2026-09-17T02:00:00Z"));

    expect(result.row_count).toBe(0);
    expect(result.verified).toBe(true);
    expect(successLogged(logger)).toBe(true);
  });
});
