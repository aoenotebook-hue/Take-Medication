import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  root: "apps/web",
  envDir: process.cwd(),
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        maximumFileSizeToCacheInBytes: 6000000,
        globPatterns: ["**/*.{js,css,html,png,svg,woff,woff2,ttf,webmanifest}"],
      },
      manifest: {
        name: "Medication Companion · เพื่อนเรื่องยา",
        short_name: "เพื่อนเรื่องยา",
        lang: "th",
        start_url: "/",
        display: "standalone",
        background_color: "#f5f7f4",
        theme_color: "#155e52",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  preview: { proxy: { "/api": "http://localhost:3001" } },
  server: { proxy: { "/api": "http://localhost:3001" } },
  build: { outDir: "../../dist", emptyOutDir: true },
});
