import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Focus on e2e directory
    include: ['e2e/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      // Exclude regular unit tests
      'src/**',
      'tests/**'
    ],
    
    // Test environment
    environment: 'node',
    
    // Timeout settings for E2E tests (longer than unit tests)
    testTimeout: 30000, // 30 seconds per test
    hookTimeout: 10000, // 10 seconds for setup/teardown
    
    // Run tests serially to avoid conflicts with server processes
    threads: false,
    maxConcurrency: 1,
    
    // Retry failed tests once (network/timing issues)
    retry: 1,
    
    // Global setup and teardown
    globalSetup: [],
    globalTeardown: [],
    
    // Reporter configuration
    reporter: ['verbose'],
    
    // Coverage configuration (optional for E2E)
    coverage: {
      enabled: false, // E2E tests typically don't need coverage
    },
    
    // Setup files
    setupFiles: [],
    
    // Test name pattern
    testNamePattern: undefined,
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@e2e': path.resolve(__dirname, './e2e'),
    }
  },
  
  // Define for TypeScript
  define: {
    'process.env.NODE_ENV': '"test"',
  },
});