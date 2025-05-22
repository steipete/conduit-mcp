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
import { getLstats } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import type { Stats } from 'fs';

// mockFs is already imported and used in vi.mock, tests will use it directly.

describe('getLstats', () => {
  const mockLstatObjectDefinition = { 
    isFile: () => false, 
    isDirectory: () => false, 
    isSymbolicLink: () => true, // Key difference for lstat
    size: 456, 
    mode: 0o777, // Different mode for symlink example
    mtime: new Date('2023-02-02T10:00:00.000Z'), 
    birthtime: new Date('2023-02-02T09:00:00.000Z'),
    // Adding all Stats properties for completeness
    dev: 1, ino: 1, nlink: 1, uid: 1, gid: 1, rdev: 1, blksize: 4096, blocks: 1,
    atimeMs: new Date('2023-02-02T10:00:00.000Z').getTime(),
    mtimeMs: new Date('2023-02-02T10:00:00.000Z').getTime(),
    ctimeMs: new Date('2023-02-02T10:00:00.000Z').getTime(),
    birthtimeMs: new Date('2023-02-02T09:00:00.000Z').getTime(),
    atime: new Date('2023-02-02T10:00:00.000Z'),
    ctime: new Date('2023-02-02T10:00:00.000Z'),
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Stats;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.lstat.mockImplementation(async () => ({ ...mockLstatObjectDefinition }));
  });

  it('should return lstat object on success', async () => {
    const stats = await getLstats('symlink/path');
    expect(stats).toEqual(mockLstatObjectDefinition);
    expect(mockFs.lstat).toHaveBeenCalledWith('symlink/path');
  });

  it('should throw ConduitError.ERR_FS_NOT_FOUND if fs.lstat throws ENOENT', async () => {
    mockFs.lstat.mockImplementation(async () => {
      const error = new Error('Path not found');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    await expect(getLstats('notfoundlink/path')).rejects.toThrow(ConduitError);
    try {
      await getLstats('notfoundlink/path');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      expect(err.message).toContain('Path not found: notfoundlink/path');
    }
  });

  it('should throw ConduitError.OPERATION_FAILED for other fs.lstat errors (that are not ConduitError already)', async () => {
    mockFs.lstat.mockImplementation(async () => {
      const error = new Error('Permission denied for lstat');
      // @ts-expect-error code is readonly
      error.code = 'EACCES';
      throw error;
    });
    await expect(getLstats('protectedlink/path')).rejects.toThrow(ConduitError);
    try {
      await getLstats('protectedlink/path');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.OPERATION_FAILED);
      expect(err.message).toContain(
        'Failed to get lstats for path: protectedlink/path. Error: Permission denied for lstat'
      );
    }
  });

  it('should re-throw ConduitError if fs.lstat throws a ConduitError', async () => {
    const specificConduitError = new ConduitError(ErrorCode.ERR_FS_ACCESS_DENIED, 'Custom lstat error');
    mockFs.lstat.mockImplementation(async () => {
      throw specificConduitError;
    });
    // The SUT getLstats should catch this, see it's a ConduitError, and re-throw it as is.
    await expect(getLstats('any/symlink')).rejects.toThrow(specificConduitError);
  });
});