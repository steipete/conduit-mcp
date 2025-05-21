/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset, when } from 'vitest-mock-extended';
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
import * as path from 'path';

// Mock @/internal
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  const loggerForInternalMock = mockDeep<import('pino').Logger>();
  // @ts-ignore
  loggerForInternalMock.child.mockReturnValue(loggerForInternalMock);

  const mockedConfigLoader = mockDeep<typeof import('@/internal').configLoader>();
  
  // Define a plain object for conduitConfig within the mock factory scope
  const plainTestConfig: ConduitServerConfig = {
    maxFileReadBytes: 1024 * 1024,
    maxUrlDownloadSizeBytes: 1024 * 1024,
    imageCompressionQuality: 80,
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 10,
    workspacePath: '/test/workspace', // Crucial: ensure this is a string
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
  // @ts-expect-error - Assign plain object to the mocked configLoader
  mockedConfigLoader.conduitConfig = plainTestConfig;
  
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
  const testConfig = configLoader.conduitConfig as ConduitServerConfig;
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

    mockedLogger.info.mockImplementation((msg, ...args) => console.log('[TEST INFO]', msg, ...args));
    mockedLogger.error.mockImplementation((msg, ...args) => console.error('[TEST ERROR]', msg, ...args));
    mockedLogger.debug.mockImplementation((msg, ...args) => console.log('[TEST DEBUG]', msg, ...args));
    mockedLogger.warn.mockImplementation((msg, ...args) => console.warn('[TEST WARN]', msg, ...args));

    // Reset the plain testConfig object using values from defaultTestConfig
    Object.assign(testConfig, defaultTestConfig);
    
    // Reset all methods on mockedFsOps individually
    Object.keys(mockedFsOps).forEach(key => {
        const method = mockedFsOps[key as keyof typeof mockedFsOps];
        if (typeof method === 'function' && 'mockReset' in method) {
            (method as MockedFunction<any>).mockReset();
        }
    });
    // Provide default implementations after reset if necessary, or let tests set them up.
    // For example, if a common successful return is needed unless overridden:
    mockedFsOps.createDirectory.mockResolvedValue(undefined);
    mockedFsOps.writeFile.mockImplementation(async () => 0); // Default: returns 0 bytes written
    mockedFsOps.pathExists.mockResolvedValue(false); // Default: path does not exist

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
      mockedFsOps.createDirectory.mockResolvedValue(undefined);
      mockedFsOps.writeFile.mockResolvedValue(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedChecksum');

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'overwrite' };
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(baseEntry.content as string).length);
      expect(result.checksum).toBe('mockedChecksum');
      expect(result.checksum_algorithm_used).toBe(testConfig.defaultChecksumAlgorithm);
      expect(mockedFsOps.createDirectory).toHaveBeenCalledWith(testFilePath.substring(0, testFilePath.lastIndexOf('/')), true);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(baseEntry.content as string), undefined, 'overwrite');
      expect(mockedCalculateChecksum).toHaveBeenCalledWith(Buffer.from(baseEntry.content as string), testConfig.defaultChecksumAlgorithm);
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
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(base64Content, 'base64').length);
      expect(result.checksum).toBe('mockedBase64Checksum');
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(base64Content, 'base64'), undefined, 'overwrite');
    });

    it('should successfully append text content', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockImplementationOnce(async (path, buffer, encoding, mode) => {
        if (mode === 'append') {
          return (buffer as Buffer).length;
        }
        throw new Error(`writeFile mock in append test called with mode: ${mode} instead of \'append\'. Path: ${path}`);
      });
      mockedCalculateChecksum.mockResolvedValueOnce('mockedAppendChecksum');

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'append' };
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

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
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(mockedFsOps.pathExists).toHaveBeenCalledWith(testFilePath);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(baseEntry.content as string), undefined, 'overwrite');
    });

    it('should return error in error_if_exists mode when file does exist', async () => {
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.pathExists.mockImplementationOnce(async (path) => {
        if (path === testFilePath) return true;
        throw new Error(`pathExists mock in error_if_exists test called with wrong path: ${path}`);
      });

      const entry: WriteTool.PutEntry = { ...baseEntry, write_mode: 'error_if_exists' };
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultItem;

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
        const result = await putContent(entry, testConfig);
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
        const result = await putContent(entry, testConfig);
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

      const result = await putContent(baseEntry, testConfig);
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

      const result = await putContent(baseEntry, testConfig);
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
      mockedCalculateChecksum.mockRejectedValueOnce(new ConduitError(ErrorCode.ERR_CHECKSUM_FAILED, "Checksumming failed badly"));

      const result = await putContent(baseEntry, testConfig) as PutContentChecksumErrorResult;
      expect(result.status).toBe('error');
      expect(result.path).toBe(baseEntry.path);
      expect(result.bytes_written).toBe(Buffer.from(baseEntry.content as string).length);
      expect(result.error_code).toBe(ErrorCode.ERR_CHECKSUM_FAILED);
      expect(result.error_message).toContain("Checksumming failed badly");
    });

    it('should return error if input_encoding is base64 but content is not a string', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 12345 as any, // Not a string
      };
      const result = await putContent(entry, testConfig);
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
      mockedFsOps.pathExists.mockResolvedValue(false);
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
      expect(resultItem.status).toBe('error');
      if (resultItem.status === 'error') {
        expect(resultItem.error_code).toBe(ErrorCode.ERR_INVALID_BASE64);
        expect(resultItem.error_message).toContain("Invalid base64 content");
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
      testConfig.maxFileReadBytes = 1024;

      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('put');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), undefined, 'overwrite');
    });

    it('should successfully write a base64 encoded file', async () => {
      const textContent = "Hello Base64 Again";
      const base64Content = Buffer.from(textContent).toString('base64');
      mockedFsOps.createDirectory.mockResolvedValue(undefined);
      mockedFsOps.writeFile.mockResolvedValue(Buffer.from(base64Content, 'base64').length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockedBase64Checksum2');

      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: base64Content,
        write_mode: 'overwrite'
      };
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content!, 'base64').length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content!, 'base64'), undefined, 'overwrite');
    });

    it('should successfully append to an existing file', async () => {
      const initialContent = "Initial line.\n";
      const appendContent = "Appended line.";
      const fullContent = initialContent + appendContent;
      const testFilePath = path.join(testConfig.workspacePath, 'append_test.txt');

      mockedFsOps.createDirectory.mockResolvedValue(undefined); // Allow multiple calls

      // Mock for initial write (implicitly overwrite)
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(initialContent).length);
      mockedCalculateChecksum.mockResolvedValueOnce('initialChecksum');

      // Initial write to set up the file
      await putContent(
        { path: testFilePath, content: initialContent, write_mode: 'overwrite', input_encoding: 'text' }, 
        testConfig
      );

      // Reset writeFile for the append operation, or make it more specific
      // For the append operation
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(appendContent).length);
      mockedCalculateChecksum.mockResolvedValueOnce('appendedChecksum');
      
      const appendEntry: WriteTool.PutEntry = {
        path: testFilePath,
        content: appendContent,
        write_mode: 'append',
        input_encoding: 'text' 
      };

      const result = await putContent(appendEntry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(appendContent).length);
      // Verify writeFile was called with 'append' mode for the second call
      // The first call was overwrite, the second (index 1) should be append.
      expect(mockedFsOps.writeFile.mock.calls[1][3]).toBe('append'); 
      // Optionally, check content if we could read it back, or trust bytes_written
    });

    it('should calculate checksum if algorithm is provided', async () => {
      mockedFsOps.createDirectory.mockResolvedValue(undefined);
      mockedFsOps.writeFile.mockResolvedValue(Buffer.from(baseEntry.content as string).length);
      mockedCalculateChecksum.mockResolvedValueOnce('mockchecksum');

      const entry: WriteTool.PutEntry = {
        ...baseEntry,
        checksum_algorithm: 'sha1',
      };
      const result = await putContent(entry, testConfig) as WriteTool.WriteResultSuccess;

      expect(result.status).toBe('success');
      expect(result.path).toBe(testFilePath);
      expect(result.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), undefined, 'overwrite');
      expect(calculateChecksum).toHaveBeenCalledWith(Buffer.from(entry.content as string), entry.checksum_algorithm);
      expect(result.checksum).toBe('mockchecksum');
      expect(result.checksum_algorithm_used).toBe('sha1');
    });

    it('should return error if file exists and write_mode is error_if_exists', async () => {
      const testFilePath = path.join(testConfig.workspacePath, 'error_if_exists_test.txt');
      mockedFsOps.createDirectory.mockResolvedValue(undefined); 
      
      mockedFsOps.pathExists.mockResolvedValueOnce(true);
      mockedFsOps.writeFile.mockImplementationOnce(() => {
        throw new Error('writeFile should not have been called in error_if_exists mode when file exists');
      });

      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'text',
        content: 'Hello, world!',
        write_mode: 'error_if_exists'
      };
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
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
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
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
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
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
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(baseEntry, testConfig) as WriteTool.WriteResultItem;
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
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(baseEntry, testConfig);
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
      testConfig.maxFileReadBytes = 1024;
      // This test is to ensure that if calculateChecksum throws a generic error AFTER a successful write,
      // we correctly capture the bytes_written and report a checksum failure.
      mockedFsOps.createDirectory.mockResolvedValueOnce(undefined);
      mockedFsOps.writeFile.mockResolvedValueOnce(Buffer.from(entry.content as string).length);
      // Change to mockRejectedValueOnce for consistency and to ensure isConduitError is picked up
      (calculateChecksum as Mock).mockRejectedValueOnce(
        new ConduitError(ErrorCode.ERR_CHECKSUM_FAILED, "Checksumming failed badly after write")
      );

      const resultItem = await putContent(entry, testConfig) as PutContentChecksumErrorResult;

      expect(resultItem.status).toBe('error');
      expect(resultItem.action_performed).toBe('put');
      expect(resultItem.path).toBe(testFilePath);
      expect(resultItem.bytes_written).toBe(Buffer.from(entry.content as string).length);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(testFilePath, Buffer.from(entry.content as string), undefined, 'overwrite');
      expect(calculateChecksum).toHaveBeenCalledWith(Buffer.from(entry.content as string), testConfig.defaultChecksumAlgorithm);
      expect(resultItem.error_code).toBe(ErrorCode.ERR_CHECKSUM_FAILED);
      expect(resultItem.error_message).toContain("Checksumming failed badly after write");
    });

    it('should return error if content is not string for base64 encoding', async () => {
      const entry: WriteTool.PutEntry = {
        path: testFilePath,
        input_encoding: 'base64',
        content: 12345 as any, // Not a string
      };
      mockedFsOps.pathExists.mockResolvedValue(false);
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
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
      testConfig.maxFileReadBytes = 1024;

      const resultItem = await putContent(entry, testConfig) as WriteTool.WriteResultItem;
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