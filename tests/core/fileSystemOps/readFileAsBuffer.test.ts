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
import { readFileAsBuffer } from '@/core/fileSystemOps';
import { conduitConfig } from '@/internal'; // For test logic, should pick up the above mock
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import type { Stats } from 'fs';
import { Buffer } from 'buffer';

describe('readFileAsBuffer', () => {
  const filePath = 'test.bin';
  const defaultFileBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);

  const createMockStats = (size: number, isDirectory = false): Stats => ({
    size,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => false,
    mode: 0o644,
    mtime: new Date(),
    birthtime: new Date(),
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    ctime: new Date(),
  }) as Stats;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockImplementation(async () => createMockStats(defaultFileBuffer.length));
    mockFs.readFile.mockImplementation(async () => defaultFileBuffer);
  });

  it('should read file content as buffer successfully', async () => {
    const content = await readFileAsBuffer(filePath);
    expect(content).toEqual(defaultFileBuffer);
    expect(mockFs.stat).toHaveBeenCalledWith(filePath);
    expect(mockFs.readFile).toHaveBeenCalledWith(filePath);
  });

  it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if file size is greater than configured maxFileReadBytes', async () => {
    const oversizedStat = createMockStats(conduitConfig.maxFileReadBytes + 1);
    mockFs.stat.mockImplementation(async () => oversizedStat);
    
    // SUT will now use its default maxLength from the mocked conduitConfig
    await expect(readFileAsBuffer(filePath)).rejects.toThrow(ConduitError);
    try {
      await readFileAsBuffer(filePath); // SUT uses its default maxLength
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
      expect(err.message).toContain(
        `File size ${conduitConfig.maxFileReadBytes + 1} bytes exceeds maximum allowed read limit of ${conduitConfig.maxFileReadBytes} bytes`
      );
    }
  });

  it('should use specified maxLength if provided and throw if size exceeds it', async () => {
    const specifiedMaxLength = 2;
    const largerThanSpecifiedStat = createMockStats(defaultFileBuffer.length); // defaultFileBuffer.length is 4
    mockFs.stat.mockImplementation(async () => largerThanSpecifiedStat);

    await expect(readFileAsBuffer(filePath, specifiedMaxLength)).rejects.toThrow(ConduitError);
    try {
      await readFileAsBuffer(filePath, specifiedMaxLength);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
      expect(err.message).toContain(
        `File size ${defaultFileBuffer.length} bytes exceeds maximum allowed read limit of ${specifiedMaxLength} bytes`
      );
    }
  });

  it('should throw ERR_FS_PATH_IS_DIR if path is a directory', async () => {
    const dirStat = createMockStats(100, true);
    mockFs.stat.mockImplementation(async () => dirStat);

    await expect(readFileAsBuffer(filePath)).rejects.toThrow(ConduitError);
    try {
      await readFileAsBuffer(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_DIR);
    }
  });

  it('should throw ERR_FS_NOT_FOUND if fs.readFile throws ENOENT (after stat succeeds)', async () => {
    mockFs.stat.mockImplementation(async () => createMockStats(10)); // Stat succeeds
    mockFs.readFile.mockImplementation(async () => {
      const error = new Error('File not found');
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });

    await expect(readFileAsBuffer(filePath)).rejects.toThrow(ConduitError);
    try {
      await readFileAsBuffer(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
    }
  });

  it('should throw ERR_FS_READ_FAILED for other fs.readFile errors (after stat succeeds)', async () => {
    mockFs.stat.mockImplementation(async () => createMockStats(10)); // Stat succeeds
    mockFs.readFile.mockImplementation(async () => {
      const error = new Error('Read permission denied');
      // @ts-expect-error code is readonly
      error.code = 'EACCES';
      throw error;
    });

    await expect(readFileAsBuffer(filePath)).rejects.toThrow(ConduitError);
    try {
      await readFileAsBuffer(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_READ_FAILED);
    }
  });

  it('should re-throw ConduitError if getStats throws it', async () => {
    const specificError = new ConduitError(ErrorCode.ERR_FS_ACCESS_DENIED, 'Stat failed for buffer read');
    mockFs.stat.mockImplementation(async () => {
      throw specificError;
    });

    await expect(readFileAsBuffer(filePath)).rejects.toThrow(specificError);
  });
}); 