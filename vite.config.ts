import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function metaImagesPlugin(): Plugin {
  return {
    name: "vite-plugin-meta-images",
    transformIndexHtml(html) {
      const baseUrl = getDeploymentUrl();
      if (!baseUrl) {
        log("[meta-images] no Replit deployment domain found, skipping meta tag updates");
        return html;
      }

      const publicDir = path.resolve(process.cwd(), "client", "public");
      const imageExt = [
        ["png", path.join(publicDir, "opengraph.png")],
        ["jpg", path.join(publicDir, "opengraph.jpg")],
        ["jpeg", path.join(publicDir, "opengraph.jpeg")],
      ].find(([, imagePath]) => fs.existsSync(imagePath))?.[0] || null;

      if (!imageExt) {
        log("[meta-images] OpenGraph image not found, skipping meta tag updates");
        return html;
      }

      const imageUrl = `${baseUrl}/opengraph.${imageExt}`;
      log("[meta-images] updating meta image tags to:", imageUrl);

      return html
        .replace(
          /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/g,
          `<meta property="og:image" content="${imageUrl}" />`,
        )
        .replace(
          /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/g,
          `<meta name="twitter:image" content="${imageUrl}" />`,
        );
    },
  };
}

function getDeploymentUrl(): string | null {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    const url = `https://${process.env.REPLIT_INTERNAL_APP_DOMAIN}`;
    log("[meta-images] using internal app domain:", url);
    return url;
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    const url = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    log("[meta-images] using dev domain:", url);
    return url;
  }

  return null;
}

function log(...args: unknown[]): void {
  if (process.env.NODE_ENV === "production") {
    console.log(...args);
  }
}

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // The Clipper newsroom is intentionally a single lazy route. Its current
    // compressed payload is ~106 kB; use the uncompressed route budget here so
    // production builds stay signal-clean until it exceeds the agreed limit.
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
