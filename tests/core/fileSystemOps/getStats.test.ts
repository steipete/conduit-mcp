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
import { getStats } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import type { Stats } from 'fs';

// mockFs is already imported and used in vi.mock, tests will use it directly.

describe('getStats', () => {
  const mockStatObjectDefinition = { 
    isFile: () => true, 
    isDirectory: () => false, 
    isSymbolicLink: () => false, 
    size: 123, 
    mode: 0o644, 
    mtime: new Date('2023-01-01T12:00:00.000Z'), 
    birthtime: new Date('2023-01-01T11:00:00.000Z'),
    // Adding all Stats properties for completeness, even if not strictly used by SUT
    dev: 1, ino: 1, nlink: 1, uid: 1, gid: 1, rdev: 1, blksize: 4096, blocks: 1,
    atimeMs: new Date('2023-01-01T12:00:00.000Z').getTime(),
    mtimeMs: new Date('2023-01-01T12:00:00.000Z').getTime(),
    ctimeMs: new Date('2023-01-01T12:00:00.000Z').getTime(),
    birthtimeMs: new Date('2023-01-01T11:00:00.000Z').getTime(),
    atime: new Date('2023-01-01T12:00:00.000Z'),
    ctime: new Date('2023-01-01T12:00:00.000Z'),
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Stats;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockImplementation(async () => ({ ...mockStatObjectDefinition }));
  });

  it('should return stats object on success', async () => {
    const stats = await getStats('valid/path');
    expect(stats).toEqual(mockStatObjectDefinition);
    expect(mockFs.stat).toHaveBeenCalledWith('valid/path');
  });

  it('should throw ConduitError.ERR_FS_NOT_FOUND if fs.stat throws ENOENT', async () => {
    mockFs.stat.mockImplementation(async () => {
      const error = new Error('Path not found');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    await expect(getStats('notfound/path')).rejects.toThrow(ConduitError);
    try {
      await getStats('notfound/path');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      expect(err.message).toContain('Path not found: notfound/path');
    }
  });

  it('should throw ConduitError.OPERATION_FAILED for other fs.stat errors (that are not ConduitError already)', async () => {
    mockFs.stat.mockImplementation(async () => {
      const error = new Error('Permission denied');
      // @ts-expect-error code is readonly
      error.code = 'EACCES';
      throw error;
    });
    await expect(getStats('protected/path')).rejects.toThrow(ConduitError);
    try {
      await getStats('protected/path');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.OPERATION_FAILED);
      expect(err.message).toContain(
        'Failed to get stats for path: protected/path. Error: Permission denied'
      );
    }
  });

  it('should re-throw ConduitError if fs.stat throws a ConduitError', async () => {
    const specificConduitError = new ConduitError(ErrorCode.ERR_FS_ACCESS_DENIED, 'Custom stat error');
    mockFs.stat.mockImplementation(async () => {
      throw specificConduitError;
    });
    await expect(getStats('any/path')).rejects.toThrow(specificConduitError);
  });
});