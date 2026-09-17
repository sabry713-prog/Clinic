import { ConfigService } from "@nestjs/config";
import { LocalKeyProviderService } from "./local-key-provider.service";

const DEV_DEFAULT = "de".repeat(32);
const REAL_KEY = "a".repeat(64);

function provider(env: Record<string, string | undefined>): LocalKeyProviderService {
  const config = {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
  return new LocalKeyProviderService(config);
}

describe("LocalKeyProviderService master-key gate (M03)", () => {
  it("uses the development default in development", async () => {
    const svc = provider({ NODE_ENV: "development" });
    const wrapped = await svc.wrapKey(Buffer.alloc(32, 7));
    expect(wrapped.keyId).toBe("local:v1");
    expect(await svc.unwrapKey(wrapped.wrappedDek, wrapped.keyId)).toEqual(Buffer.alloc(32, 7));
  });

  it("allows the development default when NODE_ENV is unset (local runs)", async () => {
    const svc = provider({});
    await expect(svc.wrapKey(Buffer.alloc(32, 1))).resolves.toBeDefined();
  });

  it("uses the development default in test", async () => {
    const svc = provider({ NODE_ENV: "test" });
    await expect(svc.wrapKey(Buffer.alloc(32, 2))).resolves.toBeDefined();
  });

  it("refuses a missing key outside development and test", async () => {
    const svc = provider({ NODE_ENV: "production" });
    await expect(svc.wrapKey(Buffer.alloc(32, 3))).rejects.toThrow(/ENCRYPTION_MASTER_KEY is missing/);
  });

  it("refuses the known development default outside development and test", async () => {
    const svc = provider({ NODE_ENV: "production", ENCRYPTION_MASTER_KEY: DEV_DEFAULT });
    await expect(svc.wrapKey(Buffer.alloc(32, 4))).rejects.toThrow(
      /known development default/,
    );
  });

  // The hole this closed: ALLOW_DEV_KEYS was honoured in any environment, so a
  // deployed build could unlock a key that is published in this source tree by
  // setting one flag.
  it("cannot be unlocked by ALLOW_DEV_KEYS in a deployed build", async () => {
    const svc = provider({
      NODE_ENV: "production",
      ALLOW_DEV_KEYS: "true",
      ENCRYPTION_MASTER_KEY: DEV_DEFAULT,
    });
    await expect(svc.wrapKey(Buffer.alloc(32, 5))).rejects.toThrow(/known development default/);
  });

  it("cannot be unlocked by ALLOW_DEV_KEYS with no key at all", async () => {
    const svc = provider({ NODE_ENV: "staging", ALLOW_DEV_KEYS: "true" });
    await expect(svc.wrapKey(Buffer.alloc(32, 6))).rejects.toThrow(/ENCRYPTION_MASTER_KEY is missing/);
  });

  it("accepts a real key outside development and wraps/unwraps with it", async () => {
    const svc = provider({ NODE_ENV: "production", ENCRYPTION_MASTER_KEY: REAL_KEY });
    const dek = Buffer.alloc(32, 9);
    const wrapped = await svc.wrapKey(dek);

    expect(await svc.unwrapKey(wrapped.wrappedDek, wrapped.keyId)).toEqual(dek);
    // and the dev default must NOT be able to unwrap it
    const dev = provider({ NODE_ENV: "development" });
    await expect(dev.unwrapKey(wrapped.wrappedDek, wrapped.keyId)).rejects.toThrow();
  });

  it("rejects a key of the wrong length", async () => {
    const svc = provider({ NODE_ENV: "development", ENCRYPTION_MASTER_KEY: "abcd" });
    await expect(svc.wrapKey(Buffer.alloc(32, 8))).rejects.toThrow(/32 bytes/);
  });
});
