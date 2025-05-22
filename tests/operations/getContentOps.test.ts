/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
// Removed unused Readable import
import { getContent } from '@/operations/getContentOps';

// Import necessary items from @/internal.
// The logger from here will be specifically mocked for getContentOps.
import {
  ConduitError,
  ErrorCode,
  logger as internalLogger, // Alias to avoid conflict if we define a local 'logger'
  conduitConfig,
  fileSystemOps,
  webFetcher,
  imageProcessor,
  calculateChecksum,
  getMimeType,
  ReadTool,
  MCPErrorStatus,
  getCurrentISO8601UTC,
  ConduitServerConfig,
  FetchedContent,
  validateAndResolvePath,
} from '@/internal';

// No global vi.mock('@/utils/logger') here.

// Mock @/internal specifically for this test suite.
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();

  const loggerMock = mockDeep<import('pino').Logger<string>>();
  loggerMock.child.mockReturnValue(loggerMock);

  const conduitConfigMock = mockDeep<ConduitServerConfig>();

  const imageProcessorMock = mockDeep<typeof originalModule.imageProcessor>();

  // Return the mock structure: spread original, then override with mocks.
  return {
    ...originalModule, // Pass through all original exports by default

    // Override with specific mocks
    logger: loggerMock,
    conduitConfig: conduitConfigMock,
    fileSystemOps: mockDeep<typeof originalModule.fileSystemOps>(),
    webFetcher: mockDeep<typeof originalModule.webFetcher>(),
    imageProcessor: imageProcessorMock,
    calculateChecksum: vi.fn(),
    getMimeType: vi.fn(),
    getCurrentISO8601UTC: vi.fn(() => '2023-01-01T00:00:00.000Z'),
    validateAndResolvePath: vi.fn(),

    // ConduitError, ErrorCode, ReadTool should be passed through from originalModule via the spread.
    // No need to list them separately if they are correctly exported from @/internal/index.ts
  };
});

// Mock fs/promises
vi.mock('fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return {
    ...original,
    open: vi.fn(),
    stat: vi.fn(),
  };
});

describe('getContentOps', () => {
  // This mockedLogger will be the one provided to getContentOps via the @/internal mock.
  const mockedLogger = internalLogger as DeepMockProxy<import('pino').Logger>;
  const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedFsOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;
  const mockedWebFetcher = webFetcher as DeepMockProxy<typeof webFetcher>;
  const mockedImageProcessorRef = imageProcessor as DeepMockProxy<typeof imageProcessor>;
  const mockedCalculateChecksum = calculateChecksum as MockedFunction<typeof calculateChecksum>;
  const mockedGetMimeType = getMimeType as MockedFunction<typeof getMimeType>;
  const mockedFsOpen = fsPromises.open as MockedFunction<typeof fsPromises.open>;
  const mockedGetCurrentISO8601UTC = getCurrentISO8601UTC as MockedFunction<
    typeof getCurrentISO8601UTC
  >;
  const mockedValidateAndResolvePath = validateAndResolvePath as MockedFunction<typeof validateAndResolvePath>;

  const defaultTestConfig: ConduitServerConfig = {
    maxFileReadBytes: 1024 * 1024,
    maxUrlDownloadSizeBytes: 1024 * 1024,
    imageCompressionQuality: 80,
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 10,
    workspaceRoot: '/test/workspace',
    allowedPaths: ['/test/workspace'],
    serverVersion: '1.0.0',
    serverStartTimeIso: '2023-01-01T00:00:00.000Z',
    logLevel: 'INFO',
    maxFileReadBytesFind: 10000,
    imageCompressionThresholdBytes: 1024,
    httpTimeoutMs: 30000,
    maxPayloadSizeBytes: 10485760,
    recursiveSizeTimeoutMs: 60000,
    userDidSpecifyAllowedPaths: false,
    resolvedAllowedPaths: ['/test/workspace'],
  };

  beforeEach(() => {
    mockReset(mockedLogger);
    // @ts-ignore - This might be an issue if loggerMock.child is not a mock itself.
    // The new loggerMock setup ensures .child returns the mock, so this should be fine.
    if (mockedLogger.child && typeof mockedLogger.child.mockReset === 'function') {
      // @ts-ignore
      mockedLogger.child.mockReset();
    }
    // @ts-ignore
    mockedLogger.child.mockReturnValue(mockedLogger);

    // Reset the conduitConfig mock
    // The mockedConfig alias points to conduitConfig
    // So, resetting mockedConfig effectively resets the conduitConfig mock.
    mockReset(mockedConfig as any);
    Object.assign(mockedConfig, defaultTestConfig); // Re-apply defaults

    mockReset(mockedFsOps);
    mockReset(mockedWebFetcher);
    mockReset(mockedImageProcessorRef);
    mockedCalculateChecksum.mockReset();
    mockedGetMimeType.mockReset();
    mockedFsOpen.mockReset();
    mockedGetCurrentISO8601UTC.mockReturnValue('2023-01-01T00:00:00.000Z');
    mockedValidateAndResolvePath.mockReset();
    
    // Default mock for validateAndResolvePath
    mockedValidateAndResolvePath.mockImplementation(async (inputPath: string) => {
      if (inputPath.startsWith('/')) {
        return inputPath;
      }
      return `/test/workspace/${inputPath}`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // MODIFIED: Changed describe to be for 'getContent' and nested file/URL tests
  describe('from File source (via getContent)', () => {
    const filePath = '/test/workspace/file.txt';
    const baseParams: ReadTool.ContentParams = {
      // This baseParams is for file tests
      operation: 'content',
      sources: [filePath],
    };

    it('should return error if source is a directory', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => false,
        isDirectory: () => true,
      } as fs.Stats);

      const params: ReadTool.ContentParams = { ...baseParams };
      // MODIFIED: Call getContent instead of getContentFromFile
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_FS_PATH_IS_DIR);
      expect(errorResult.source).toBe(filePath);
      expect(errorResult.source_type).toBe('file');
    });

    it('should default to "text" format for text-like MIME types', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('Hello world'));

      const params: ReadTool.ContentParams = { ...baseParams };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe('Hello world');
      expect(mockedFsOps.readFileAsBuffer).toHaveBeenCalledWith(
        filePath,
        mockedConfig.maxFileReadBytes
      );
    });

    it('should default to "base64" format for non-text-like MIME types', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('application/octet-stream');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('SGVsbG8gd29ybGQ=', 'base64'));

      const params: ReadTool.ContentParams = { ...baseParams };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('base64');
      expect(result.content).toBe('SGVsbG8gd29ybGQ=');
      expect(mockedFsOps.readFileAsBuffer).toHaveBeenCalledWith(
        filePath,
        mockedConfig.maxFileReadBytes
      );
    });

    it('should use specified "text" format', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('Test content'));

      const params: ReadTool.ContentParams = { ...baseParams, format: 'text' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe('Test content');
    });

    it('should use specified "base64" format', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('VGVzdCBjb250ZW50', 'base64'));

      const params: ReadTool.ContentParams = { ...baseParams, format: 'base64' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('base64');
      expect(result.content).toBe('VGVzdCBjb250ZW50');
    });

    it('should handle "checksum" format', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const checksumValue = 'mockedChecksum';
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 123,
      } as fs.Stats);
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('some data for checksum'));
      mockedCalculateChecksum.mockResolvedValueOnce(checksumValue);

      const params: ReadTool.ContentParams = {
        ...baseParams,
        format: 'checksum',
        checksum_algorithm: 'sha1',
      };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('checksum');
      expect(result.checksum).toBe(checksumValue);
      expect(result.checksum_algorithm_used).toBe('sha1');
      expect(result.size_bytes).toBe(Buffer.from('some data for checksum').length);
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(
        Buffer.from('some data for checksum'),
        'sha1'
      );
    });

    it('should handle "checksum" format with default algorithm', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const checksumValue = 'defaultAlgoChecksum';
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 123,
      } as fs.Stats);
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('data for default checksum'));
      mockedCalculateChecksum.mockResolvedValueOnce(checksumValue);
      (mockedConfig as any).defaultChecksumAlgorithm = 'md5';

      const params: ReadTool.ContentParams = { ...baseParams, format: 'checksum' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.checksum_algorithm_used).toBe('md5');
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(
        Buffer.from('data for default checksum'),
        'md5'
      );
      (mockedConfig as any).defaultChecksumAlgorithm = defaultTestConfig.defaultChecksumAlgorithm;
    });

    it('should handle range requests for "text" format', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const fileContent = 'This is a long line of text for range testing.';
      const offset = 5;
      const length = 10;
      const expectedSubstring = fileContent.substring(offset, offset + length);

      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: fileContent.length,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');

      const mockFileHandle = {
        read: vi
          .fn()
          .mockImplementation(async (bufferToFill, bufferOffset, bytesToRead, _filePosition) => {
            const sourceBuffer = Buffer.from(expectedSubstring);
            sourceBuffer.copy(
              bufferToFill,
              bufferOffset,
              0,
              Math.min(bytesToRead, sourceBuffer.length)
            );
            return { bytesRead: Math.min(bytesToRead, sourceBuffer.length), buffer: bufferToFill };
          }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      (fsPromises.open as MockedFunction<typeof fsPromises.open>).mockResolvedValueOnce(
        mockFileHandle as any
      );

      const params: ReadTool.ContentParams = { ...baseParams, format: 'text', offset, length };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.content).toBe(expectedSubstring);
      expect(result.range_request_status).toBeUndefined();
      expect(fsPromises.open).toHaveBeenCalledWith(filePath, 'r');
      expect(mockFileHandle.read).toHaveBeenCalledWith(expect.any(Buffer), 0, length, offset);
    });

    it('should handle range requests for "base64" format', async () => {
      // Mock validateAndResolvePath to return the path
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const fileContent = 'BinaryDataForRangeTest';
      const offset = 3;
      const length = 6;
      const fileBuffer = Buffer.from(fileContent);
      const expectedSlice = fileBuffer.slice(offset, offset + length);

      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: fileBuffer.length,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('application/octet-stream');

      const mockFileHandle = {
        read: vi
          .fn()
          .mockImplementation(async (bufferToFill, bufferOffset, bytesToRead, _filePosition) => {
            expectedSlice.copy(
              bufferToFill,
              bufferOffset,
              0,
              Math.min(bytesToRead, expectedSlice.length)
            );
            return { bytesRead: Math.min(bytesToRead, expectedSlice.length), buffer: bufferToFill };
          }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      (fsPromises.open as MockedFunction<typeof fsPromises.open>).mockResolvedValueOnce(
        mockFileHandle as any
      );

      const params: ReadTool.ContentParams = { ...baseParams, format: 'base64', offset, length };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.content).toBe(expectedSlice.toString('base64'));
      expect(result.range_request_status).toBeUndefined();
      expect(fsPromises.open).toHaveBeenCalledWith(filePath, 'r');
      expect(mockFileHandle.read).toHaveBeenCalledWith(expect.any(Buffer), 0, length, offset);
    });

    it('should return error if fs.stat fails', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      // Simulate the error that fileSystemOps.getStats would throw
      const originalFsError = new Error('FS stat failed'); // The message from the raw fs error
      const expectedConduitErrorMessage = `Failed to get stats for path: ${filePath}. Error: ${originalFsError.message}`;
      const conduitStatError = new ConduitError(
        ErrorCode.OPERATION_FAILED,
        expectedConduitErrorMessage
      );

      mockedFsOps.getStats.mockRejectedValueOnce(conduitStatError);

      const params: ReadTool.ContentParams = { ...baseParams };
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.OPERATION_FAILED);
      expect(errorResult.error_message).toBe(expectedConduitErrorMessage);
    });

    it('should return error if getMimeType fails', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockRejectedValueOnce(new Error('MIME type detection failed'));

      const params: ReadTool.ContentParams = { ...baseParams };
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_FS_READ_FAILED);
      expect(errorResult.error_message).toContain('MIME type detection failed');
    });

    it('should return error if readFileAsString fails for text format (now fs.open or readFileAsBuffer)', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      const ReadError = new Error('Read failed') as NodeJS.ErrnoException;
      ReadError.code = 'ENOENT';
      mockedFsOps.readFileAsBuffer.mockRejectedValueOnce(ReadError);

      const params: ReadTool.ContentParams = { ...baseParams, format: 'text' };
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_FS_NOT_FOUND);
    });

    it('should return error if readFileAsBuffer fails for base64 format', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('application/pdf');
      const conduitReadError = new ConduitError(
        ErrorCode.ERR_FS_READ_FAILED,
        'Failed to read file due to EIO'
      );
      mockedFsOps.readFileAsBuffer.mockRejectedValueOnce(conduitReadError);

      const params: ReadTool.ContentParams = { ...baseParams, format: 'base64' };
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_FS_READ_FAILED);
      expect(errorResult.error_message).toContain('Failed to read file due to EIO');
    });

    it('should apply image compression for image MIME types and base64 format', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const originalImageData = Buffer.from('originalImageData');
      const compressedImageData = Buffer.from('compressedImageData');

      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('image/jpeg');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(originalImageData);
      mockedImageProcessorRef.compressImageIfNecessary.mockResolvedValueOnce({
        buffer: compressedImageData,
        original_size_bytes: originalImageData.length,
        compression_applied: true,
      });
      (mockedConfig as any).imageCompressionQuality = 70;
      (mockedConfig as any).imageCompressionThresholdBytes = 500;

      const params: ReadTool.ContentParams = { ...baseParams, format: 'base64' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('base64');
      expect(result.content).toBe(compressedImageData.toString('base64'));
      expect(result.compression_applied).toBe(true);
      expect(result.original_size_bytes).toBe(originalImageData.length);
      expect(result.size_bytes).toBe(compressedImageData.length);
      expect(mockedImageProcessorRef.compressImageIfNecessary).toHaveBeenCalledWith(
        originalImageData,
        'image/jpeg'
      );
      (mockedConfig as any).imageCompressionQuality = defaultTestConfig.imageCompressionQuality;
      (mockedConfig as any).imageCompressionThresholdBytes =
        defaultTestConfig.imageCompressionThresholdBytes;
    });

    it('should skip image compression if imageProcessor.compressImageIfNecessary fails', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      const originalImageData = Buffer.from('originalImageData');
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('image/png');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(originalImageData);
      mockedImageProcessorRef.compressImageIfNecessary.mockResolvedValueOnce({
        buffer: originalImageData,
        original_size_bytes: originalImageData.length,
        compression_applied: false,
        compression_error_note: 'Compression boom',
      });
      (mockedConfig as any).imageCompressionThresholdBytes = 500;

      const params: ReadTool.ContentParams = { ...baseParams, format: 'base64' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.content).toBe(originalImageData.toString('base64'));
      expect(result.compression_applied).toBe(false);
      expect(result.compression_error_note).toContain('Compression boom');
      (mockedConfig as any).imageCompressionThresholdBytes =
        defaultTestConfig.imageCompressionThresholdBytes;
    });

    it('should not apply image compression for non-image MIME types', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('some text data'));

      const params: ReadTool.ContentParams = { ...baseParams, format: 'text' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.compression_applied).toBeUndefined();
      expect(mockedImageProcessorRef.compressImageIfNecessary).not.toHaveBeenCalled();
    });

    it('should not apply image compression for "checksum" format', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as fs.Stats);
      mockedGetMimeType.mockResolvedValueOnce('image/gif');
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('checksum data'));
      mockedCalculateChecksum.mockResolvedValueOnce('checksum123');

      const params: ReadTool.ContentParams = { ...baseParams, format: 'checksum' };
      const result = (await getContent(
        filePath,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('checksum');
      expect(result.compression_applied).toBeUndefined();
      expect(mockedImageProcessorRef.compressImageIfNecessary).not.toHaveBeenCalled();
    });

    it('should return error if calculateChecksum fails', async () => {
      mockedValidateAndResolvePath.mockResolvedValueOnce(filePath);
      
      mockedFsOps.getStats.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 123,
      } as fs.Stats);
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('data'));
      mockedCalculateChecksum.mockRejectedValueOnce(new Error('Checksum calc error'));

      const params: ReadTool.ContentParams = {
        ...baseParams,
        format: 'checksum',
        checksum_algorithm: 'sha1',
      };
      const result = await getContent(filePath, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_CHECKSUM_FAILED);
      expect(errorResult.error_message).toContain('Checksum calc error');
    });
  });

  describe('from URL source (via getContent)', () => {
    const testUrl = 'http://example.com/test.txt';
    const baseParamsUrl: ReadTool.ContentParams = {
      // Renamed to avoid conflict
      operation: 'content',
      sources: [testUrl],
    };

    it('should successfully fetch text content from a URL', async () => {
      const mockFetchedContent: FetchedContent = {
        // Corrected type usage
        finalUrl: testUrl,
        content: Buffer.from('Hello from URL'),
        mimeType: 'text/plain',
        httpStatus: 200,
        headers: { 'content-type': 'text/plain' }, // Added example headers
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'text' };
      // MODIFIED: Call getContent with the URL
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.source).toBe(testUrl);
      expect(result.source_type).toBe('url');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe('Hello from URL');
      expect(result.mime_type).toBe('text/plain');
      expect(result.http_status_code).toBe(200);
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testUrl, false, undefined);
    });

    it('should default to "base64" format for non-text-like MIME types from URL', async () => {
      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from('BinaryData'),
        mimeType: 'application/octet-stream',
        httpStatus: 200,
        headers: { 'content-type': 'application/octet-stream' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

      const params: ReadTool.ContentParams = { ...baseParamsUrl }; // No format specified
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('base64');
      expect(result.content).toBe(Buffer.from('BinaryData').toString('base64'));
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testUrl, false, undefined);
    });

    it('should handle "checksum" format for URL content with specified algorithm', async () => {
      const checksumValue = 'urlMockedChecksumSha1';
      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from('some url data for checksum'),
        mimeType: 'application/octet-stream',
        httpStatus: 200,
        headers: { 'content-type': 'application/octet-stream' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
      mockedCalculateChecksum.mockResolvedValueOnce(checksumValue);

      const params: ReadTool.ContentParams = {
        ...baseParamsUrl,
        format: 'checksum',
        checksum_algorithm: 'sha1',
      };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('checksum');
      expect(result.checksum).toBe(checksumValue);
      expect(result.checksum_algorithm_used).toBe('sha1');
      expect(result.size_bytes).toBe(Buffer.from('some url data for checksum').length);
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(
        Buffer.from('some url data for checksum'),
        'sha1'
      );
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testUrl, false, undefined);
    });

    it('should handle "checksum" format for URL content with default algorithm', async () => {
      const checksumValue = 'urlDefaultAlgoChecksum';
      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from('data for url default checksum'),
        mimeType: 'text/plain',
        httpStatus: 200,
        headers: { 'content-type': 'text/plain' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
      mockedCalculateChecksum.mockResolvedValueOnce(checksumValue);
      (mockedConfig as any).defaultChecksumAlgorithm = 'sha512';

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'checksum' };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.checksum_algorithm_used).toBe('sha512');
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(
        Buffer.from('data for url default checksum'),
        'sha512'
      );
      (mockedConfig as any).defaultChecksumAlgorithm = defaultTestConfig.defaultChecksumAlgorithm;
    });

    it('should handle native range request for text from URL (server returns 206)', async () => {
      const fullContent = 'This is a long line of text from URL for range testing.';
      const offset = 5;
      const length = 10;
      const expectedSubstring = fullContent.substring(offset, offset + length);
      const rangeObject = { offset, length };

      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from(expectedSubstring), // Server sends only the range
        mimeType: 'text/plain',
        httpStatus: 206, // Partial Content
        headers: {
          'content-type': 'text/plain',
          'content-range': `bytes ${offset}-${offset + length - 1}/${fullContent.length}`,
        },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'text', offset, length };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe(expectedSubstring);
      expect(result.range_request_status).toBe('native');
      expect(result.size_bytes).toBe(expectedSubstring.length);
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testUrl, false, rangeObject);
    });

    it('should handle range request where server returns full content (200) and simulate range', async () => {
      const fullContent = 'Full content from URL despite range request.';
      const offset = 5;
      const length = 10;
      const expectedSubstring = fullContent.substring(offset, offset + length);
      const rangeObject = { offset, length };

      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from(fullContent), // Server sends full content
        mimeType: 'text/plain',
        httpStatus: 200, // OK, not 206
        headers: { 'content-type': 'text/plain' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'text', offset, length };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe(expectedSubstring);
      expect(result.range_request_status).toBe('simulated'); // Was full_content_returned then changed to simulated
      expect(result.size_bytes).toBe(expectedSubstring.length);
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(testUrl, false, rangeObject);
    });

    it('should simulate range if no range header sent but params specify range', async () => {
      const fullContent = 'Full content meant for checksum, but then used for text with range.';
      const offset = 10;
      const length = 15;
      const expectedSubstring = fullContent.substring(offset, offset + length);

      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from(fullContent), // Server sends full content
        mimeType: 'text/plain', // Discovered during processing
        httpStatus: 200,
        headers: { 'content-type': 'text/plain' },
      };
      // fetchUrlContent would be called with undefined rangeHeader because initial format might have been checksum/markdown
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

      // Params request a range and text format, simulating a scenario where full content was fetched
      // (e.g. for a prior checksum attempt) but then a ranged text view is needed.
      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'text', offset, length };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('text');
      expect(result.content).toBe(expectedSubstring);
      expect(result.range_request_status).toBe('simulated');
      expect(result.size_bytes).toBe(expectedSubstring.length);
      // Expect fetchUrlContent to have been called WITH a range object initially
      // because params.offset and params.length are set
      const expectedRangeObject = { offset, length };
      expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(
        testUrl,
        false,
        expectedRangeObject
      );
    });

    it('should return error if webFetcher.fetchUrlContent throws ConduitError for HTTP status', async () => {
      const fetchError = new ConduitError(
        ErrorCode.ERR_HTTP_STATUS_ERROR,
        'Request to http://example.com/test.txt failed with HTTP status 404. Message: Not Found'
      );
      (fetchError as any).httpStatus = 404;
      mockedWebFetcher.fetchUrlContent.mockRejectedValueOnce(fetchError);

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'text' };
      const result = await getContent(testUrl, params, mockedConfig);

      expect(result.status).toBe('error');
      // Corrected type casting for error result
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
        http_status_code?: number;
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_HTTP_STATUS_ERROR);
      expect(errorResult.error_message).toBe(
        'Request to http://example.com/test.txt failed with HTTP status 404. Message: Not Found'
      );
      expect(errorResult.http_status_code).toBe(404);
      expect(errorResult.source).toBe(testUrl);
      expect(errorResult.source_type).toBe('url');
    });

    it('should return error if calculateChecksum fails for URL content', async () => {
      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: Buffer.from('data for checksum from url'),
        mimeType: 'text/plain',
        httpStatus: 200,
        headers: { 'content-type': 'text/plain' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
      mockedCalculateChecksum.mockRejectedValueOnce(new Error('URL Checksum calc error'));

      const params: ReadTool.ContentParams = {
        ...baseParamsUrl,
        format: 'checksum',
        checksum_algorithm: 'sha1',
      };
      const result = await getContent(testUrl, params, mockedConfig);

      expect(result.status).toBe('error');
      const errorResult = result as MCPErrorStatus & {
        source: string;
        source_type: 'file' | 'url';
        http_status_code?: number;
      };
      expect(errorResult.error_code).toBe(ErrorCode.ERR_CHECKSUM_FAILED);
      expect(errorResult.error_message).toContain('URL Checksum calc error');
      expect(errorResult.source).toBe(testUrl);
      expect(errorResult.source_type).toBe('url');
      expect(errorResult.http_status_code).toBe(200); // The fetch itself was successful
    });

    it('should apply image compression for image MIME types from URL and base64 format', async () => {
      const originalImageData = Buffer.from('originalURLImageData');
      const compressedImageData = Buffer.from('compressedURLImageData');

      const mockFetchedContent: FetchedContent = {
        finalUrl: testUrl,
        content: originalImageData,
        mimeType: 'image/jpeg',
        httpStatus: 200,
        headers: { 'content-type': 'image/jpeg' },
      };
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
      mockedImageProcessorRef.compressImageIfNecessary.mockResolvedValueOnce({
        buffer: compressedImageData,
        original_size_bytes: originalImageData.length,
        compression_applied: true,
      });
      (mockedConfig as any).imageCompressionQuality = 75;
      (mockedConfig as any).imageCompressionThresholdBytes = 10; // Ensure compression is attempted

      const params: ReadTool.ContentParams = { ...baseParamsUrl, format: 'base64' };
      const result = (await getContent(
        testUrl,
        params,
        mockedConfig
      )) as ReadTool.ContentResultSuccess;

      expect(result.status).toBe('success');
      expect(result.output_format_used).toBe('base64');
      expect(result.content).toBe(compressedImageData.toString('base64'));
      expect(result.compression_applied).toBe(true);
      expect(result.original_size_bytes).toBe(originalImageData.length);
      expect(result.size_bytes).toBe(compressedImageData.length);
      expect(mockedImageProcessorRef.compressImageIfNecessary).toHaveBeenCalledWith(
        originalImageData, // In this non-ranged URL case, it receives the full fetched buffer
        'image/jpeg'
      );
      (mockedConfig as any).imageCompressionQuality = defaultTestConfig.imageCompressionQuality;
      (mockedConfig as any).imageCompressionThresholdBytes =
        defaultTestConfig.imageCompressionThresholdBytes;
    });

    describe('Markdown conversion from URL', () => {
      const htmlUrl = 'http://example.com/page.html';
      const htmlContent = '<html><body><h1>Title</h1><p>Some text.</p></body></html>';
      const expectedMarkdown = '# Title\n\nSome text.';

      it('should successfully convert HTML from URL to Markdown', async () => {
        const mockFetchedContent: FetchedContent = {
          finalUrl: htmlUrl,
          content: Buffer.from(htmlContent),
          mimeType: 'text/html',
          httpStatus: 200,
          headers: { 'content-type': 'text/html' },
        };
        mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
        // Assuming cleanHtmlToMarkdown is part of webFetcher namespace based on earlier usage in getContentOps
        mockedWebFetcher.cleanHtmlToMarkdown.mockReturnValueOnce(expectedMarkdown);

        const params: ReadTool.ContentParams = {
          ...baseParamsUrl,
          sources: [htmlUrl],
          format: 'markdown',
        };
        const result = (await getContent(
          htmlUrl,
          params,
          mockedConfig
        )) as ReadTool.ContentResultSuccess;

        expect(result.status).toBe('success');
        expect(result.output_format_used).toBe('markdown');
        expect(result.content).toBe(expectedMarkdown);
        expect(result.markdown_conversion_status).toBe('success');
        expect(mockedWebFetcher.cleanHtmlToMarkdown).toHaveBeenCalledWith(htmlContent, htmlUrl);
      });

      it('should return error if cleanHtmlToMarkdown throws an error', async () => {
        const mockFetchedContent: FetchedContent = {
          finalUrl: htmlUrl,
          content: Buffer.from(htmlContent),
          mimeType: 'text/html',
          httpStatus: 200,
          headers: { 'content-type': 'text/html' },
        };
        mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);
        const markdownError = new ConduitError(
          ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED,
          'Markdown conversion boom'
        );
        mockedWebFetcher.cleanHtmlToMarkdown.mockImplementationOnce(() => {
          throw markdownError;
        });

        const params: ReadTool.ContentParams = {
          ...baseParamsUrl,
          sources: [htmlUrl],
          format: 'markdown',
        };
        const result = await getContent(htmlUrl, params, mockedConfig);

        expect(result.status).toBe('error');
        const errorResult = result as MCPErrorStatus & {
          source: string;
          source_type: 'file' | 'url';
          http_status_code?: number;
        };
        expect(errorResult.error_code).toBe(ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED);
        expect(errorResult.error_message).toContain('Markdown conversion boom');
        expect(errorResult.http_status_code).toBe(200); // Fetch was fine
      });

      it('should handle non-HTML content type when Markdown is requested', async () => {
        const nonHtmlUrl = 'http://example.com/data.json';
        const jsonContent = '{"key": "value"}';
        const mockFetchedContent: FetchedContent = {
          finalUrl: nonHtmlUrl,
          content: Buffer.from(jsonContent),
          mimeType: 'application/json', // Non-HTML
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
        };
        mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce(mockFetchedContent);

        const params: ReadTool.ContentParams = {
          ...baseParamsUrl,
          sources: [nonHtmlUrl],
          format: 'markdown',
        };
        const result = (await getContent(
          nonHtmlUrl,
          params,
          mockedConfig
        )) as ReadTool.ContentResultSuccess;

        expect(result.status).toBe('success');
        // As per getContentOps, it stays 'markdown' format but content is null for non-HTML
        expect(result.output_format_used).toBe('markdown');
        expect(result.content).toBeNull();
        expect(result.markdown_conversion_status).toBe('skipped_unsupported_content_type');
        expect(result.markdown_conversion_skipped_reason).toContain(
          'Content type application/json is not HTML'
        );
        expect(mockedWebFetcher.cleanHtmlToMarkdown).not.toHaveBeenCalled();
      });
    });

    // More tests for getContentFromUrl will go here
  });

  // Removed commented test block
});
