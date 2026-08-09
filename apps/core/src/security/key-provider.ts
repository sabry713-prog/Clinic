/**
 * KeyProvider — abstraction over WHO controls the key-encryption-key (KEK)
 * used to wrap per-record data-encryption-keys (DEKs). Two implementations:
 * LocalKeyProviderService (dev default, real crypto, platform-controlled key)
 * and CustomerKeyProviderService (reads the hospital's configured KMS
 * reference; throws honestly since no real KMS SDK is wired in this
 * environment — same "stub/live" pattern as NphiesConnectorService).
 */

export interface WrappedKey {
  readonly wrappedDek: Buffer;
  readonly keyId: string;
}

export interface KeyProvider {
  readonly name: string;
  wrapKey(dek: Buffer): Promise<WrappedKey>;
  unwrapKey(wrappedDek: Buffer, keyId: string): Promise<Buffer>;
}

export class CustomerKmsNotConfiguredError extends Error {
  constructor() {
    super(
      "Customer-managed KMS is not configured. Set app.tenant.config_json.encryption " +
        "(provider + key_ref) via PATCH /admin/config, and wire the corresponding cloud " +
        "KMS SDK — no real KMS credentials exist in this environment yet.",
    );
    this.name = "CustomerKmsNotConfiguredError";
  }
}
