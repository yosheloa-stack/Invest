import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  esbuild: { jsx: "automatic" },
  build: { outDir: "../public", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
