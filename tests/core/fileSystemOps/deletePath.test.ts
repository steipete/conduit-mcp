import { vi } from 'vitest';
import { mockFs, mockConduitConfig, createDirent } from './helpers';
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
import { deletePath } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { logger } from '@/internal'; // To verify logger calls


describe('deletePath', () => {
  const filePath = '/path/to/file.txt';
  const dirPath = '/path/to/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default lstat mock: can be overridden by specific tests
    // For deletePath, lstat is crucial to determine if it's a file or dir
    mockFs.lstat.mockImplementation(async (p) => {
      // Default to path not found to ensure tests explicitly set up what they need
      const error = new Error(`ENOENT: no such file or directory, lstat '${p as string}'`);
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });

    mockFs.unlink.mockImplementation(async () => undefined); // Default success for unlink
    mockFs.rm.mockImplementation(async () => undefined); // Default success for rm
    mockFs.rmdir.mockImplementation(async () => undefined); // Default success for rmdir (empty dirs, non-recursive)
    mockFs.readdir.mockImplementation(async () => []); // Default to empty directory for readdir
  });

  it('should delete a file using fs.unlink', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats);
    await deletePath(filePath);
    expect(mockFs.lstat).toHaveBeenCalledWith(filePath);
    expect(mockFs.unlink).toHaveBeenCalledWith(filePath);
    expect(mockFs.rm).not.toHaveBeenCalled();
    expect(mockFs.rmdir).not.toHaveBeenCalled();
  });

  it('should delete a directory using fs.rm with recursive option when recursive is true', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    await deletePath(dirPath, true); // Recursive true
    expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
    // SUT uses fs.rm with recursive: true for directories if recursive param is true
    expect(mockFs.rm).toHaveBeenCalledWith(dirPath, { recursive: true, force: true });
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.rmdir).not.toHaveBeenCalled();
  });

  it('should delete an empty directory using fs.rmdir when recursive is false', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    mockFs.readdir.mockResolvedValue([]); // Ensure readdir returns empty for this test
    await deletePath(dirPath, false); // Recursive false
    expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
    expect(mockFs.readdir).toHaveBeenCalledWith(dirPath);
    expect(mockFs.rmdir).toHaveBeenCalledWith(dirPath);
    expect(mockFs.rm).not.toHaveBeenCalled(); // fs.rm should not be called if fs.rmdir is used
    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  it('should throw ERR_FS_DIR_NOT_EMPTY when trying to delete non-empty directory with recursive false', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    mockFs.readdir.mockResolvedValue([
      createDirent('file1.txt', true, false),
      createDirent('file2.txt', true, false),
    ]);

    await expect(deletePath(dirPath, false)).rejects.toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.ERR_FS_DIR_NOT_EMPTY,
        message: `Directory ${dirPath} is not empty and recursive is false.`,
      })
    );
    expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
    expect(mockFs.readdir).toHaveBeenCalledWith(dirPath);
    expect(mockFs.rmdir).not.toHaveBeenCalled();
    expect(mockFs.rm).not.toHaveBeenCalled();
  });

  it('should be idempotent and log debug if path does not exist (ENOENT on lstat)', async () => {
    const enoentError = new Error('Path does not exist');
    // @ts-expect-error code is readonly
    enoentError.code = 'ENOENT';
    mockFs.lstat.mockRejectedValue(enoentError);

    await expect(deletePath(filePath)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      `Path not found for deletion (considered success): ${filePath}`
    );
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.rm).not.toHaveBeenCalled();
    expect(mockFs.rmdir).not.toHaveBeenCalled();
  });
  
  it('should consider deletion successful if readdir throws ENOENT (directory disappeared)', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    const enoentError = new Error('Directory disappeared');
    // @ts-expect-error code is readonly
    enoentError.code = 'ENOENT';
    mockFs.readdir.mockRejectedValue(enoentError);

    await expect(deletePath(dirPath, false)).resolves.toBeUndefined(); // Recursive false, non-empty path would try readdir
    expect(logger.debug).toHaveBeenCalledWith(
      `Directory disappeared during deletion check (considered success): ${dirPath}`
    );
    expect(mockFs.rmdir).not.toHaveBeenCalled(); // rmdir shouldn't be called if readdir failed (even if ENOENT)
  });

  it('should throw ERR_FS_DELETE_FAILED if fs.unlink fails', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats);
    const unlinkError = new Error('Permission denied for unlink');
    mockFs.unlink.mockRejectedValue(unlinkError);

    await expect(deletePath(filePath)).rejects.toThrow(ConduitError);
    try {
      await deletePath(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
      expect(err.message).toContain(
        `Failed to delete path: ${filePath}. Error: Permission denied for unlink`
      );
    }
  });

  it('should throw ERR_FS_DELETE_FAILED if fs.rm fails for a directory (recursive true)', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    const rmError = new Error('Cannot delete directory with rm');
    mockFs.rm.mockRejectedValue(rmError);

    await expect(deletePath(dirPath, true)).rejects.toThrow(ConduitError);
    try {
      await deletePath(dirPath, true);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
      expect(err.message).toContain(
        `Failed to delete path: ${dirPath}. Error: Cannot delete directory with rm`
      );
    }
  });

  it('should throw ERR_FS_DELETE_FAILED if fs.rmdir fails for an empty directory (recursive false)', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    mockFs.readdir.mockResolvedValue([]); // Directory is empty
    const rmdirError = new Error('Cannot delete directory with rmdir');
    mockFs.rmdir.mockRejectedValue(rmdirError);

    await expect(deletePath(dirPath, false)).rejects.toThrow(ConduitError);
    try {
      await deletePath(dirPath, false);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
      expect(err.message).toContain(
        `Failed to delete path: ${dirPath}. Error: Cannot delete directory with rmdir` // SUT wraps the original error
      );
    }
  });

  it('should throw ERR_FS_DELETE_FAILED if readdir fails (not ENOENT) when checking if dir is empty', async () => {
    mockFs.lstat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    const readdirError = new Error('Arbitrary readdir failure');
    mockFs.readdir.mockRejectedValue(readdirError);

    await expect(deletePath(dirPath, false)).rejects.toThrow(ConduitError);
    try {
      await deletePath(dirPath, false);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
      expect(err.message).toContain(
        `Failed to check directory contents: ${dirPath}. Error: Arbitrary readdir failure`
      );
    }
  });
}); 