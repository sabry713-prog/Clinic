/**
 * Auth modes for the FHIR client.
 * - none: no Authorization header (for open sandboxes / dev)
 * - oauth2: client-credentials grant; token refreshed automatically
 */

export type AuthMode = "none" | "oauth2";

export interface OAuth2Config {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
}

export interface AuthConfig {
  readonly mode: AuthMode;
  readonly oauth2?: OAuth2Config;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class OAuth2TokenProvider {
  private accessToken: string | null = null;
  private expiresAt: number = 0;

  constructor(private readonly config: OAuth2Config) {}

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 30_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope ?? "system/*.read",
    });

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `OAuth2 token request failed: ${res.status} ${text}`,
      );
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }
}
