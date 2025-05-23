import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers';
import type { Stats } from 'fs';
import path from 'path';

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
import { copyPath } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { conduitConfig, logger } from '@/internal'; // For test logic (conduitConfig) and logger verification

describe('copyPath', () => {
  const sourceFile = '/src/file.txt';
  const sourceDir = '/src/dir';
  const destFile = '/dest/newfile.txt';
  const destDir = '/dest/newdir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for fs.stat and fs.cp for copyPath tests
    // Individual tests can override these as needed.
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      // Default: assume path does not exist or is a file, specifics set by tests
      const error = new Error(`ENOENT: no such file or directory, stat '${p.toString()}'`);
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    mockFs.cp.mockImplementation(async () => undefined); // Default success for cp
  });

  it('should copy a file to a new file path', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceFile)
        return { isDirectory: () => false, isFile: () => true } as Stats;
      if (p.toString() === destFile) {
        const error = new Error('ENOENT');
        // @ts-expect-error code is readonly
        error.code = 'ENOENT';
        throw error;
      }
      return { isDirectory: () => false, isFile: () => false } as Stats; // default for others
    });

    await copyPath(sourceFile, destFile);
    expect(mockFs.stat).toHaveBeenCalledWith(sourceFile);
    expect(mockFs.stat).toHaveBeenCalledWith(destFile);
    expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, destFile, {
      recursive: false,
      force: true,
    });
  });

  it('should copy a file into an existing directory', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceFile)
        return { isDirectory: () => false, isFile: () => true } as Stats;
      if (p.toString() === destDir)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      return { isDirectory: () => false, isFile: () => false } as Stats;
    });
    const expectedDestPath = path.join(destDir, path.basename(sourceFile));

    await copyPath(sourceFile, destDir);
    expect(mockFs.stat).toHaveBeenCalledWith(sourceFile);
    expect(mockFs.stat).toHaveBeenCalledWith(destDir);
    expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, expectedDestPath, {
      recursive: false,
      force: true,
    });
  });

  it('should copy a directory to a new directory path', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDir)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      // For copying a directory, the destination path itself (destDir) might not be stat'd if it doesn't exist,
      // fs.cp handles this. If it does exist and is a file, fs.cp would error (not tested here, assume new path).
      const error = new Error('ENOENT');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });

    await copyPath(sourceDir, destDir);
    expect(mockFs.stat).toHaveBeenCalledWith(sourceDir);
    expect(mockFs.cp).toHaveBeenCalledWith(sourceDir, destDir, { recursive: true, force: true });
  });

  it('should throw ERR_FS_NOT_FOUND if source path does not exist', async () => {
    const nonExistentSource = '/test/non_existent_source.txt';
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === nonExistentSource) {
        const error = new Error('ENOENT');
        // @ts-expect-error code is readonly
        error.code = 'ENOENT';
        throw error;
      }
      // Mock for destFile existing or not, doesn't matter as source fails first
      return { isDirectory: () => false, isFile: () => true } as Stats;
    });

    await expect(copyPath(nonExistentSource, destFile)).rejects.toThrow(ConduitError);
    try {
      await copyPath(nonExistentSource, destFile);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      expect(err.message).toContain(`Path not found: ${nonExistentSource}`);
    }
  });

  it('should throw ERR_FS_COPY_FAILED if fs.cp fails', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats); // Source stat succeeds
    const cpError = new Error('Copy failed due to disk space');
    mockFs.cp.mockRejectedValue(cpError);

    await expect(copyPath(sourceFile, destFile)).rejects.toThrow(ConduitError);
    try {
      await copyPath(sourceFile, destFile);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_COPY_FAILED);
      expect(err.message).toContain(
        `Failed to copy: ${sourceFile} to ${destFile}. Error: Copy failed due to disk space`
      );
    }
  });

  it('should copy a file to a file, overwriting destination', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      const pathStr = p.toString();
      if (pathStr === sourceFile)
        return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
      if (pathStr === destFile)
        return { isDirectory: () => false, isFile: () => true, size: 200 } as Stats; // Dest exists
      const error = new Error('ENOENT');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    await copyPath(sourceFile, destFile);
    expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, destFile, {
      recursive: false,
      force: true, // force: true implies overwrite
    });
  });

  it('should copy a directory into an existing directory (destination is a dir)', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      const pathStr = p.toString();
      if (pathStr === sourceDir)
        return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
      if (pathStr === destDir)
        return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
      const error = new Error('ENOENT');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    // fs.cp handles copying sourceDir *into* destDir when destDir exists and is a directory.
    // The destination path for fs.cp remains destDir.
    await copyPath(sourceDir, destDir);
    expect(mockFs.cp).toHaveBeenCalledWith(sourceDir, destDir, {
      recursive: true,
      force: true,
    });
  });

  // Test case for when destination is a file and source is a directory
  it('should throw ERR_FS_COPY_FAILED when source is directory and destination is an existing file', async () => {
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDir)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      if (p.toString() === destFile)
        return { isDirectory: () => false, isFile: () => true } as Stats; // Dest is a file
      const error = new Error('ENOENT');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });

    // fs.cp with recursive:true to a file path will/should fail. The SUT should catch this.
    const cpError = new Error('EISDIR: illegal operation on a directory, copy');
    // @ts-expect-error code is readonly
    cpError.code = 'EISDIR'; // Or similar error node throws for this case
    mockFs.cp.mockRejectedValue(cpError);

    await expect(copyPath(sourceDir, destFile)).rejects.toThrow(ConduitError);
    try {
      await copyPath(sourceDir, destFile);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_COPY_FAILED);
      expect(err.message).toContain(`Failed to copy: ${sourceDir} to ${destFile}.`);
    }
  });
});
