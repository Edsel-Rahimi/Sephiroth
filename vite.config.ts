import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        'next/server': path.resolve(import.meta.dirname, './src/lib/shims/next-server.ts'),
        'next/image': path.resolve(import.meta.dirname, './src/lib/shims/next-image.tsx'),
        'next/navigation': path.resolve(import.meta.dirname, './src/lib/shims/next-navigation.ts'),
      },
    },
    optimizeDeps: {
      // Only scan real app entries — never the sandbox skills/examples folders.
      entries: ['index.html', 'src/**/*.tsx', 'src/**/*.ts'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // The panel is always reached through proxies (sandbox preview, nginx,
      // CDN tunnels) whose hostnames change — allow every Host header.
      // (Vite 6+ otherwise blocks unknown hosts with "Blocked request".)
      allowedHosts: true,
    },
  };
});
