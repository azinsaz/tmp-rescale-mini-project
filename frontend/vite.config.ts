/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/setup.ts'],
    globals: false,
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: [
        'src/features/jobs/jobs.hooks.ts',
        'src/features/jobs/CreateJobForm.tsx',
        'src/components/StatusPill.tsx',
        'src/lib/**',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.types.ts'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      reporter: ['text', 'html'],
    },
  },
});
