import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { existsSync } from "fs";

const localConfig = "./wrangler.local.jsonc";
const configPath = existsSync(localConfig) ? localConfig : "./wrangler.jsonc";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), cloudflare({ configPath })],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: isSsrBuild
    ? undefined
    : {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes("node_modules")) return;
              if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) return "react";
              if (/[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/.test(id)) return "query";
              if (/[\\/]node_modules[\\/](marked|dompurify)[\\/]/.test(id)) return "markdown";
            },
          },
        },
      },
  server: {
    host: "0.0.0.0",
    port: Number((process as any).env?.PORT) || 5173,
    allowedHosts: true,
  },
}));
