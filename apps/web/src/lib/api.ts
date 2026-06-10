const API_BASE = import.meta.env["VITE_API_BASE_URL"] ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, code, message);
  }

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export const api = {
  auth: {
    login: (returnTo?: string) =>
      request<{ auth_url: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ return_to: returnTo ?? "/" }),
      }),

    logout: () =>
      request<{ logout_url: string }>("/api/v1/auth/logout", {
        method: "POST",
      }),

    me: () =>
      request<{
        id: string;
        displayName: string;
        email: string | null;
        preferredLanguage: "ar" | "en";
        roles: string[];
      }>("/api/v1/auth/me"),

    refresh: () =>
      request<void>("/api/v1/auth/refresh", { method: "POST" }),
  },
};
