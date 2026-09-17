import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // C07 (readiness assessment): loopback by default — the UI has no reason to
    // be reachable from other hosts. `localhost` covers both IPv4/IPv6 loopback,
    // which `127.0.0.1` alone would miss. Set WEB_HOST=0.0.0.0 for a tunnel demo.
    host: process.env["WEB_HOST"] ?? "localhost",
    // Allow Cloudflare quick-tunnel hostnames so the app is reachable for
    // remote testing during the build (synthetic data only).
    allowedHosts: [".trycloudflare.com", "localhost"],
    proxy: {
      "/api": {
        target: process.env["VITE_API_BASE_URL"] ?? "http://localhost:4000",
        changeOrigin: true,
      },
      // Route Keycloak (login) through the same origin so a single tunnel
      // serves UI + API + auth. changeOrigin:false preserves the public Host
      // header so Keycloak generates correct (tunnel) redirect URLs.
      "/realms": {
        target: process.env["OIDC_PROXY_TARGET"] ?? "http://localhost:8080",
        changeOrigin: false,
        headers: { "X-Forwarded-Proto": "https" },
      },
      "/resources": {
        target: process.env["OIDC_PROXY_TARGET"] ?? "http://localhost:8080",
        changeOrigin: false,
        headers: { "X-Forwarded-Proto": "https" },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
