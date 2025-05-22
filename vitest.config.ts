import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true, // Use Vitest globals (describe, it, expect, etc.) without importing
    environment: 'node', // Or 'jsdom' if testing frontend components
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      all: true, // Include all files in coverage, not just tested ones
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**/*.ts',
        'src/server.ts', // Typically E2E tested, or requires complex mocking for unit tests
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    setupFiles: ['./tests/setupTests.ts'], // Similar to Jest's setupFilesAfterEnv
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
