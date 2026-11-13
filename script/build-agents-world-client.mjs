// Alternative client-only build: no project config, env loading, server or pip.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

await build({
  configFile: false,
  envFile: false,
  envDir: false,
  root: path.resolve('client'),
  plugins: [react(), tailwindcss()],
  css: { postcss: { plugins: [] } },
  resolve: { alias: { '@': path.resolve('client/src'), '@shared': path.resolve('shared'), '@assets': path.resolve('attached_assets') } },
  build: { outDir: path.resolve('.local/agents-world-client-build'), emptyOutDir: true },
});
