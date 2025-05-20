// This file can be used for global test setup.
// Vitest specific setup can go here (e.g. extending expect).

import { TextEncoder, TextDecoder } from 'util';
import { vi, afterEach } from 'vitest';

// Polyfills for TextEncoder/TextDecoder if not globally available in test env.
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  // @ts-ignore
  global.TextDecoder = TextDecoder;
}

// Example of extending Vitest's expect (if needed later)
// import { expect } from 'vitest';
// expect.extend({ /* custom matchers */ });

// Global hook to reset all mocks after each test
// This complements vi.clearAllMocks() which clears call history but might not reset all mock states/implementations
// depending on how they are set up. vi.resetAllMocks() is more thorough.
afterEach(() => {
  vi.resetAllMocks();
});

// Add a global mock for the project-internal logger so that test suites that
// don't provide their own factory still receive a usable mock implementation
// that includes a **default** export (required when the module is imported
// using `import logger from '@/utils/logger'`).
vi.mock('@/utils/logger', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };

  // Return the mock both as named exports *and* as the default export.
  return {
    ...mockLogger,
    default: mockLogger,
  };
});

// If you were previously mocking logger globally for Jest:
// vi.mock('@/utils/logger', () => ({
//   trace: vi.fn(),
//   debug: vi.fn(),
//   info: vi.fn(),
//   warn: vi.fn(),
//   error: vi.fn(),
//   fatal: vi.fn(),
// }));
// However, it's often better to mock on a per-test-suite basis if not all tests need it.

// -----------------------------------------------------------------------------
// Jest compatibility shim ------------------------------------------------------
// -----------------------------------------------------------------------------
// A handful of legacy test suites still use the `jest` global for mocking.
// To avoid a large-scale refactor we expose a thin alias that proxies the
// commonly used Jest APIs to their Vitest `vi` counterparts.
// NOTE: Only the APIs that are currently used in the codebase are mapped. If
// additional Jest helpers are required in the future they can be added here.
// -----------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – we deliberately attach to the global object
if (!(globalThis as any).jest) {
  (globalThis as any).jest = {
    mock: vi.mock,
    fn: vi.fn,
    spyOn: vi.spyOn,
    /* jest.resetAllMocks is emulated via vi.resetAllMocks */
    resetAllMocks: vi.resetAllMocks,
    clearAllMocks: vi.clearAllMocks,
    /* In Vitest timers are controlled via vi.useFakeTimers / vi.advanceTimersByTime */
    useFakeTimers: vi.useFakeTimers,
    advanceTimersByTime: vi.advanceTimersByTime,
  } as unknown;
} 