/**
 * CustomerKeyProviderService — reads the hospital's own KMS reference from
 * app.tenant.config_json.encryption (set via the existing PATCH /admin/config,
 * admin.controller.ts:636-664 — no new admin endpoint needed) and throws
 * CustomerKmsNotConfiguredError, since no real cloud KMS SDK/credentials are
 * wired in this environment. Mirrors NphiesConnectorService's stub/live split
 * (NPHIES_CONNECTOR=live throws NPHIES_LIVE_NOT_CONFIGURED) — never fakes a
 * successful wrap/unwrap.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { CustomerKmsNotConfiguredError, type KeyProvider, type WrappedKey } from "./key-provider";

interface TenantEncryptionConfig {
  readonly provider?: string;
  readonly key_ref?: string;
}

@Injectable()
export class CustomerKeyProviderService implements KeyProvider {
  readonly name = "customer";

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async config(): Promise<TenantEncryptionConfig | null> {
    const res = await this.pool.query<{ config_json: { encryption?: TenantEncryptionConfig } }>(
      `SELECT config_json FROM app.tenant LIMIT 1`,
    );
    return res.rows[0]?.config_json.encryption ?? null;
  }

  async wrapKey(_dek: Buffer): Promise<WrappedKey> {
    const cfg = await this.config();
    if (!cfg?.provider || !cfg.key_ref) throw new CustomerKmsNotConfiguredError();
    // No real KMS SDK wired in this environment (see docs/architecture/on-prem-model.md
    // for the same class of documented deviation). Configuring a reference here
    // is the honest, functional half of this feature; the cloud call is not.
    throw new CustomerKmsNotConfiguredError();
  }

  async unwrapKey(_wrappedDek: Buffer, _keyId: string): Promise<Buffer> {
    const cfg = await this.config();
    if (!cfg?.provider || !cfg.key_ref) throw new CustomerKmsNotConfiguredError();
    throw new CustomerKmsNotConfiguredError();
  }
}
