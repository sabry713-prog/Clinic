/**
 * LocalKeyProviderService — dev-default KeyProvider. Does REAL AES-256-GCM
 * keywrap (not a no-op stub) using a platform-controlled master key from
 * ENCRYPTION_MASTER_KEY — genuinely protects data at the application layer,
 * it just isn't hospital-controlled (see CustomerKeyProviderService for
 * that). Same secret-handling class as SESSION_SECRET/OIDC_CLIENT_SECRET
 * already in this project's .env: a fixed dev-only default, expected to be
 * replaced by a real per-environment secret outside dev (docs/architecture/05-security.md
 * "Master keys never exposed to application code" — this dev provider is
 * the one deliberate exception, clearly named as such).
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { KeyProvider, WrappedKey } from "./key-provider";

const DEV_DEFAULT_MASTER_KEY = "de".repeat(32); // 64 hex chars (0xdede...) — dev only, never used outside local
const KEY_ID = "local:v1";

@Injectable()
export class LocalKeyProviderService implements KeyProvider {
  readonly name = "local";

  constructor(private readonly config: ConfigService) {}

  private masterKey(): Buffer {
    const hex = this.config.get<string>("ENCRYPTION_MASTER_KEY") ?? DEV_DEFAULT_MASTER_KEY;
    const key = Buffer.from(hex, "hex");
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)");
    }
    return key;
  }

  async wrapKey(dek: Buffer): Promise<WrappedKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey(), iv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { wrappedDek: Buffer.concat([iv, authTag, ct]), keyId: KEY_ID };
  }

  async unwrapKey(wrappedDek: Buffer, keyId: string): Promise<Buffer> {
    if (keyId !== KEY_ID) {
      throw new Error(`LocalKeyProviderService cannot unwrap key id "${keyId}" (expected "${KEY_ID}")`);
    }
    const iv = wrappedDek.subarray(0, 12);
    const authTag = wrappedDek.subarray(12, 28);
    const ct = wrappedDek.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
