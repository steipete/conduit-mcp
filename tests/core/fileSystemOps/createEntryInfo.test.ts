import { vi, type MockedFunction } from 'vitest';
import { mockFs, mockConduitConfig, mockGetMimeType, mockFormatToISO8601UTC } from './helpers';
import type { Stats } from 'fs';
import path from 'path';
import { constants as fsConstants } from 'fs';

// Mock fs/promises AT THE TOP of the test file
vi.mock('fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));

// Mock @/internal AT THE TOP of the test file
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  // REMOVE re-assignments here as they are now imported and already vi.fn()
  // mockGetMimeType = vi.fn();
  // mockFormatToISO8601UTC = vi.fn((date: Date) => date.toISOString());

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
    getMimeType: mockGetMimeType,
    formatToISO8601UTC: mockFormatToISO8601UTC,
  };
});

// Now proceed with other imports
import { describe, it, expect, beforeEach } from 'vitest';
import { createEntryInfo } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';

describe('createEntryInfo', () => {
  const now = new Date();
  const formattedDate = mockFormatToISO8601UTC(now);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMimeType.mockReset().mockResolvedValue('application/octet-stream');
    mockFormatToISO8601UTC.mockReset().mockImplementation((date: Date) => date.toISOString());
    mockFs.lstat.mockReset();
    mockFs.stat.mockReset();
    mockFs.readlink.mockReset();
  });

  it('should create EntryInfo for a file correctly', async () => {
    const filePath = '/test/file.txt';
    const fileStats = {
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 1234,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o100644, // regular file, rw-r--r--
    } as Stats;

    mockFs.lstat.mockResolvedValue(fileStats);
    mockGetMimeType.mockResolvedValueOnce('text/plain');

    const entryInfo = await createEntryInfo(filePath, fileStats);

    expect(mockFs.lstat).toHaveBeenCalledWith(filePath);
    expect(mockGetMimeType).toHaveBeenCalledWith(filePath);

    expect(entryInfo).toEqual({
      name: 'file.txt',
      path: filePath,
      type: 'file',
      size_bytes: 1234,
      mime_type: 'text/plain',
      created_at: formattedDate,
      modified_at: formattedDate,
      last_accessed_at: formattedDate,
      is_readonly: false,
      symlink_target: undefined,
    });
  });

  it('should create EntryInfo for a directory correctly', async () => {
    const dirPath = '/test/directory';
    const dirStats = {
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      size: 4096, // Typically non-zero for directories, but SUT ignores it for type: 'directory'
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o40755, // directory, rwxr-xr-x
    } as Stats;

    mockFs.lstat.mockResolvedValue(dirStats);

    const entryInfo = await createEntryInfo(dirPath, dirStats);

    expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
    expect(mockGetMimeType).not.toHaveBeenCalled();

    expect(entryInfo).toEqual({
      name: 'directory',
      path: dirPath,
      type: 'directory',
      size_bytes: undefined,
      mime_type: undefined,
      created_at: formattedDate,
      modified_at: formattedDate,
      last_accessed_at: formattedDate,
      is_readonly: false,
      symlink_target: undefined,
    });
  });

  it('should create EntryInfo for a read-only file correctly', async () => {
    const filePath = '/test/readonly.txt';
    const readonlyStats = {
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 500,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o100444, // r--r--r--
    } as Stats;

    mockFs.lstat.mockResolvedValue(readonlyStats);
    mockGetMimeType.mockResolvedValueOnce('text/plain');

    const entryInfo = await createEntryInfo(filePath, readonlyStats);

    expect(entryInfo.is_readonly).toBe(true);
    expect(entryInfo.size_bytes).toBe(500);
    expect(entryInfo.mime_type).toBe('text/plain');
  });

  it('should create EntryInfo for a symlink to a file correctly', async () => {
    const symlinkPath = '/test/link-to-file.txt';
    const targetPath = '/target/file.txt';
    const symlinkLstats = {
      // Stats from lstat (the link itself)
      isFile: () => false, // lstat says symlink is not a file
      isDirectory: () => false, // lstat says symlink is not a directory
      isSymbolicLink: () => true,
      size: 10, // Symlink size
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o120777, // Symlink mode
    } as Stats;

    const targetFileStats = {
      // Stats from stat (the target file)
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false, // Target is not a symlink
      size: 2000,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o100644,
    } as Stats;

    mockFs.lstat.mockResolvedValue(symlinkLstats);
    mockFs.readlink.mockResolvedValue(targetPath);
    mockFs.stat.mockResolvedValue(targetFileStats); // fs.stat on symlink path resolves to target stats
    mockGetMimeType.mockResolvedValueOnce('text/plain'); // Mime type of the target file

    const entryInfo = await createEntryInfo(symlinkPath, targetFileStats); // SUT uses target stats here

    expect(mockFs.lstat).toHaveBeenCalledWith(symlinkPath);
    expect(mockFs.readlink).toHaveBeenCalledWith(symlinkPath, { encoding: 'utf8' });
    expect(mockFs.stat).toHaveBeenCalledWith(symlinkPath);
    // The SUT's logic for symlinks: if lstat.isSymbolicLink() is true, mime_type and size_bytes are undefined.
    // getMimeType is only called if !isSymlink AND effectiveStats.isFile().
    // In this case, isSymlink is true, so getMimeType should not be called by SUT.
    expect(mockGetMimeType).not.toHaveBeenCalled();

    expect(entryInfo).toEqual({
      name: 'link-to-file.txt',
      path: symlinkPath,
      type: 'symlink',
      size_bytes: undefined, // Undefined because it's a symlink
      mime_type: undefined, // Undefined because it's a symlink
      created_at: formattedDate, // Based on effectiveStats (targetFileStats for dates)
      modified_at: formattedDate,
      last_accessed_at: formattedDate,
      is_readonly: false, // Based on effectiveStats (targetFileStats for mode)
      symlink_target: targetPath,
    });
  });

  it('should handle broken symlinks gracefully', async () => {
    const brokenLinkPath = '/test/broken-link';
    const nonExistentTarget = '/target/does-not-exist';
    const symlinkLstats = {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
      size: 12,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o120777,
    } as Stats;

    mockFs.lstat.mockResolvedValue(symlinkLstats);
    mockFs.readlink.mockResolvedValue(nonExistentTarget);
    const enoentError = new Error('ENOENT: Target not found');
    (enoentError as any).code = 'ENOENT';
    mockFs.stat.mockRejectedValue(enoentError); // fs.stat on broken symlink fails

    // When fs.stat fails for a symlink target, SUT uses lstat results for dates/mode.
    const entryInfo = await createEntryInfo(brokenLinkPath, symlinkLstats);

    expect(mockFs.lstat).toHaveBeenCalledWith(brokenLinkPath);
    expect(mockFs.readlink).toHaveBeenCalledWith(brokenLinkPath, { encoding: 'utf8' });
    expect(mockFs.stat).toHaveBeenCalledWith(brokenLinkPath);
    expect(mockGetMimeType).not.toHaveBeenCalled();

    expect(entryInfo).toEqual({
      name: 'broken-link',
      path: brokenLinkPath,
      type: 'symlink',
      size_bytes: undefined,
      mime_type: undefined,
      created_at: formattedDate, // From lstats because target stat failed
      modified_at: formattedDate, // From lstats
      last_accessed_at: formattedDate, // From lstats
      is_readonly: false, // From lstats (mode 0o120777 is not S_IWUSR denied)
      symlink_target: nonExistentTarget,
    });
  });

  it('should use name override when provided', async () => {
    const filePath = '/test/original.txt';
    const nameOverride = 'renamed.txt';
    const fileStats = {
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 1234,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o100644,
    } as Stats;

    mockFs.lstat.mockResolvedValue(fileStats);
    mockGetMimeType.mockResolvedValueOnce('text/plain');

    const entryInfo = await createEntryInfo(filePath, fileStats, nameOverride);

    expect(entryInfo.name).toBe(nameOverride);
    expect(entryInfo.path).toBe(filePath);
  });

  it('should handle zero-byte files correctly', async () => {
    const filePath = '/test/empty.txt';
    const zeroByteStats = {
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 0,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o100644,
    } as Stats;

    mockFs.lstat.mockResolvedValue(zeroByteStats);
    mockGetMimeType.mockResolvedValueOnce('application/x-empty'); // Specific mime for empty

    const entryInfo = await createEntryInfo(filePath, zeroByteStats);

    expect(mockGetMimeType).toHaveBeenCalledWith(filePath);
    expect(entryInfo).toEqual({
      name: 'empty.txt',
      path: filePath,
      type: 'file',
      size_bytes: 0,
      mime_type: 'application/x-empty',
      created_at: formattedDate,
      modified_at: formattedDate,
      last_accessed_at: formattedDate,
      is_readonly: false,
      symlink_target: undefined,
    });
  });

  it('should throw OPERATION_FAILED if lstat fails (not ENOENT)', async () => {
    const filePath = '/test/permission_denied_lstat.txt';
    const permError = new Error('EACCES: Permission denied');
    (permError as any).code = 'EACCES';
    mockFs.lstat.mockRejectedValue(permError);
    // SUT's createEntryInfo passes its own statsParam to itself, which is not used if lstat fails early.
    // So we can pass a dummy stats object here for the statsParam argument of createEntryInfo.
    const dummyStats = { isFile: () => true } as Stats;

    await expect(createEntryInfo(filePath, dummyStats)).rejects.toThrow(ConduitError);
    try {
      await createEntryInfo(filePath, dummyStats);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.OPERATION_FAILED);
      expect(err.message).toContain(
        `Could not get entry info for ${filePath}. Error: ${permError.message}`
      );
    }
  });

  it('should throw OPERATION_FAILED if readlink fails for a symlink (not ENOENT)', async () => {
    const symlinkPath = '/test/permission_denied_readlink.link';
    const symlinkLstats = {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
      size: 10,
      birthtime: now,
      mtime: now,
      atime: now,
      mode: 0o120777,
    } as Stats;
    mockFs.lstat.mockResolvedValue(symlinkLstats);
    const permError = new Error('EACCES: Readlink permission denied');
    (permError as any).code = 'EACCES';
    mockFs.readlink.mockRejectedValue(permError);
    // fs.stat for the symlink target would not be called if readlink fails this way.

    await expect(createEntryInfo(symlinkPath, symlinkLstats)).rejects.toThrow(ConduitError);
    try {
      await createEntryInfo(symlinkPath, symlinkLstats);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.OPERATION_FAILED);
      // The error message should now match the specific throw from the readlink catch block
      expect(err.message).toBe(
        `Failed to read symlink target for ${symlinkPath}. Error: ${permError.message}`
      );
    }
  });
});
