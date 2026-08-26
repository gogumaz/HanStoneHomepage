import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import {
  viteDevelopmentSecurityHeaders,
  webSecurityHeaders,
} from './src/security/web-security-headers.ts';

const projectRoot = import.meta.dirname;
const legacyScripts = [
  ['config.js', 'config.js'],
  ['board.js', 'board.js'],
] as const;

// These classic runtime scripts are marked `vite-ignore` in HTML and copied as-is.
// In particular, config.js must remain replaceable after the application bundle is built.

export default defineConfig({
  server: {
    headers: viteDevelopmentSecurityHeaders,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: webSecurityHeaders,
  },
  plugins: [
    react(),
    {
      name: 'react-account-history-fallback',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const path = request.url?.split('?', 1)[0] ?? '';
          if (['/account', '/guardian', '/lessons', '/subscriptions', '/dashboard', '/missions', '/notifications'].includes(path) || path.startsWith('/lessons/') || path.startsWith('/admin/')) request.url = '/app.html';
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          const path = request.url?.split('?', 1)[0] ?? '';
          if (['/account', '/guardian', '/lessons', '/subscriptions', '/dashboard', '/missions', '/notifications'].includes(path) || path.startsWith('/lessons/') || path.startsWith('/admin/')) request.url = '/app.html';
          next();
        });
      },
    },
    {
      name: 'copy-legacy-prototype-scripts',
      apply: 'build',
      async writeBundle() {
        await mkdir(resolve(projectRoot, 'dist/payment'), { recursive: true });
        await Promise.all(
          legacyScripts.map(([source, destination]) =>
            copyFile(resolve(projectRoot, source), resolve(projectRoot, 'dist', destination))
          )
        );
      }
    }
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        home: resolve(projectRoot, 'index.html'),
        lecture: resolve(projectRoot, 'lecture.html'),
        board: resolve(projectRoot, 'board.html'),
        reactApp: resolve(projectRoot, 'app.html'),
        paymentSuccess: resolve(projectRoot, 'payment/success.html'),
        paymentFail: resolve(projectRoot, 'payment/fail.html')
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}']
  }
});
