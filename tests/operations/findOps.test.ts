/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  
  // Create mocks inside the factory to avoid hoisting issues
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  
  return {
    ...originalModule,
    logger: mockLogger,
    fileSystemOps: {
      pathExists: vi.fn(),
      getStats: vi.fn(),
      listDirectory: vi.fn(),
      getLstats: vi.fn(),
      createEntryInfo: vi.fn(),
      readFileAsBuffer: vi.fn(),
    },
    getMimeType: vi.fn(),
    validateAndResolvePath: vi.fn(),
    conduitConfig: {
      maxFileReadBytes: 1024 * 1024,
      maxFileReadBytesFind: 512 * 1024,
      maxRecursiveDepth: 10,
      httpTimeoutMs: 5000,
      workspaceRoot: '/test/workspace',
      allowedPaths: ['/test'],
      logLevel: 'ERROR',
    },
  };
});

import { ConduitError, ErrorCode, EntryInfo, ConduitServerConfig, fileSystemOps } from '@/internal';

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

  const createMockStats = (isFile = true, isDir = false) => ({
    isFile: () => isFile,
    isDirectory: () => isDir,
    size: 1024,
    mtime: new Date('2023-01-01'),
    birthtime: new Date('2023-01-01'),
    ctime: new Date('2023-01-01'),
    atime: new Date('2023-01-01'),
    isSymbolicLink: () => false,
    mode: 0o644,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleFindEntries', () => {
    it('should call findEntries and return results for successful find', async () => {
      const { handleFindEntries } = await import('@/operations/findOps');
      
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
      (fileSystemOps.pathExists as any).mockResolvedValue(true);
      (fileSystemOps.getStats as any).mockResolvedValue(createMockStats(false, true));
      (fileSystemOps.listDirectory as any).mockResolvedValue(['file1.txt']);
      (fileSystemOps.getLstats as any).mockResolvedValue(createMockStats(true, false));
      (fileSystemOps.createEntryInfo as any).mockResolvedValue(mockEntries[0]);

      const params = {
        base_path: '/test/dir',
        match_criteria: [],
        recursive: false,
      };

      const result = await handleFindEntries(params, defaultTestConfig);
      expect(result).toEqual(mockEntries);
    });

    it('should throw error when findEntries returns ConduitError', async () => {
      const { handleFindEntries } = await import('@/operations/findOps');
      
      // Mock path not existing to trigger an error
      (fileSystemOps.pathExists as any).mockResolvedValue(false);

      const params = {
        base_path: '/nonexistent/path',
        match_criteria: [],
        recursive: false,
      };

      await expect(handleFindEntries(params, defaultTestConfig))
        .rejects.toThrow(ConduitError);
    });
  });

  describe('findEntries error handling', () => {
    it('should return ConduitError when base path does not exist', async () => {
      const { findEntries } = await import('@/operations/findOps');
      
      (fileSystemOps.pathExists as any).mockResolvedValue(false);

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
      const { findEntries } = await import('@/operations/findOps');
      
      (fileSystemOps.pathExists as any).mockResolvedValue(true);
      (fileSystemOps.getStats as any).mockResolvedValue(createMockStats(false, true));
      (fileSystemOps.listDirectory as any).mockResolvedValue(['test.txt', 'other.md', 'readme.txt']);
      (fileSystemOps.getLstats as any).mockResolvedValue(createMockStats(true, false));
      
      // Mock createEntryInfo for each file
      (fileSystemOps.createEntryInfo as any)
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
        match_criteria: [{
          type: 'name_pattern' as const,
          pattern: '*.txt'
        }],
        recursive: false,
      };

      const result = await findEntries(params, defaultTestConfig);
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result).toHaveLength(2);
        expect(result.map(r => r.name)).toContain('test.txt');
        expect(result.map(r => r.name)).toContain('readme.txt');
        expect(result.map(r => r.name)).not.toContain('other.md');
      }
    });
  });
});