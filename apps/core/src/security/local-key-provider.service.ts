/**
 * LocalKeyProviderService — dev-default KeyProvider. Does REAL AES-256-GCM
 * keywrap (not a no-op stub) using a platform-controlled master key from
 * ENCRYPTION_MASTER_KEY — genuinely protects data at the application layer,
 * it just isn't hospital-controlled (see CustomerKeyProviderService for
 * that).
 *
 * M03 (readiness assessment): the known development master-key fallback
 * is now production-gated. Outside explicit development/test mode, a
 * missing key OR the known dev-default key is rejected — encryption
 * must never silently degrade to a guessable key in a deployed build.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { KeyProvider, WrappedKey } from "./key-provider";

const DEV_DEFAULT_MASTER_KEY = "de".repeat(32); // 64 hex chars (0xdede...) — dev only
const KEY_ID = "local:v1";

@Injectable()
export class LocalKeyProviderService implements KeyProvider {
  readonly name = "local";

  constructor(private readonly config: ConfigService) {}

  private masterKey(): Buffer {
    const hex = this.config.get<string>("ENCRYPTION_MASTER_KEY");

    // M03: outside development/test, reject both a missing key and the
    // known dev-default. Encryption must never silently degrade.
    const env = this.config.get<string>("NODE_ENV") ?? "development";
    const isTest = this.config.get<string>("ALLOW_DEV_KEYS") === "true";
    if (env !== "development" && !isTest) {
      if (!hex || hex === DEV_DEFAULT_MASTER_KEY) {
        throw new Error(
          "ENCRYPTION_MASTER_KEY is missing or is the known development default. " +
          "Set a real 32-byte key (64 hex chars) before running outside development.",
        );
      }
    }

    const resolved = hex ?? DEV_DEFAULT_MASTER_KEY;
    const key = Buffer.from(resolved, "hex");
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
