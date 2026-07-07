import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // forwards calls from the browser to the local Express proxy,
      // so the frontend never needs your API key or to fight CORS.
      "/api": "http://localhost:8787"
    }
  }
});
