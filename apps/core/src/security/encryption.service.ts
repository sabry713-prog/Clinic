/**
 * EncryptionService — envelope encryption for sensitive text columns.
 * Per call: a fresh random 256-bit data-encryption-key (DEK) encrypts the
 * plaintext (AES-256-GCM); the DEK itself is "wrapped" by the configured
 * KeyProvider (ENCRYPTION_KEY_PROVIDER=local|customer). The resulting keyId
 * is stored alongside the ciphertext by the caller, so each record stays
 * decryptable under its OWN recorded key even after the tenant's "current"
 * key reference changes later — standard envelope-encryption rotation
 * semantics; rotating does not require bulk re-encryption of old rows.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { KeyProvider } from "./key-provider";
import { LocalKeyProviderService } from "./local-key-provider.service";
import { CustomerKeyProviderService } from "./customer-key-provider.service";

export interface EncryptedPayload {
  readonly ciphertext: string; // base64
  readonly keyId: string;
}

@Injectable()
export class EncryptionService {
  constructor(
    private readonly config: ConfigService,
    private readonly localProvider: LocalKeyProviderService,
    private readonly customerProvider: CustomerKeyProviderService,
  ) {}

  // Which provider ENCRYPTS new data — the tenant's currently-configured choice.
  private currentProvider(): KeyProvider {
    return this.config.get<string>("ENCRYPTION_KEY_PROVIDER") === "customer"
      ? this.customerProvider
      : this.localProvider;
  }

  // Which provider can DECRYPT a given record — routed by the keyId's own
  // namespace prefix, NOT by the tenant's current config. This is what makes
  // key rotation safe: a row encrypted under "local:v1" stays decryptable
  // even after the tenant switches ENCRYPTION_KEY_PROVIDER to "customer".
  private providerFor(keyId: string): KeyProvider {
    if (keyId.startsWith("customer:")) return this.customerProvider;
    if (keyId.startsWith("local:")) return this.localProvider;
    throw new Error(`Unrecognized key id "${keyId}" — no provider can unwrap it`);
  }

  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const { wrappedDek, keyId } = await this.currentProvider().wrapKey(dek);

    const payload = {
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ct: ct.toString("base64"),
      wrappedDek: wrappedDek.toString("base64"),
    };
    return { ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"), keyId };
  }

  async decrypt(ciphertext: string, keyId: string): Promise<string> {
    const payload = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")) as {
      iv: string;
      authTag: string;
      ct: string;
      wrappedDek: string;
    };
    const dek = await this.providerFor(keyId).unwrapKey(Buffer.from(payload.wrappedDek, "base64"), keyId);
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(payload.ct, "base64")), decipher.final()]);
    return pt.toString("utf8");
  }
}
