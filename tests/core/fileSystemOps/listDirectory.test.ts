import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers';

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
import { listDirectory } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
// logger is imported from the mocked @/internal, no need to import directly if only verifying calls

describe('listDirectory', () => {
  const dirPath = '/my/directory';
  const entries = ['file1.txt', 'subdir', 'file2.js'];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default behavior for readdir in these tests
    mockFs.readdir.mockImplementation(async () => entries as any); // Cast as any if Dirent objects are not fully mocked
  });

  it('should return an array of entry names on success', async () => {
    const result = await listDirectory(dirPath);
    expect(result).toEqual(entries);
    expect(mockFs.readdir).toHaveBeenCalledWith(dirPath);
  });

  it('should throw ERR_FS_DIR_NOT_FOUND if directory does not exist (ENOENT)', async () => {
    const nonExistentDirPath = '/test/non_existent_dir';
    const error = Object.assign(new Error('Directory not found'), {
      code: 'ENOENT',
    }) as NodeJS.ErrnoException;
    mockFs.readdir.mockRejectedValue(error);

    await expect(listDirectory(nonExistentDirPath)).rejects.toThrow(ConduitError);
    try {
      await listDirectory(nonExistentDirPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DIR_NOT_FOUND);
      expect(err.message).toContain(`Directory not found: ${nonExistentDirPath}`);
    }
  });

  it('should throw ERR_FS_PATH_IS_FILE if path is a file (ENOTDIR)', async () => {
    const fileAsDirPath = '/test/file_as_dir';
    const error = Object.assign(new Error('Path is a file'), {
      code: 'ENOTDIR',
    }) as NodeJS.ErrnoException;
    mockFs.readdir.mockRejectedValue(error);

    await expect(listDirectory(fileAsDirPath)).rejects.toThrow(ConduitError);
    try {
      await listDirectory(fileAsDirPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
      expect(err.message).toContain(
        `Path is a file, not a directory: ${fileAsDirPath}`
      );
    }
  });

  it('should throw ERR_FS_DIR_LIST_FAILED for other fs.readdir errors', async () => {
    const anotherDirPath = '/test/some_other_dir';
    const error = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    }) as NodeJS.ErrnoException;
    mockFs.readdir.mockRejectedValue(error);
    
    await expect(listDirectory(anotherDirPath)).rejects.toThrow(ConduitError);
    try {
      await listDirectory(anotherDirPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_DIR_LIST_FAILED);
      expect(err.message).toContain(
        `Failed to list directory: ${anotherDirPath}. Error: Permission denied`
      );
    }
  });
}); 