import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/login": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/logout": "http://127.0.0.1:3000",
      "/items": "http://127.0.0.1:3000"
    }
  }
});
