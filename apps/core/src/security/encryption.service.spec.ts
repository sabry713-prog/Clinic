/**
 * Unit tests for the envelope-encryption engine (customer-managed encryption
 * keys). Uses the REAL LocalKeyProviderService (real AES-256-GCM keywrap, dev
 * master key) — this is genuine crypto, not a stub, so these tests exercise
 * the actual algorithm. CustomerKeyProviderService is exercised separately to
 * confirm it never fakes success.
 */

import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "./encryption.service";
import { LocalKeyProviderService } from "./local-key-provider.service";
import { CustomerKeyProviderService } from "./customer-key-provider.service";
import { CustomerKmsNotConfiguredError } from "./key-provider";
import type { Pool } from "pg";

function makeConfig(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function makeEncryptionService(configValues: Record<string, string> = {}, pool: Pool = { query: jest.fn() } as unknown as Pool): EncryptionService {
  const config = makeConfig(configValues);
  return new EncryptionService(config, new LocalKeyProviderService(config), new CustomerKeyProviderService(pool));
}

describe("EncryptionService (local provider — default)", () => {
  it("round-trips: decrypt(encrypt(x)) === x", async () => {
    const svc = makeEncryptionService();
    const { ciphertext, keyId } = await svc.encrypt("Assessment: bronchitis. Plan: amoxicillin.");
    expect(keyId).toBe("local:v1");
    expect(ciphertext).not.toContain("bronchitis"); // not plaintext at rest

    const plaintext = await svc.decrypt(ciphertext, keyId);
    expect(plaintext).toBe("Assessment: bronchitis. Plan: amoxicillin.");
  });

  it("produces different ciphertext for the same plaintext on each call (fresh DEK/IV per record)", async () => {
    const svc = makeEncryptionService();
    const a = await svc.encrypt("same text");
    const b = await svc.encrypt("same text");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await svc.decrypt(a.ciphertext, a.keyId)).toBe("same text");
    expect(await svc.decrypt(b.ciphertext, b.keyId)).toBe("same text");
  });

  it("GCM tamper detection: a corrupted ciphertext throws rather than returning garbage", async () => {
    const svc = makeEncryptionService();
    const { ciphertext, keyId } = await svc.encrypt("sensitive clinical text");

    const payload = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
    const ctBytes = Buffer.from(payload.ct, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff; // flip a byte
    payload.ct = ctBytes.toString("base64");
    const tampered = Buffer.from(JSON.stringify(payload)).toString("base64");

    await expect(svc.decrypt(tampered, keyId)).rejects.toThrow();
  });

  it("a row's keyId keeps routing to the provider that wrote it, independent of current config", async () => {
    // Encrypt while "local" is the configured provider...
    const svc = makeEncryptionService({ ENCRYPTION_KEY_PROVIDER: "local" });
    const { ciphertext, keyId } = await svc.encrypt("signed note text");

    // ...then decrypt with a DIFFERENT EncryptionService instance whose
    // CURRENT config says "customer" — should still route to Local because
    // the keyId itself says "local:v1", proving rotation doesn't strand
    // already-encrypted rows.
    const laterSvc = makeEncryptionService({ ENCRYPTION_KEY_PROVIDER: "customer" });
    await expect(laterSvc.decrypt(ciphertext, keyId)).resolves.toBe("signed note text");
  });
});

describe("CustomerKeyProviderService", () => {
  it("throws CustomerKmsNotConfiguredError when no tenant encryption config exists", async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ config_json: {} }] }) } as unknown as Pool;
    const provider = new CustomerKeyProviderService(pool);
    await expect(provider.wrapKey(Buffer.alloc(32))).rejects.toThrow(CustomerKmsNotConfiguredError);
  });

  it("throws CustomerKmsNotConfiguredError even when a key reference IS configured (no real KMS SDK wired)", async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{ config_json: { encryption: { provider: "aws-kms", key_ref: "arn:aws:kms:eu-west-1:123:key/abc" } } }],
      }),
    } as unknown as Pool;
    const provider = new CustomerKeyProviderService(pool);
    // Honest failure, never a silently-successful fake wrap.
    await expect(provider.wrapKey(Buffer.alloc(32))).rejects.toThrow(CustomerKmsNotConfiguredError);
  });

  it("selecting the customer provider end-to-end via EncryptionService fails cleanly, not silently to local", async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ config_json: {} }] }) } as unknown as Pool;
    const svc = makeEncryptionService({ ENCRYPTION_KEY_PROVIDER: "customer" }, pool);
    await expect(svc.encrypt("some signed text")).rejects.toThrow(CustomerKmsNotConfiguredError);
  });
});
