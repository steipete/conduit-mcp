import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers'; // Import the raw mock objects

// Mock fs/promises AT THE TOP of the test file
vi.mock('fs/promises', () => ({
  ...mockFs, // Spread all functions from mockFs
  default: mockFs, // Ensure fs from 'fs/promises' in SUT gets these mocks
}));

// Mock @/internal AT THE TOP of the test file
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  return {
    ...original,
    conduitConfig: mockConduitConfig, // Use the imported mockConduitConfig
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    getMimeType: vi.fn().mockResolvedValue('application/octet-stream'),
    formatToISO8601UTC: vi.fn((date: Date) => date.toISOString()),
  };
});

// Now proceed with other imports
import { describe, it, expect, beforeEach } from 'vitest';
import { pathExists } from '@/core/fileSystemOps';
// mockFs is already imported above, no need to import again unless for type clarity in describe block
import { constants as fsConstants } from 'fs';

describe('pathExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default implementations for mocks used in this file
    mockFs.access.mockImplementation(async () => undefined); // Default success
  });

  it('should return true if fs.access succeeds', async () => {
    const result = await pathExists('any/path');
    expect(result).toBe(true);
    expect(mockFs.access).toHaveBeenCalledWith('any/path', fsConstants.F_OK);
  });

  it('should return false if fs.access throws an error', async () => {
    mockFs.access.mockImplementation(async () => {
      const error = new Error('ENOENT');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    const result = await pathExists('any/path');
    expect(result).toBe(false);
    expect(mockFs.access).toHaveBeenCalledWith('any/path', fsConstants.F_OK);
  });
});
