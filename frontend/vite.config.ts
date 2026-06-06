import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendUrl = process.env.XUANJIBAO_BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backendUrl,
      "/health": backendUrl,
    },
  },
});
