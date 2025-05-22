/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import * as fs from 'fs'; // For fs.Stats type
import {
  getMetadata,
  // getMetadataFromFile, // Not exporting these directly for now, test via getMetadata
  // getMetadataFromUrl
} from '@/operations/metadataOps';

// Mock @/internal
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  
  return {
    ...originalModule,
    conduitConfig: mockDeep<import('@/types/config').ConduitServerConfig>(),
    logger: (() => {
      const mockLogger = mockDeep<import('pino').Logger<string>>();
      (mockLogger.child as MockedFunction<any>).mockReturnValue(mockLogger);
      return mockLogger;
    })(),
    fileSystemOps: mockDeep<typeof import('@/core/fileSystemOps')>(),
    securityHandler: mockDeep<typeof import('@/core/securityHandler')>(),
    webFetcher: mockDeep<typeof import('@/core/webFetcher')>(),
    mimeService: mockDeep<typeof import('@/core/mimeService')>(),
    getMimeType: vi.fn(),
    formatToISO8601UTC: vi.fn(),
  };
});

// Import mocked items from @/internal
import {
  ConduitError,
  ErrorCode,
  logger,
  fileSystemOps,
  securityHandler,
  webFetcher,
  mimeService,
  ReadTool,
  MCPErrorStatus,
  ConduitServerConfig,
  formatToISO8601UTC,
  getMimeType,
  conduitConfig,
} from '@/internal';

describe('metadataOps', () => {
  // Initialize test-level variables with correct types
  const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedFsOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;
  const mockedLogger = logger as DeepMockProxy<import('pino').Logger<string>>;
  const mockedSecurityHandler = securityHandler as DeepMockProxy<typeof securityHandler>;
  const mockedWebFetcher = webFetcher as DeepMockProxy<typeof webFetcher>;
  const mockedMimeService = mimeService as DeepMockProxy<typeof mimeService>;
  const mockedGetMimeType = getMimeType as MockedFunction<typeof getMimeType>;
  const mockedFormatToISO = formatToISO8601UTC as MockedFunction<typeof formatToISO8601UTC>;

  const defaultTestConfig: Partial<ConduitServerConfig> = {
    // Add any specific config defaults needed for metadataOps if any
  };

  const testFilePath = '/test/workspace/somefile.txt';
  const testFileUrl = 'http://example.com/somefile.txt';

  beforeEach(() => {
    // Call mockReset on all deep-mocked objects and vi.fn() mocks
    mockReset(mockedConfig);
    mockReset(mockedFsOps);
    mockReset(mockedLogger);
    mockReset(mockedSecurityHandler);
    mockReset(mockedWebFetcher);
    mockReset(mockedMimeService);
    mockedGetMimeType.mockReset();
    mockedFormatToISO.mockReset();

    // Assign default test config
    Object.assign(mockedConfig, defaultTestConfig);

    // Ensure logger.child returns the logger itself
    (mockedLogger.child as MockedFunction<any>).mockReturnValue(mockedLogger);

    // Set up default implementations for metadata tests
    mockedFsOps.getStats.mockResolvedValue({} as fs.Stats);
    mockedFsOps.createEntryInfo.mockResolvedValue({
      name: '',
      path: '',
      type: 'file' as const,
      size_bytes: 0,
      mime_type: '',
      created_at: '',
      modified_at: '',
      permissions_octal: '',
      permissions_string: '',
    });
    mockedSecurityHandler.validateAndResolvePath.mockResolvedValue('');
    mockedWebFetcher.fetchUrlContent.mockResolvedValue({
      finalUrl: '',
      mimeType: '',
      headers: {},
      httpStatus: 200,
      error: null,
      content: Buffer.from(''),
      isBinary: false,
      size: 0,
      isPartialContent: false,
      rangeRequestStatus: 'not_requested',
    });
    mockedMimeService.getMimeType.mockReturnValue('text/plain');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMetadata - for File source', () => {
    const baseFileParams: ReadTool.MetadataParams = {
      operation: 'metadata',
      sources: [testFilePath],
    };

    it('should return success with file metadata for a valid file path', async () => {
      const mockStats = {
        isFile: () => true,
        isDirectory: () => false,
        size: 1234,
        birthtimeMs: new Date('2023-01-01T10:00:00Z').getTime(),
        mtimeMs: new Date('2023-01-02T11:00:00Z').getTime(),
        mode: 33188, // Corresponds to -rw-r--r--
      } as fs.Stats;
      mockedFsOps.pathExists.mockResolvedValue(true);
      mockedFsOps.getStats.mockResolvedValue(mockStats);
      mockedFsOps.createEntryInfo.mockResolvedValue({
        name: 'somefile.txt',
        path: testFilePath,
        type: 'file',
        size_bytes: 1234,
        mime_type: 'text/plain',
        created_at: '2023-01-01T10:00:00.000Z',
        modified_at: '2023-01-02T11:00:00.000Z',
        permissions_octal: '0644',
        permissions_string: '-rw-r--r--',
      });

      const result = (await getMetadata(
        testFilePath,
        baseFileParams,
        mockedConfig as ConduitServerConfig
      )) as ReadTool.MetadataResultSuccess;

      expect(result.status).toBe('success');
      expect(result.source).toBe(testFilePath);
      expect(result.source_type).toBe('file');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.name).toBe('somefile.txt');
      expect(result.metadata.entry_type).toBe('file');
      expect(result.metadata.size_bytes).toBe(1234);
      expect(result.metadata.mime_type).toBe('text/plain');
      expect(result.metadata.created_at).toBe('2023-01-01T10:00:00.000Z');
      expect(result.metadata.modified_at).toBe('2023-01-02T11:00:00.000Z');
      expect(result.metadata.permissions_string).toBe('-rw-r--r--');
      expect(mockedFsOps.getStats).toHaveBeenCalledWith(testFilePath);
    });

    // More tests for file source: directory, errors (not found, access denied), etc.
  });

  describe('getMetadata - for URL source', () => {
    const baseWebParams: ReadTool.MetadataParams = {
      operation: 'metadata',
      sources: [testFileUrl],
    };

    it('should return success with URL metadata for a valid URL', async () => {
      const mockFetchContentResult = {
        // Renamed for clarity
        finalUrl: testFileUrl,
        mimeType: 'application/json', // fetchUrlContent returns mimeType directly
        headers: {
          'content-length': '5678',
          // 'content-type' is not directly returned by fetchUrlContent, mimeType is used
          'last-modified': 'Tue, 03 Jan 2023 12:00:00 GMT',
        },
        httpStatus: 200,
        error: null,
        content: Buffer.from(''), // Content buffer, not directly used for metadata but expected by type
        isBinary: false,
        size: 5678,
        isPartialContent: false,
        rangeRequestStatus: 'not_requested' as const,
      };
      // Corrected mock to use fetchUrlContent
      mockedWebFetcher.fetchUrlContent.mockResolvedValue(mockFetchContentResult);
      mockedFormatToISO.mockReturnValueOnce('2023-01-03T12:00:00.000Z'); // last-modified

      const result = (await getMetadata(
        testFileUrl,
        baseWebParams,
        mockedConfig as ConduitServerConfig
      )) as ReadTool.MetadataResultSuccess;

      expect(result.status).toBe('success');
      expect(result.source).toBe(testFileUrl);
      expect(result.source_type).toBe('url');
      expect(result.http_status_code).toBe(200);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.name).toBe('somefile.txt');
      expect(result.metadata.entry_type).toBe('url');
      expect(result.metadata.size_bytes).toBe(5678);
      expect(result.metadata.mime_type).toBe('application/json');
      expect(result.metadata.modified_at).toBe('2023-01-03T12:00:00.000Z');
      // Construct expected headers carefully based on what getMetadataFromUrl transforms
      const expectedHeaders = {
        'content-length': '5678',
        'last-modified': 'Tue, 03 Jan 2023 12:00:00 GMT',
      };
      expect(result.metadata.http_headers).toEqual(expectedHeaders);
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testFileUrl, true, undefined);
    });

    // More tests for URL source: redirects, errors (404, 500, network error), etc.
  });
});