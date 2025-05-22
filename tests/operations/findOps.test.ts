/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ConduitError, ErrorCode, EntryInfo, ConduitServerConfig } from '@/internal';

// Mock the core dependencies
vi.mock('@/core/fileSystemOps', () => ({
  pathExists: vi.fn().mockResolvedValue(false),
  getStats: vi.fn().mockResolvedValue({}),
  listDirectory: vi.fn().mockResolvedValue([]),
  getLstats: vi.fn().mockResolvedValue({}),
  createEntryInfo: vi.fn().mockResolvedValue({}),
}));

// Mock the logger
vi.mock('@/utils/logger', () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock getMimeType
vi.mock('@/core/mimeService', () => ({
  getMimeType: vi.fn().mockResolvedValue('text/plain'),
}));

// Import the functions to test after setting up mocks
import { findEntries, handleFindEntries } from '@/operations/findOps';
import * as fileSystemOps from '@/core/fileSystemOps';

describe('findOps', () => {
  const defaultTestConfig: ConduitServerConfig = {
    workspaceRoot: '/test/workspace',
    logLevel: 'ERROR',
    allowedPaths: ['/test'],
    maxFileReadBytes: 1024 * 1024,
    maxFileReadBytesFind: 512 * 1024,
    maxRecursiveDepth: 10,
    httpTimeoutMs: 5000,
  } as ConduitServerConfig;

  const createMockStats = (isFile = true, isDir = false) =>
    ({
      isFile: () => isFile,
      isDirectory: () => isDir,
      size: 1024,
      mtime: new Date('2023-01-01'),
      birthtime: new Date('2023-01-01'),
      ctime: new Date('2023-01-01'),
      atime: new Date('2023-01-01'),
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      mode: 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      ino: 0,
      blksize: 4096,
      blocks: 8,
      atimeMs: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      dev: 0,
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleFindEntries', () => {
    it('should call findEntries and return results for successful find', async () => {
      const mockEntries: EntryInfo[] = [
        {
          name: 'file1.txt',
          path: '/test/dir/file1.txt',
          type: 'file',
          size_bytes: 1024,
          mime_type: 'text/plain',
          created_at: '2023-01-01T00:00:00Z',
          modified_at: '2023-01-01T00:00:00Z',
        },
      ];

      // Set up mocks
      vi.mocked(fileSystemOps.pathExists).mockImplementation(async () => true);
      vi.mocked(fileSystemOps.getStats).mockImplementation(async () =>
        createMockStats(false, true)
      );
      vi.mocked(fileSystemOps.listDirectory).mockImplementation(async () => ['file1.txt']);
      vi.mocked(fileSystemOps.getLstats).mockImplementation(async () =>
        createMockStats(true, false)
      );
      vi.mocked(fileSystemOps.createEntryInfo).mockImplementation(async () => mockEntries[0]);

      const params = {
        base_path: '/test/dir',
        match_criteria: [],
        recursive: false,
      };

      const result = await handleFindEntries(params, defaultTestConfig);
      expect(result).toEqual(mockEntries);
    });

    it('should throw error when findEntries returns ConduitError', async () => {
      // Mock path not existing
      vi.mocked(fileSystemOps.pathExists).mockResolvedValue(false);

      const params = {
        base_path: '/nonexistent/path',
        match_criteria: [],
        recursive: false,
      };

      await expect(handleFindEntries(params, defaultTestConfig)).rejects.toThrow(ConduitError);
    });
  });

  describe('findEntries error handling', () => {
    it('should return ConduitError when base path does not exist', async () => {
      vi.mocked(fileSystemOps.pathExists).mockResolvedValue(false);

      const params = {
        base_path: '/nonexistent/path',
        match_criteria: [],
        recursive: false,
      };

      const result = await findEntries(params, defaultTestConfig);
      expect(result).toBeInstanceOf(ConduitError);
      if (result instanceof ConduitError) {
        expect(result.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      }
    });
  });

  describe('findEntries with name_pattern', () => {
    it('should find files matching name pattern', async () => {
      vi.mocked(fileSystemOps.pathExists).mockResolvedValue(true);
      vi.mocked(fileSystemOps.getStats).mockResolvedValue(createMockStats(false, true));
      vi.mocked(fileSystemOps.listDirectory).mockResolvedValue([
        'test.txt',
        'other.md',
        'readme.txt',
      ]);
      vi.mocked(fileSystemOps.getLstats).mockResolvedValue(createMockStats(true, false));

      // Mock createEntryInfo for each file
      vi.mocked(fileSystemOps.createEntryInfo)
        .mockResolvedValueOnce({
          name: 'test.txt',
          path: '/test/test.txt',
          type: 'file',
          size_bytes: 1024,
          mime_type: 'text/plain',
          created_at: '2023-01-01T00:00:00Z',
          modified_at: '2023-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          name: 'other.md',
          path: '/test/other.md',
          type: 'file',
          size_bytes: 2048,
          mime_type: 'text/markdown',
          created_at: '2023-01-01T00:00:00Z',
          modified_at: '2023-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          name: 'readme.txt',
          path: '/test/readme.txt',
          type: 'file',
          size_bytes: 512,
          mime_type: 'text/plain',
          created_at: '2023-01-01T00:00:00Z',
          modified_at: '2023-01-01T00:00:00Z',
        });

      const params = {
        base_path: '/test',
        match_criteria: [
          {
            type: 'name_pattern' as const,
            pattern: '*.txt',
          },
        ],
        recursive: false,
      };

      const result = await findEntries(params, defaultTestConfig);
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result).toHaveLength(2);
        expect(result.map((r) => r.name)).toContain('test.txt');
        expect(result.map((r) => r.name)).toContain('readme.txt');
        expect(result.map((r) => r.name)).not.toContain('other.md');
      }
    });
  });
});
