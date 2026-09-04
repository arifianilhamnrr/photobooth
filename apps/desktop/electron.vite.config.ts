import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const aliases = {
  "@photobooth/domain": resolve(__dirname, "../../packages/domain/src"),
  "@photobooth/storage": resolve(__dirname, "../../packages/storage/src"),
  "@photobooth/compositor": resolve(__dirname, "../../packages/compositor/src"),
  "@photobooth/camera": resolve(__dirname, "../../packages/camera/src"),
  "@photobooth/drive": resolve(__dirname, "../../packages/drive/src")
};

export default defineConfig({
  main: {
    build: {
      outDir: "dist/main",
      rollupOptions: {
        external: [
          "sharp",
          /^@img\//
        ]
      }
    },
    resolve: {
      alias: aliases
    }
  },
  preload: {
    build: {
      outDir: "dist/preload"
    },
    resolve: {
      alias: aliases
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
        ...aliases
      }
    },
    plugins: [react()],
    publicDir: false
  }
});
