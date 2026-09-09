import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Bind all interfaces: without this Vite listens on IPv6 `::1` only and
    // browsers that resolve `localhost` to 127.0.0.1 get connection-refused.
    host: true,
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
