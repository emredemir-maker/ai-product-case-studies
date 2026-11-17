import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // During `npm run dev`, API calls go to the running `cmo ui` server.
  server: { proxy: { "/api": { target: "http://127.0.0.1:4321", changeOrigin: true } } },
})
