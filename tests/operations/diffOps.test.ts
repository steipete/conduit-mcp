/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import { getDiff } from '@/operations/diffOps';
import {
  logger as internalLogger,
  conduitConfig,
  fileSystemOps,
  webFetcher,
  ReadTool,
  ConduitServerConfig,
  getMimeType as internalGetMimeType,
} from '@/internal';

// Mock @/internal using the robust spread pattern
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  const loggerForInternalMock = mockDeep<import('pino').Logger<string>>();
  loggerForInternalMock.child.mockReturnValue(loggerForInternalMock);

  const mockedConfigLoader = {
    ...mockDeep<typeof originalModule.configLoader>(),
    conduitConfig: mockDeep<ConduitServerConfig>(),
  };

  return {
    ...originalModule, // Spread original module first
    // Override specific parts with mocks
    logger: loggerForInternalMock,
    configLoader: mockedConfigLoader,
    fileSystemOps: mockDeep<typeof originalModule.fileSystemOps>(),
    webFetcher: {
      ...originalModule.webFetcher, // Spread original webFetcher to keep other potential functions
      fetchUrlContent: vi.fn(), // Specifically mock fetchUrlContent
    },
    getMimeType: vi.fn(),
    // ConduitError, ErrorCode, ReadTool etc. will be passed from originalModule
    ConduitError: originalModule.ConduitError,
    ErrorCode: originalModule.ErrorCode,
    ReadTool: originalModule.ReadTool,
    ConduitServerConfig: originalModule.ConduitServerConfig,
  };
});

// Use the imported mocks
const mockedLogger = internalLogger as DeepMockProxy<import('pino').Logger>;
const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
const mockedFsOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;
const mockedFetchUrlContent = webFetcher.fetchUrlContent as MockedFunction<
  typeof webFetcher.fetchUrlContent
>;
const mockedGetMimeType = internalGetMimeType as MockedFunction<typeof internalGetMimeType>;

describe('diffOps', () => {
  const defaultTestConfig: Partial<ConduitServerConfig> = {
    // workspaceRoot: '/test/workspace', // Set if your tests rely on a specific root
    logLevel: 'ERROR',
    allowedPaths: ['/test'],
    maxFileReadBytes: 1024 * 1024, // 1MB
    maxUrlDownloadSizeBytes: 5 * 1024 * 1024, // 5MB
    httpTimeoutMs: 5000,
  };

  const source1Path = '/test/file1.txt';
  const source2Path = '/test/file2.txt';
  const source1Url = 'http://example.com/file1.txt';
  const source2Url = 'http://example.com/file2.txt';

  beforeEach(() => {
    mockReset(mockedLogger);
    // The child mock setup for logger needs to ensure it returns the parent mock correctly after reset
    // if child is also a deep mock, it might need its own reset or careful setup.
    // For simplicity, if logger.child().info() is called, ensure logger.child returns mockedLogger.
    (mockedLogger.child as MockedFunction<any>).mockReturnValue(mockedLogger);

    mockReset(mockedConfig); // This should now work
    Object.assign(mockedConfig, defaultTestConfig);
    // Ensure type safety if defaultTestConfig properties are all optional
    mockedConfig.maxFileReadBytes = defaultTestConfig.maxFileReadBytes!;
    mockedConfig.maxUrlDownloadSizeBytes = defaultTestConfig.maxUrlDownloadSizeBytes!;
    mockedConfig.httpTimeoutMs = defaultTestConfig.httpTimeoutMs!;

    mockReset(mockedFsOps);
    mockedFetchUrlContent.mockReset();
    mockedGetMimeType.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDiff - File sources', () => {
    const params: ReadTool.DiffParams = {
      operation: 'diff',
      sources: [source1Path, source2Path],
      diff_format: 'unified',
    };
    const mockFileStats = {
      isFile: () => true,
      isDirectory: () => false,
    } as any;

    it('should return a text diff for two different files', async () => {
      mockedFsOps.getStats.mockResolvedValueOnce(mockFileStats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(
        Buffer.from('This is file one.\nLine two.\nLine three.')
      );

      mockedFsOps.getStats.mockResolvedValueOnce(mockFileStats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(
        Buffer.from('This is file two.\nLine two changed.\nLine three.')
      );

      const result = (await getDiff(
        {
          ...params,
          diff_format: 'unified',
        },
        mockedConfig as ConduitServerConfig
      )) as ReadTool.DiffResultSuccess;

      expect(result.status).toBe('success');
      expect(result.sources_compared).toEqual([source1Path, source2Path]);
      expect(result.diff_format_used).toBe('unified');
      expect(result.diff_content).toContain('-This is file one.');
      expect(result.diff_content).toContain('+This is file two.');
      expect(result.diff_content).toContain('-Line two.');
      expect(result.diff_content).toContain('+Line two changed.');
      expect(mockedFsOps.readFileAsBuffer).toHaveBeenCalledTimes(2);
    });

    it('should return empty diff for identical files', async () => {
      mockedFsOps.getStats.mockResolvedValue(mockFileStats);
      mockedGetMimeType.mockResolvedValue('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValue(
        Buffer.from('Identical content.\nSecond line.')
      );

      const result = (await getDiff(
        {
          ...params,
          diff_format: 'unified',
        },
        mockedConfig as ConduitServerConfig
      )) as ReadTool.DiffResultSuccess;

      expect(result.status).toBe('success');
      // Expect the header but no actual diff hunks (e.g., no lines starting with @@)
      expect(result.diff_content).toContain(
        '==================================================================='
      );
      expect(result.diff_content).toContain(`--- ${source1Path}`);
      expect(result.diff_content).toContain(`+++ ${source2Path}`);
      expect(result.diff_content).not.toContain('@@');
    });

    // Add tests for errors: file not found, read error, oversized file
  });

  describe('getDiff - URL sources', () => {
    const params: ReadTool.DiffParams = {
      operation: 'diff',
      sources: [source1Url, source2Url],
      diff_format: 'unified',
    };

    it('should return a text diff for two different URLs', async () => {
      mockedFetchUrlContent
        .mockImplementationOnce(async () => ({
          content: Buffer.from('This is URL one.\nLine two from URL.'),
          mimeType: 'text/plain',
          httpStatus: 200,
          finalUrl: source1Url,
          error: null,
          isBinary: false,
          size: 100,
          isPartialContent: false,
          rangeRequestStatus: 'not_requested',
          headers: {},
        }))
        .mockImplementationOnce(async () => ({
          content: Buffer.from('This is URL two.\nLine two changed from URL.'),
          mimeType: 'text/plain',
          httpStatus: 200,
          finalUrl: source2Url,
          error: null,
          isBinary: false,
          size: 100,
          isPartialContent: false,
          rangeRequestStatus: 'not_requested',
          headers: {},
        }));

      const result = (await getDiff(
        params,
        mockedConfig as ConduitServerConfig
      )) as ReadTool.DiffResultSuccess;

      expect(result.status).toBe('success');
      expect(result.sources_compared).toEqual([source1Url, source2Url]);
      expect(result.diff_format_used).toBe('unified');
      expect(result.diff_content).toContain('-This is URL one.');
      expect(result.diff_content).toContain('+This is URL two.');
      expect(mockedFetchUrlContent).toHaveBeenCalledTimes(2);
    });

    // Add tests for errors: URL not found, fetch error, oversized content
  });

  describe('getDiff - Mixed sources (File and URL)', () => {
    const params: ReadTool.DiffParams = {
      operation: 'diff',
      sources: [source1Path, source2Url],
      diff_format: 'unified',
    };
    const mockFileStats = {
      isFile: () => true,
      isDirectory: () => false,
    } as any;

    it('should return a text diff for a file and a URL', async () => {
      // Mock for source1Path (file)
      mockedFsOps.getStats.mockResolvedValueOnce(mockFileStats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('File content here.\n'));

      // Mock for source2Url (URL)
      mockedFetchUrlContent.mockImplementationOnce(async () => ({
        content: Buffer.from('URL content here.\n'),
        mimeType: 'text/plain',
        httpStatus: 200,
        finalUrl: source2Url,
        error: null,
        isBinary: false,
        size: 100,
        isPartialContent: false,
        rangeRequestStatus: 'not_requested',
        headers: {},
      }));

      const result = (await getDiff(
        params,
        mockedConfig as ConduitServerConfig
      )) as ReadTool.DiffResultSuccess;

      expect(result.status).toBe('success');
      expect(result.sources_compared).toEqual([source1Path, source2Url]);
      expect(result.diff_format_used).toBe('unified');
      expect(result.diff_content).toContain('-File content here.');
      expect(result.diff_content).toContain('+URL content here.');
      expect(mockedFsOps.readFileAsBuffer).toHaveBeenCalledTimes(1);
      expect(mockedFetchUrlContent).toHaveBeenCalledTimes(1);
    });
  });

  // Add tests for patch format if implemented
  // Add tests for error handling (e.g., one source fails to load)
});
