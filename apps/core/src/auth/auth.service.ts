import { Injectable, Logger, UnauthorizedException, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Issuer,
  generators,
  type Client,
  type IssuerMetadata,
} from "openid-client";
import { type Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { SessionService, type SessionData } from "./session.service";

interface OidcState {
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly createdAt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private oidcClient: Client | null = null;
  // PKCE state map: state → OidcState
  private readonly pendingStates = new Map<string, OidcState>();

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async getClient(): Promise<Client> {
    if (this.oidcClient) return this.oidcClient;

    const issuerUrl = this.config.getOrThrow<string>("OIDC_ISSUER_URL");
    let issuer: Issuer<Client>;
    try {
      issuer = await Issuer.discover(issuerUrl);
    } catch (err) {
      // Fallback for dev: construct minimal issuer if Keycloak not yet ready
      this.logger.warn(
        { event: "oidc_discover_failed", issuerUrl },
        "AuthService",
      );
      const metadata: IssuerMetadata = {
        issuer: issuerUrl,
        authorization_endpoint: `${issuerUrl}/protocol/openid-connect/auth`,
        token_endpoint: `${issuerUrl}/protocol/openid-connect/token`,
        userinfo_endpoint: `${issuerUrl}/protocol/openid-connect/userinfo`,
        end_session_endpoint: `${issuerUrl}/protocol/openid-connect/logout`,
        jwks_uri: `${issuerUrl}/protocol/openid-connect/certs`,
      };
      issuer = new Issuer(metadata);
      void err;
    }

    this.oidcClient = new issuer.Client({
      client_id: this.config.getOrThrow<string>("OIDC_CLIENT_ID"),
      client_secret: this.config.getOrThrow<string>("OIDC_CLIENT_SECRET"),
      redirect_uris: [this.config.getOrThrow<string>("OIDC_REDIRECT_URI")],
      response_types: ["code"],
    });

    return this.oidcClient;
  }

  async buildAuthUrl(returnTo: string): Promise<string> {
    const client = await this.getClient();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

    this.pendingStates.set(state, {
      codeVerifier,
      returnTo,
      createdAt: Date.now(),
    });

    // Clean up stale states (older than 10 minutes)
    for (const [k, v] of this.pendingStates.entries()) {
      if (Date.now() - v.createdAt > 600_000) this.pendingStates.delete(k);
    }

    return client.authorizationUrl({
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
  }

  async handleCallback(
    code: string,
    state: string,
    currentUrl: string,
  ): Promise<{ sessionId: string; returnTo: string }> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new UnauthorizedException("Invalid or expired OIDC state");
    }
    this.pendingStates.delete(state);

    const client = await this.getClient();
    const params = client.callbackParams(currentUrl);

    const tokenSet = await client.callback(
      this.config.getOrThrow<string>("OIDC_REDIRECT_URI"),
      params,
      {
        code_verifier: pending.codeVerifier,
        state,
      },
    );

    const claims = tokenSet.claims();
    const sub = claims["sub"];
    if (!sub) throw new UnauthorizedException("No sub claim in token");

    const roles = this.extractRoles(claims);

    // Resolve the DB-internal UUID from the OIDC external_subject claim
    const tenantId = "00000000-0000-0000-0000-000000000001";
    let dbUserId: string = sub;
    try {
      const result = await this.pool.query<{ id: string }>(
        `SELECT id FROM app."user" WHERE external_subject = $1 AND tenant_id = $2 LIMIT 1`,
        [sub, tenantId],
      );
      if (result.rows[0]?.id) {
        dbUserId = result.rows[0].id;
      } else {
        this.logger.warn(
          { event: "user_not_found_in_db", externalSubject: sub },
          "AuthService",
        );
      }
    } catch (err) {
      this.logger.error(
        { event: "user_lookup_failed", error: String(err) },
        "AuthService",
      );
    }

    const sessionData: SessionData = {
      userId: dbUserId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      externalSubject: sub,
      displayName:
        (claims["name"] as string | undefined) ??
        (claims["preferred_username"] as string | undefined) ??
        sub,
      email: (claims["email"] as string | undefined) ?? null,
      preferredLanguage: "ar",
      roles,
      accessToken: tokenSet.access_token ?? "",
      refreshToken: tokenSet.refresh_token ?? null,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
    };

    const sessionId = this.sessions.create(sessionData);

    return { sessionId, returnTo: pending.returnTo };
  }

  async buildLogoutUrl(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);

    const client = await this.getClient();
    const issuerUrl = this.config.getOrThrow<string>("OIDC_ISSUER_URL");
    // Build end session URL
    const endSessionUrl =
      client.issuer.metadata["end_session_endpoint"] as string | undefined ??
      `${issuerUrl}/protocol/openid-connect/logout`;

    const postLogoutUri = `${this.config.get<string>("WEB_URL") ?? this.config.get<string>("VITE_API_BASE_URL") ?? "http://localhost:3000"}/`;

    if (session?.accessToken) {
      return `${endSessionUrl}?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}&id_token_hint=${encodeURIComponent(session.accessToken)}`;
    }
    return `${endSessionUrl}?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;
  }

  private extractRoles(claims: Record<string, unknown>): string[] {
    // Keycloak stores realm roles in realm_access.roles
    const realmAccess = claims["realm_access"] as
      | { roles?: string[] }
      | undefined;
    if (realmAccess?.roles) return realmAccess.roles;
    return [];
  }
}
