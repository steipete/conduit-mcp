import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers';
import type { Stats } from 'fs';

// Mock fs/promises AT THE TOP of the test file
vi.mock('fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));

// Mock @/internal AT THE TOP of the test file
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  return {
    ...original,
    conduitConfig: mockConduitConfig,
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
import { createDirectory } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { logger } from '@/internal'; // To verify logger calls

describe('createDirectory', () => {
  const dirPath = '/new/directory';

  beforeEach(() => {
    vi.clearAllMocks(); // Clears all mocks, including logger calls

    // Reset specific fs mock implementations for createDirectory tests
    // Default is success for access (path doesn't exist, so create can proceed)
    // and mkdir. Stat is not directly called by createDirectory's happy path
    // but might be by internal pathExists or if path exists.
    mockFs.access.mockImplementation(async (pathToCheck) => {
      // Simulate ENOENT (path does not exist)
      const error = new Error(
        `ENOENT: no such file or directory, access '${pathToCheck as string}'`
      );
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    mockFs.mkdir.mockImplementation(async () => undefined); // Default success
    mockFs.stat.mockImplementation(async (pathToStat) => {
      // Default stat mock: if needed, specific tests will override
      // This could simulate a file or directory if a test needs pathExists to return true then checks type
      const error = new Error(`ENOENT: no such file or directory, stat '${pathToStat as string}'`);
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
  });

  it('should create directory non-recursively by default', async () => {
    // mockFs.access is already set to reject (ENOENT) in beforeEach
    // mockFs.mkdir is already set to resolve in beforeEach
    await createDirectory(dirPath);
    expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: false });
  });

  it('should create directory recursively if specified', async () => {
    // mockFs.access is already set to reject (ENOENT) in beforeEach
    // mockFs.mkdir is already set to resolve in beforeEach
    await createDirectory(dirPath, true);
    expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
  });

  it('should be idempotent and log debug if directory already exists', async () => {
    // Mock pathExists to return true and getStats to show it's a directory
    mockFs.access.mockImplementation(async () => undefined); // pathExists will return true
    mockFs.stat.mockImplementation(
      async () =>
        ({
          isDirectory: () => true,
          isFile: () => false,
        }) as Stats
    );

    await expect(createDirectory(dirPath)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      `Directory already exists (idempotent success): ${dirPath}`
    );
    expect(mockFs.mkdir).not.toHaveBeenCalled();
  });

  it('should throw ERR_FS_PATH_IS_FILE when path exists but is a file', async () => {
    // Mock pathExists to return true and getStats to show it's a file
    mockFs.access.mockImplementation(async () => undefined); // pathExists will return true
    mockFs.stat.mockImplementation(
      async () =>
        ({
          isDirectory: () => false,
          isFile: () => true,
        }) as Stats
    );

    await expect(createDirectory(dirPath)).rejects.toThrow(ConduitError);
    try {
      await createDirectory(dirPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
      expect(err.message).toContain(
        `Path ${dirPath} is a file, expected a directory or non-existent path for mkdir.`
      );
    }
  });

  it('should throw ERR_FS_DIR_CREATE_FAILED for other fs.mkdir errors', async () => {
    // mockFs.access is already set to reject (ENOENT) in beforeEach
    const mkdirError = new Error('Permission denied');
    // @ts-expect-error code is readonly
    mkdirError.code = 'EACCES';
    mockFs.mkdir.mockImplementation(async () => {
      throw mkdirError;
    });

    await expect(createDirectory(dirPath)).rejects.toThrow(ConduitError);
    try {
      await createDirectory(dirPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DIR_CREATE_FAILED);
      expect(err.message).toContain(
        `Failed to create directory: ${dirPath}. Error: Permission denied`
      );
    }
  });
});
