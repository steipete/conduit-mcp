/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import * as fsPromises from 'fs/promises';
import {
  putContent,
} from '@/operations/putContentOps';
import {
  ConduitError,
  ErrorCode,
  logger as internalLogger,
  configLoader,
  fileSystemOps,
  calculateChecksum,
  WriteTool,
  MCPErrorStatus,
  ConduitServerConfig,
  MCPSuccess,
} from '@/internal';
import { createHash } from 'node:crypto';
import type { Mock } from 'vitest';
import { assert } from 'vitest';

// Mock @/internal
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  const loggerForInternalMock = mockDeep<import('pino').Logger>();
  // @ts-ignore
  loggerForInternalMock.child.mockReturnValue(loggerForInternalMock);

  const mockedConfigLoader = mockDeep<typeof import('@/internal').configLoader>();
  // @ts-expect-error
  mockedConfigLoader.conduitConfig = mockDeep<ConduitServerConfig>();
  
  return {
    ...original,
    logger: loggerForInternalMock,
    configLoader: mockedConfigLoader,
    fileSystemOps: mockDeep<typeof fileSystemOps>(),
    calculateChecksum: vi.fn(),
    // Add any other specific mocks from @/internal if needed by putContentOps
  };
});

// Mock fs/promises if direct fs calls are made (putContentOps primarily uses fileSystemOps)
vi.mock('fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return {
    ...original,
    // Add specific fs/promises mocks if needed, e.g., open, writeFile, appendFile, unlink
    // Though prefer mocking fileSystemOps from @/internal
  };
});

// Define a more specific type for the error result in the checksum failure case
interface PutContentChecksumErrorResult extends MCPErrorStatus {
  action_performed: 'put';
  path: string;
  bytes_written?: number;
}

describe('putContentOps', () => {
  const mockedLogger = internalLogger as DeepMockProxy<import('pino').Logger>;
  const mockedConfig = configLoader.conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedFsOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;
  const mockedCalculateChecksum = calculateChecksum as MockedFunction<typeof calculateChecksum>;

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
  };

  const testFilePath = '/test/workspace/output.txt';

  beforeEach(() => {
    mockReset(mockedLogger);
    // @ts-ignore
    if (mockedLogger.child && typeof mockedLogger.child.mockReset === 'function') {
        // @ts-ignore
        mockedLogger.child.mockReset();
    }
    // @ts-ignore
    mockedLogger.child.mockReturnValue(mockedLogger);
    
    mockReset(mockedConfig as any);
    Object.assign(mockedConfig, defaultTestConfig);
    mockReset(mockedFsOps);
    mockedCalculateChecksum.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('putContent', () => {
    const baseEntry: WriteTool.PutEntry = {
      path: testFilePath,
      input_encoding: 'text',
      content: 'Hello, world!',
    };

    it('should successfully write text content in overwrite mode', async () => {
      mockedFsOps.ensureDirectoryExists.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedChecksum');

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'overwrite' };
      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(baseEntry.content as string).length);
      expect(result.checksum).toBe('mockedChecksum');
      expect(result.checksum_algorithm_used).toBe(mockedConfig.defaultChecksumAlgorithm);
      expect(mockedFsOps.createDirectory).toHaveBeenCalledWith(testFilePath.substring(0, testFilePath.lastIndexOf('/')), true);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(baseEntry.content as string), undefined, 'overwrite');
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(Buffer.from(baseEntry.content as string), mockedConfig.defaultChecksumAlgorithm);
    });

    it('should successfully write base64 content in overwrite mode', async () => {
      const textContent = "Hello Base64";
      const base64Content = Buffer.from(textContent).toString('base64');
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(base64Content, 'base64').length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedBase64Checksum');

      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: base64Content,
        write_mode: 'overwrite'
      };
      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(base64Content, 'base64').length);
      expect(result.checksum).toBe('mockedBase64Checksum');
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(base64Content, 'base64'), undefined, 'overwrite');
    });

    it('should successfully append text content', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedAppendChecksum');

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'append' };
      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.bytes_written).toBe(Buffer.from(baseEntry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(baseEntry.content as string), undefined, 'append');
    });

    it('should successfully write in error_if_exists mode when file does not exist', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.pathExists.mockResolvedValueOnce(false); // File does not exist
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedNewFileChecksum');

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'error_if_exists' };
      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(mockedFsOps.pathExists).toHaveBeenCalledWith(testFilePath);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(baseEntry.content as string), undefined, 'overwrite');
    });

    it('should return error in error_if_exists mode when file does exist', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.pathExists.mockResolvedValueOnce(true); // File exists

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'error_if_exists' };
      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error_code).toBe(ErrorCode.ERR_FS_ALREADY_EXISTS);
      } else {
        assert.fail('Expected error status');
      }
      expect(mockedFsOps.writeFile).not.toHaveBeenCalled();
    });

    it('should return error if content is undefined and not base64_gzipped_file_ref', async () => {
        const entry: WriteTool.PutEntry = {
            path: testFilePath,
            input_encoding: 'text',
            content: undefined as any, // Explicitly undefined
        };
        const result = await putContent(entry, mockedConfig);
        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
            expect(result.error_message).toContain("Missing 'content' for the given input_encoding.");
        } else {
            assert.fail('Expected error status');
        }
    });

    it('should return error for unsupported input_encoding', async () => {
        const entry: WriteTool.PutEntry = {
            path: testFilePath,
            input_encoding: 'utf16' as any, // Unsupported
            content: 'test',
        };
        const result = await putContent(entry, mockedConfig);
        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
            expect(result.error_message).toContain("Unsupported input_encoding: utf16");
        } else {
            assert.fail('Expected error status');
        }
    });

    it('should return error if createDirectory fails', async () => {
      const fsError = new ConduitError(ErrorCode.OPERATION_FAILED, "Cannot create dir");
      mockedFsOps.createDirectory.mockRejectedValueOnce(fsError);

      const result = await putContent(baseEntry, mockedConfig);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error_code).toBe(ErrorCode.OPERATION_FAILED);
        expect(result.error_message).toContain("Cannot create dir");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error if writeFile fails', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      const fsError = new ConduitError(ErrorCode.ERR_FS_WRITE_FAILED, "Disk full");
      mockedFsOps.writeFile.mockRejectedValueOnce(fsError);

      const result = await putContent(baseEntry, mockedConfig);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error_code).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
        expect(result.error_message).toContain("Disk full");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error if calculateChecksum fails', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockRejectedValueOnce(new Error("Checksumming failed badly"));

      const result = await putContent(baseEntry, mockedConfig) as PutContentChecksumErrorResult;
      expect(result.status).toBe('error');
      // This will be wrapped by putContent into a ConduitError
      expect(result.path).toBe(baseEntry.path);
      expect(result.bytes_written).toBe(Buffer.from(baseEntry.content as string).length);
      expect(result.error_code).toBe(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(result.error_message).toContain("Checksumming failed badly");
    });

    it('should return error if input_encoding is base64 but content is not a string', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 12345 as any, // Not a string
      };
      const result = await putContent(entry, mockedConfig);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(result.error_message).toContain("Content for base64 input_encoding must be a string");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error for invalid base64 content', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 'This is not valid base64!@#',
      };
      const result = await putContent(entry, mockedConfig);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error_code).toBe(ErrorCode.ERR_INVALID_BASE64);
        expect(result.error_message).toContain("Invalid base64 content");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should successfully write a text file', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content as string).length);
      mockedConfig.maxFileReadBytes = 1024;

      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('put');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), undefined, 'overwrite');
    });

    it('should successfully write a base64 encoded file', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: Buffer.from('Hello, world!').toString('base64'),
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content!, 'base64').length);
      mockedConfig.maxFileReadBytes = 1024;

      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('put');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content!, 'base64').length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content!, 'base64'), 'utf8', 'overwrite');
    });

    it('should successfully append to an existing file', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
      };
      mockedFsOps.pathExists.mockResolvedValue(true); // File exists
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content as string).length);
      mockedConfig.maxFileReadBytes = 1024;

      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('put');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), undefined, 'append');
    });

    it('should calculate checksum if algorithm is provided', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
        checksum_algorithm: 'sha256'
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content as string).length);
      mockedConfig.maxFileReadBytes = 1024;
      (calculateChecksum as Mock).mockResolvedValue('mockchecksum');

      const result = await putContent(entry, mockedConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('put');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), 'utf8', 'overwrite');
      expect(calculateChecksum).toHaveBeenCalledWith(Buffer.from(entry.content as string), entry.checksum_algorithm);
      expect(result.checksum).toBe('mockchecksum');
      expect(result.checksum_algorithm_used).toBe('sha256');
    });

    it('should return error if file exists and write_mode is error_if_exists', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
      };
      mockedFsOps.pathExists.mockResolvedValue(true); // File exists
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.action_performed).toBe('put');
        expect(resultItem.error_code).toBe(ErrorCode.ERR_FS_ALREADY_EXISTS);
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error for missing content with text encoding', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: undefined as any, // Explicitly undefined
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(resultItem.error_message).toContain("Missing 'content' for the given input_encoding.");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error for unsupported input_encoding', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'utf16' as any, // Unsupported
        content: 'test',
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(resultItem.error_message).toContain("Unsupported input_encoding: utf16");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error if fsOps.writeFile throws ConduitError', async () => {
      const fsError = new ConduitError(ErrorCode.OPERATION_FAILED, "Cannot create dir");
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockRejectedValueOnce(fsError);
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(baseEntry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      const errorResult = resultItem as WriteTool.WriteResultItem;
      if (errorResult.status === 'error') {
        expect(errorResult.error_code).toBe(ErrorCode.OPERATION_FAILED);
        expect(errorResult.error_message).toContain("Cannot create dir");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error if fsOps.writeFile throws a generic error', async () => {
      const genericErrorMessage = "Disk full due to underlying issue";
      const wrappedError = new ConduitError(ErrorCode.ERR_FS_WRITE_FAILED, genericErrorMessage);
      
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockRejectedValueOnce(wrappedError); 
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(baseEntry, mockedConfig);
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
        expect(resultItem.error_message).toContain(genericErrorMessage);
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should handle error during checksum calculation after successful write', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content as string).length);
      mockedConfig.maxFileReadBytes = 1024;
      (calculateChecksum as Mock).mockImplementationOnce(async () => { throw new Error('Checksumming failed badly'); });

      const resultItem = await putContent(entry, mockedConfig) as PutContentChecksumErrorResult;

      expect(resultItem.status).toBe('error');
      expect(resultItem.action_performed).toBe('put');
      expect(resultItem.path).toBe(testFilePath);
      expect(resultItem.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), 'utf8', 'overwrite');
      expect(calculateChecksum).toHaveBeenCalledWith(Buffer.from(entry.content as string), mockedConfig.defaultChecksumAlgorithm);
      expect(resultItem.error_code).toBe(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(resultItem.error_message).toContain("Checksumming failed badly");
    });

    it('should return error if content is not string for base64 encoding', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 12345 as any, // Not a string
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(resultItem.error_message).toContain("Content for base64 input_encoding must be a string");
      } else {
        assert.fail('Expected error status');
      }
    });

    it('should return error for invalid base64 content', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 'This is not valid base64!@#',
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      mockedConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, mockedConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.ERR_INVALID_BASE64);
        expect(resultItem.error_message).toContain("Invalid base64 content");
      } else {
        assert.fail('Expected error status');
      }
    });

    // More tests will go here for different modes, content formats, errors, etc.
  });
}); 