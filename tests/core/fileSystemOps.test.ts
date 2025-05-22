import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import fsPromises from 'fs/promises'; // Keep for type inference
import type { Stats } from 'fs';
import path from 'path';
import { constants as fsConstants } from 'fs';
import * as fsExtra from 'fs-extra';
// Define default test config for the tests

// Import functions to test
import {
  pathExists,
  getStats,
  getLstats,
  readFileAsString,
  readFileAsBuffer,
  writeFile,
  createDirectory,
  deletePath,
  listDirectory,
  copyPath,
  movePath,
  touchFile,
  createEntryInfo,
  calculateRecursiveDirectorySize,
} from '@/core/fileSystemOps';

// Import dependencies to be mocked or used
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { EntryInfo, formatToISO8601UTC, getMimeType, conduitConfig, logger } from '@/internal';

// Mock the entire fs/promises module
vi.mock('fs/promises', () => {
  const fsMockFunctions = {
    access: vi.fn(),
    stat: vi.fn(),
    lstat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    cp: vi.fn(),
    rename: vi.fn(),
    utimes: vi.fn(),
    readlink: vi.fn(),
    realpath: vi.fn(), // Added realpath
  };
  return {
    ...fsMockFunctions,
    default: fsMockFunctions,
  };
});

// Create a more comprehensive mock for @/internal including conduitConfig
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<any>();

  // Create a mock config for testing specific to fileSystemOps
  const mockConduitConfig = {
    logLevel: 'INFO',
    allowedPaths: ['/test', '/tmp', '/var/tmp', process.cwd()],
    workspaceRoot: process.cwd(),
    httpTimeoutMs: 5000,
    maxPayloadSizeBytes: 1024 * 1024,
    maxFileReadBytes: 100, // Small enough for testing limits
    imageCompressionThresholdBytes: 1024 * 1024,
    imageCompressionQuality: 75,
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 5, // Small enough for testing depth limits
    recursiveSizeTimeoutMs: 1000, // Small enough for testing timeouts
    serverStartTimeIso: new Date().toISOString(),
    serverVersion: '1.0.0-test',
    maxUrlDownloadSizeBytes: 1024 * 1024,
    maxFileReadBytesFind: 1024 * 10,
  };

  // Return modified original with our mock overrides
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
    formatToISO8601UTC: vi.fn((date) => date.toISOString()),
  };
});

// We no longer mock @/core/configLoader directly - config comes from @/internal mock

// To access and reset these mocks, we need a reference.
// We import the mocked module. The functions will be our vi.fn() instances.
import * as fsPromisesActual from 'fs/promises';

// Create an alias for easier use in tests.
// We need to cast because the imported 'fsPromisesActual' will have the functions
// but not directly the vi.fn() mock controls like .mockResolvedValue for TypeScript.
// The default export will also contain these functions.
const mockFs = (fsPromisesActual as any).default as {
  access: MockedFunction<typeof import('fs/promises').access>;
  stat: MockedFunction<typeof import('fs/promises').stat>;
  lstat: MockedFunction<typeof import('fs/promises').lstat>;
  readFile: MockedFunction<typeof import('fs/promises').readFile>;
  writeFile: MockedFunction<typeof import('fs/promises').writeFile>;
  appendFile: MockedFunction<typeof import('fs/promises').appendFile>;
  mkdir: MockedFunction<typeof import('fs/promises').mkdir>;
  rm: MockedFunction<typeof import('fs/promises').rm>;
  unlink: MockedFunction<typeof import('fs/promises').unlink>;
  readdir: MockedFunction<typeof import('fs/promises').readdir>;
  cp: MockedFunction<typeof import('fs/promises').cp>;
  rename: MockedFunction<typeof import('fs/promises').rename>;
  utimes: MockedFunction<typeof import('fs/promises').utimes>;
  readlink: MockedFunction<typeof import('fs/promises').readlink>;
  realpath: MockedFunction<typeof import('fs/promises').realpath>; // Added realpath
};

describe('fileSystemOps', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clears call counts, mock implementations, etc.

    // Provide default implementations for commonly used fs functions
    mockFs.realpath.mockImplementation(async (p) => p.toString()); // Default pass-through
    mockFs.access.mockResolvedValue(undefined); // Default: path exists
    mockFs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 100, mode: 0o644, mtime: new Date(), birthtime: new Date() } as Stats);
    mockFs.lstat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 100, mode: 0o644, mtime: new Date(), birthtime: new Date() } as Stats);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.appendFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.rm.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.cp.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.utimes.mockResolvedValue(undefined);
    mockFs.readlink.mockResolvedValue('');

    // Reset specific mock implementations if they were changed in a test
    // For example, if a test makes mockFs.stat throw an error once:
    // mockFs.stat.mockReset().mockResolvedValue({ isDirectory: () => false, size: 100 } as Stats);
    // Reset fs.stat specifically as it's used by readFileAs*
    // mockFs.stat.mockReset(); // Covered by default mock now
    // mockFs.lstat.mockReset(); // Covered by default mock now
    // mockFs.writeFile.mockReset(); // Covered by default mock now
    // mockFs.appendFile.mockReset(); // Covered by default mock now
  });

  describe('pathExists', () => {
    it('should return true if fs.access succeeds', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const result = await pathExists('any/path');
      expect(result).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith('any/path', fsConstants.F_OK);
    });

    it('should return false if fs.access throws an error', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      const result = await pathExists('any/path');
      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    const mockStatObject = { isFile: () => true, size: 123 } as Stats;

    it('should return stats object on success', async () => {
      mockFs.stat.mockResolvedValue(mockStatObject);
      const stats = await getStats('valid/path');
      expect(stats).toEqual(mockStatObject);
      expect(mockFs.stat).toHaveBeenCalledWith('valid/path');
    });

    it('should throw ConduitError.ERR_FS_NOT_FOUND if fs.stat throws ENOENT', async () => {
      const error = new Error('Path not found') as any;
      error.code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);
      await expect(getStats('notfound/path')).rejects.toThrow(ConduitError);
      try {
        await getStats('notfound/path');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
        expect(e.message).toContain('Path not found: notfound/path');
      }
    });

    it('should throw ConduitError.ERR_FS_OPERATION_FAILED for other fs.stat errors', async () => {
      const error = new Error('Permission denied') as any;
      error.code = 'EACCES';
      mockFs.stat.mockRejectedValue(error);
      await expect(getStats('protected/path')).rejects.toThrow(ConduitError);
      try {
        await getStats('protected/path');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(
          'Failed to get stats for path: protected/path. Error: Permission denied'
        );
      }
    });
  });

  describe('getLstats', () => {
    const mockLstatObject = { isSymbolicLink: () => true, size: 456 } as Stats;

    it('should return lstat object on success', async () => {
      mockFs.lstat.mockResolvedValue(mockLstatObject);
      const stats = await getLstats('symlink/path');
      expect(stats).toEqual(mockLstatObject);
      expect(mockFs.lstat).toHaveBeenCalledWith('symlink/path');
    });

    it('should throw ConduitError.ERR_FS_NOT_FOUND if fs.lstat throws ENOENT', async () => {
      const error = new Error('No such file or directory') as any;
      error.code = 'ENOENT';
      mockFs.lstat.mockRejectedValue(error);
      await expect(getLstats('nonexistent/symlink')).rejects.toThrow(ConduitError);
      try {
        await getLstats('nonexistent/symlink');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
        expect(e.message).toContain('Path not found: nonexistent/symlink');
      }
    });

    it('should throw ConduitError.ERR_FS_OPERATION_FAILED for other fs.lstat errors', async () => {
      const error = new Error('I/O error') as any;
      mockFs.lstat.mockRejectedValue(error);
      await expect(getLstats('broken/symlink')).rejects.toThrow(ConduitError);
      try {
        await getLstats('broken/symlink');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(
          'Failed to get lstats for path: broken/symlink. Error: I/O error'
        );
      }
    });
  });

  // Tests for readFileAsString and readFileAsBuffer
  describe('readFileAsString', () => {
    const filePath = 'test.txt';
    const fileContent = 'Hello, Conduit!';
    const fileBuffer = Buffer.from(fileContent, 'utf8');

    it('should read file content as string successfully', async () => {
      mockFs.stat.mockResolvedValue({ size: fileBuffer.length } as Stats);
      mockFs.readFile.mockImplementation(async (pathArg, optionsArg) => {
        let encoding = null;
        if (typeof optionsArg === 'string') {
          encoding = optionsArg;
        } else if (typeof optionsArg === 'object' && optionsArg !== null && optionsArg.encoding) {
          encoding = optionsArg.encoding;
        }

        if (encoding === 'utf8') {
          return fileContent;
        }
        return fileBuffer;
      });
      const content = await readFileAsString(filePath);
      expect(content).toBe(fileContent);
      expect(mockFs.stat).toHaveBeenCalledWith(filePath);
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath, { encoding: 'utf8' });
    });

    it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if file size is greater than maxLength', async () => {
      mockFs.stat.mockResolvedValue({ size: conduitConfig.maxFileReadBytes + 1 } as Stats);
      await expect(readFileAsString(filePath)).rejects.toThrow(ConduitError);
      try {
        await readFileAsString(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
        expect(e.message).toContain(
          `File size ${conduitConfig.maxFileReadBytes + 1} bytes exceeds maximum allowed read limit of ${conduitConfig.maxFileReadBytes} bytes`
        );
      }
    });

    it('should use specified maxLength if provided', async () => {
      const specifiedMaxLength = 5;
      mockFs.stat.mockResolvedValue({ size: 10 } as Stats); // File size is 10
      await expect(readFileAsString(filePath, specifiedMaxLength)).rejects.toThrow(ConduitError);
      try {
        await readFileAsString(filePath, specifiedMaxLength);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
        expect(e.message).toContain(
          `File size 10 bytes exceeds maximum allowed read limit of ${specifiedMaxLength} bytes`
        );
      }
    });

    it('should throw ERR_FS_NOT_FOUND if fs.readFile throws ENOENT', async () => {
      const error = new Error('File not found') as any;
      error.code = 'ENOENT';
      // Mock getStats to succeed, but readFile to fail
      mockFs.stat.mockResolvedValue({ size: 100 } as Stats);
      mockFs.readFile.mockRejectedValue(error);
      await expect(readFileAsString(filePath)).rejects.toThrow(ConduitError);
      try {
        await readFileAsString(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      }
    });

    it('should throw ERR_FS_READ_FAILED for other fs.readFile errors', async () => {
      const error = new Error('Read permission denied') as any;
      error.code = 'EACCES';
      mockFs.stat.mockResolvedValue({ size: 100 } as Stats);
      mockFs.readFile.mockRejectedValue(error);
      await expect(readFileAsString(filePath)).rejects.toThrow(ConduitError);
      try {
        await readFileAsString(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_READ_FAILED);
      }
    });
  });

  describe('readFileAsBuffer', () => {
    const filePath = 'test.bin';
    const fileBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    it('should read file content as buffer successfully', async () => {
      mockFs.stat.mockResolvedValue({ size: fileBuffer.length } as Stats);
      mockFs.readFile.mockResolvedValue(fileBuffer);
      const content = await readFileAsBuffer(filePath);
      expect(content).toEqual(fileBuffer);
      expect(mockFs.stat).toHaveBeenCalledWith(filePath);
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath); // No encoding for buffer
    });

    it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if file size is greater than maxLength', async () => {
      mockFs.stat.mockResolvedValue({ size: conduitConfig.maxFileReadBytes + 1 } as Stats);
      await expect(readFileAsBuffer(filePath)).rejects.toThrow(ConduitError);
      try {
        await readFileAsBuffer(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
      }
    });

    // ENOENT and other read errors are covered by similar tests in readFileAsString, assuming shared error handling logic
    // If specific buffer handling differs, add more tests here.
  });

  // Tests for writeFile
  describe('writeFile', () => {
    const filePath = 'output.txt';
    const textContent = 'This is a test.';
    const base64Content = Buffer.from(textContent).toString('base64');
    const bufferContent = Buffer.from(textContent);

    it('should write text content in overwrite mode successfully', async () => {
      const bytesWritten = await writeFile(filePath, textContent, 'text', 'overwrite');
      expect(bytesWritten).toBe(bufferContent.length);
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent);
      expect(mockFs.appendFile).not.toHaveBeenCalled();
    });

    it('should write base64 encoded content in overwrite mode successfully', async () => {
      const bytesWritten = await writeFile(filePath, base64Content, 'base64', 'overwrite');
      expect(bytesWritten).toBe(bufferContent.length);
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent); // Decoded to buffer
    });

    it('should write Buffer content in overwrite mode successfully', async () => {
      const bytesWritten = await writeFile(filePath, bufferContent, undefined, 'overwrite'); // Encoding ignored for buffer
      expect(bytesWritten).toBe(bufferContent.length);
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent);
    });

    it('should append text content successfully', async () => {
      const bytesWritten = await writeFile(filePath, textContent, 'text', 'append');
      expect(bytesWritten).toBe(bufferContent.length);
      expect(mockFs.appendFile).toHaveBeenCalledWith(filePath, bufferContent);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('should append Buffer content successfully', async () => {
      const bytesWritten = await writeFile(filePath, bufferContent, undefined, 'append');
      expect(bytesWritten).toBe(bufferContent.length);
      expect(mockFs.appendFile).toHaveBeenCalledWith(filePath, bufferContent);
    });

    it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if content size is too large', async () => {
      const largeTextContent = 'a'.repeat(conduitConfig.maxFileReadBytes + 1);

      // Ensure underlying fs calls don't interfere if the size check somehow fails
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.appendFile.mockResolvedValue(undefined);

      await expect(writeFile(filePath, largeTextContent)).rejects.toThrow(ConduitError);
      try {
        await writeFile(filePath, largeTextContent);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
        expect(e.message).toContain(
          `Content size ${largeTextContent.length} bytes exceeds maximum allowed write limit of ${conduitConfig.maxFileReadBytes} bytes`
        );
      }
    });

    it('should throw ERR_FS_WRITE_FAILED if fs.writeFile fails', async () => {
      const error = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(error);
      await expect(writeFile(filePath, textContent, 'text', 'overwrite')).rejects.toThrow(
        ConduitError
      );
      try {
        await writeFile(filePath, textContent, 'text', 'overwrite');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
        expect(e.message).toContain(`Failed to write file: ${filePath}. Error: Disk full`);
      }
    });

    it('should throw ERR_FS_WRITE_FAILED if fs.appendFile fails', async () => {
      const error = new Error('Permission issue');
      mockFs.appendFile.mockRejectedValue(error);
      await expect(writeFile(filePath, textContent, 'text', 'append')).rejects.toThrow(
        ConduitError
      );
      try {
        await writeFile(filePath, textContent, 'text', 'append');
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
        expect(e.message).toContain(`Failed to write file: ${filePath}. Error: Permission issue`);
      }
    });
  });

  // Tests for createDirectory
  describe('createDirectory', () => {
    const dirPath = '/new/directory';

    it('should create directory non-recursively by default', async () => {
      mockFs.mkdir.mockResolvedValue(undefined); // Or path if supported by mock
      await createDirectory(dirPath);
      expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: false });
    });

    it('should create directory recursively if specified', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      await createDirectory(dirPath, true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    it('should be idempotent and log debug if directory already exists (EEXIST)', async () => {
      const error = new Error('Directory exists') as any;
      error.code = 'EEXIST';
      mockFs.mkdir.mockRejectedValue(error);
      await expect(createDirectory(dirPath)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(
        `Directory already exists (idempotent success): ${dirPath}`
      );
    });

    it('should throw ERR_FS_DIR_CREATE_FAILED for other fs.mkdir errors', async () => {
      const dirPath = '/test/new_dir';
      const error = new Error('Permission denied') as any;
      error.code = 'EACCES';
      mockFs.mkdir.mockRejectedValue(error);
      try {
        await createDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DIR_CREATE_FAILED);
        expect(e.message).toContain(
          `Failed to create directory: ${dirPath}. Error: Permission denied`
        );
      }
    });
  });

  // Tests for deletePath
  describe('deletePath', () => {
    const filePath = '/path/to/file.txt';
    const dirPath = '/path/to/dir';

    it('should delete a file using fs.unlink', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => false } as Stats);
      mockFs.unlink.mockResolvedValue(undefined);
      await deletePath(filePath);
      expect(mockFs.lstat).toHaveBeenCalledWith(filePath);
      expect(mockFs.unlink).toHaveBeenCalledWith(filePath);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('should delete a directory using fs.rm with recursive option based on param', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockFs.rm.mockResolvedValue(undefined);
      await deletePath(dirPath, true); // Recursive true
      expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
      expect(mockFs.rm).toHaveBeenCalledWith(dirPath, { recursive: true, force: true });
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('should delete a directory using fs.rm (non-recursive by default for rm call structure in code)', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockFs.rm.mockResolvedValue(undefined);
      await deletePath(dirPath, false); // Recursive false
      expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
      expect(mockFs.rm).toHaveBeenCalledWith(dirPath, { recursive: false, force: false });
    });

    it('should be idempotent and log debug if path does not exist (ENOENT on lstat)', async () => {
      // mockFs.lstat is a MockFunction, so mockRejectedValue already handles PathLike correctly
      const error = new Error('Path does not exist') as any;
      error.code = 'ENOENT';
      mockFs.lstat.mockRejectedValue(error);
      await expect(deletePath(filePath)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(
        `Path not found for deletion (considered success): ${filePath}`
      );
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('should throw ERR_FS_DELETE_FAILED if fs.unlink fails for a file', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => false } as Stats);
      const error = new Error('Cannot delete file') as any;
      error.code = 'EPERM';
      mockFs.unlink.mockRejectedValue(error);
      await expect(deletePath(filePath)).rejects.toThrow(ConduitError);
      try {
        await deletePath(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
        expect(e.message).toContain(
          `Failed to delete path: ${filePath}. Error: Cannot delete file`
        );
      }
    });

    it('should throw ERR_FS_DELETE_FAILED if fs.rm fails for a directory', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      const error = new Error('Cannot delete directory') as any;
      error.code = 'EACCES';
      mockFs.rm.mockRejectedValue(error);
      await expect(deletePath(dirPath, true)).rejects.toThrow(ConduitError);
      try {
        await deletePath(dirPath, true);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
        expect(e.message).toContain(
          `Failed to delete path: ${dirPath}. Error: Cannot delete directory`
        );
      }
    });
  });

  // Tests for listDirectory
  describe('listDirectory', () => {
    const dirPath = '/my/directory';
    const entries = ['file1.txt', 'subdir', 'file2.js'];

    it('should return an array of entry names on success', async () => {
      // mockFs.readdir is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.readdir.mockResolvedValue(entries as any); // fs.readdir returns string[] or Dirent[]
      const result = await listDirectory(dirPath);
      expect(result).toEqual(entries);
      expect(mockFs.readdir).toHaveBeenCalledWith(dirPath);
    });

    it('should throw ERR_FS_DIR_NOT_FOUND if directory does not exist (ENOENT)', async () => {
      const dirPath = '/test/non_existent_dir';
      const error = new Error('Directory not found') as any;
      error.code = 'ENOENT';
      mockFs.readdir.mockRejectedValue(error);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DIR_NOT_FOUND);
        expect(e.message).toContain(`Directory not found: ${dirPath}`);
      }
    });

    it('should throw ERR_FS_PATH_IS_FILE if path is a file (ENOTDIR)', async () => {
      // mockFs.readdir is a MockFunction, so mockRejectedValue already handles PathLike correctly
      const error = new Error('Path is a file') as any;
      error.code = 'ENOTDIR';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
        expect(e.message).toContain(`Path is a file, not a directory: ${dirPath}`);
      }
    });

    it('should throw ERR_FS_DIR_LIST_FAILED for other fs.readdir errors', async () => {
      const dirPath = '/test/some_dir';
      const error = new Error('Permission denied') as any;
      error.code = 'EACCES';
      mockFs.readdir.mockRejectedValue(error);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DIR_LIST_FAILED);
        expect(e.message).toContain(
          `Failed to list directory: ${dirPath}. Error: Permission denied`
        );
      }
    });
  });

  // Tests for copyPath
  describe('copyPath', () => {
    const sourceFile = '/src/file.txt';
    const sourceDir = '/src/dir';
    const destFile = '/dest/newfile.txt';
    const destDir = '/dest/newdir';

    it('should copy a file to a new file path', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false } as Stats); // Source is file
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' }); // Destination does not exist
      mockFs.cp.mockResolvedValue(undefined);

      await copyPath(sourceFile, destFile);
      expect(mockFs.stat).toHaveBeenCalledWith(sourceFile); // First call for source
      expect(mockFs.stat).toHaveBeenCalledWith(destFile); // Second call for destination
      expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, destFile, {
        recursive: false,
        force: true,
      });
    });

    it('should copy a file into an existing directory', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false } as Stats); // Source is file
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true } as Stats); // Destination is directory
      mockFs.cp.mockResolvedValue(undefined);
      const expectedDestPath = path.join(destDir, path.basename(sourceFile));

      await copyPath(sourceFile, destDir);
      expect(mockFs.stat).toHaveBeenCalledWith(sourceFile);
      expect(mockFs.stat).toHaveBeenCalledWith(destDir);
      expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, expectedDestPath, {
        recursive: false,
        force: true,
      });
    });

    it('should copy a directory to a new directory path', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true } as Stats); // Source is directory
      // No second fs.stat call for destination if source is directory, fs.cp handles it
      mockFs.cp.mockResolvedValue(undefined);

      await copyPath(sourceDir, destDir);
      expect(mockFs.stat).toHaveBeenCalledWith(sourceDir);
      expect(mockFs.cp).toHaveBeenCalledWith(sourceDir, destDir, { recursive: true, force: true });
    });

    it('should throw ERR_FS_NOT_FOUND if source path does not exist', async () => {
      const sourceFile = '/test/non_existent_source.txt';
      const destFile = '/test/dest.txt';

      // conduitConfig is now the mocked object from the factory above
      const originalLogLevel = conduitConfig.logLevel;
      (conduitConfig as any).logLevel = 'DEBUG';
      let errorOccurred = false;

      try {
        // Mock fs.stat to simulate source not existing
        mockFs.stat.mockImplementation(async (p: any) => {
          if (p === sourceFile) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          // Provide a default stat for other paths if necessary, e.g., destination or its parent
          return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
        });

        // Ensure fs.cp mock is clean for this test if it relies on it
        mockFs.cp.mockReset();

        await copyPath(sourceFile, destFile);
        throw new Error('copyPath should have thrown an error for non-existent source'); // Should not be reached
      } catch (e: any) {
        errorOccurred = true; // Mark that an error was caught
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_COPY_FAILED);
        // The message from copyPath's error wrapping is "Failed to copy: ${sourcePath} to ${destinationPath}. Error: ${error.message from getStats}"
        // The error.message from getStats is "Path not found: ${sourcePath}"
        expect(e.message).toContain(
          `Failed to copy: ${sourceFile} to ${destFile}. Error: Path not found: ${sourceFile}`
        );
      } finally {
        // Restore original log level
        (conduitConfig as any).logLevel = originalLogLevel;
        if (!errorOccurred && !process.env.VITEST_WORKER_ID) {
          console.warn(
            "Test 'copyPath > should throw ERR_FS_NOT_FOUND' did not catch an error as expected for logging path."
          );
        }
      }
    });

    it('should throw ERR_FS_COPY_FAILED if fs.cp fails', async () => {
      const sourceFile = 'source.txt';
      const destFile = 'dest.txt';
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as Stats); // Source stat succeeds
      mockFs.cp.mockRejectedValue(new Error('Copy failed'));
      try {
        await copyPath(sourceFile, destFile);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_COPY_FAILED);
        expect(e.message).toContain(
          `Failed to copy: ${sourceFile} to ${destFile}. Error: Copy failed`
        );
      }
    });

    it('should copy a file to a file, overwriting destination', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source.txt')
          return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
        if (pathStr === 'dest.txt')
          return { isDirectory: () => false, isFile: () => true, size: 200 } as Stats; // Dest exists
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      await copyPath('source.txt', 'dest.txt');
      expect(mockFs.cp).toHaveBeenCalledWith('source.txt', 'dest.txt', {
        recursive: false,
        force: true,
      });
    });

    it('should copy a file into a directory', async () => {
      const sourceBasename = path.basename('source.txt');
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source.txt')
          return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
        if (pathStr === 'dest_dir')
          return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      await copyPath('source.txt', 'dest_dir');
      expect(mockFs.cp).toHaveBeenCalledWith('source.txt', path.join('dest_dir', sourceBasename), {
        recursive: false,
        force: true,
      });
    });

    it('should copy a directory to a new directory path (destination does not exist)', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source_dir')
          return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        if (pathStr === 'dest_dir_new')
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); // Dest does not exist
        return { isDirectory: () => false, isFile: () => false } as Stats; // Default for other paths
      });
      await copyPath('source_dir', 'dest_dir_new');
      expect(mockFs.cp).toHaveBeenCalledWith('source_dir', 'dest_dir_new', {
        recursive: true,
        force: true,
      });
    });

    it('should copy a directory into an existing directory (destination is a dir)', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source_dir')
          return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        if (pathStr === 'existing_dest_dir')
          return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        return { isDirectory: () => false, isFile: () => false } as Stats; // Default for other paths
      });
      await copyPath('source_dir', 'existing_dest_dir');
      // fs.cp handles copying 'source_dir' *into* 'existing_dest_dir' correctly when dest is a dir.
      // The destination path for fs.cp remains 'existing_dest_dir'.
      expect(mockFs.cp).toHaveBeenCalledWith('source_dir', 'existing_dest_dir', {
        recursive: true,
        force: true,
      });
    });
  });

  describe('movePath', () => {
    // Test cases for movePath:
    // 1. Move file to new file path (rename)
    // 2. Move file to overwrite existing file
    // 3. Move file into an existing directory
    // 4. Move file into a new directory (parent dir needs creation)
    // 5. Move directory to new directory path
    // 6. Move directory to overwrite/merge with existing directory (behavior might be complex, focus on spec: "overwrites existing FILES")
    //    The current impl deletes target *files* before move.
    // 7. Move directory into an existing directory
    // 8. Source path does not exist (ENOENT)
    // 9. Other fs.rename errors

    it('should move a file to a new file path (rename)', async () => {
      const sourcePath = 'source.txt';
      const destPath = 'dest_new.txt';
      const destParentPath = path.dirname(destPath); // typically '.' if destPath is simple

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for access'), { code: 'ENOENT' }); // Dest does not exist
        if (p === destParentPath) return undefined; // Dest parent exists
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for stat'), { code: 'ENOENT' });
        if (p === destParentPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destPath);

      expect(mockFs.unlink).not.toHaveBeenCalled(); // Destination doesn't exist, so no unlink
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Parent dir exists
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
    });

    it('should move a file to overwrite an existing file', async () => {
      const sourcePath = 'source.txt';
      const destPath = 'dest_existing_file.txt';
      const destParentPath = path.dirname(destPath); // typically '.' if destPath is simple

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destPath) return undefined; // Dest exists
        if (p === destParentPath) return undefined; // Dest parent exists
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destPath)
          return { isDirectory: () => false, isFile: () => true, size: 20 } as Stats; // Dest is a file
        if (p === destParentPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset().mockResolvedValue(undefined);
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destPath);

      expect(mockFs.unlink).toHaveBeenCalledWith(destPath); // Existing file deleted
      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
    });

    it('should move a file into an existing directory', async () => {
      const sourcePath = 'source.txt';
      const destDirPath = 'existing_dest_dir';
      const sourceBasename = path.basename(sourcePath);
      const finalDestPath = path.join(destDirPath, sourceBasename);

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destDirPath) return undefined; // Dest dir exists
        if (p === finalDestPath)
          throw Object.assign(new Error('ENOENT finalDestPath for access'), { code: 'ENOENT' }); // Final dest does not exist
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destDirPath) return { isDirectory: () => true, isFile: () => false } as Stats; // Dest is a directory
        if (p === finalDestPath)
          throw Object.assign(new Error('ENOENT finalDestPath for stat'), { code: 'ENOENT' });
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destDirPath);

      expect(mockFs.unlink).not.toHaveBeenCalled(); // No file to overwrite at final path
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Dest dir exists
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
    });

    it('should move a file into an existing directory, overwriting a file of the same name', async () => {
      const sourcePath = 'source_to_overwrite.txt';
      const destDirPath = 'existing_dest_dir_with_conflict';
      const sourceBasename = path.basename(sourcePath);
      const finalDestPath = path.join(destDirPath, sourceBasename);

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destDirPath) return undefined; // Dest dir exists
        if (p === finalDestPath) return undefined; // Final dest exists and will be overwritten
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destDirPath) return { isDirectory: () => true, isFile: () => false } as Stats; // Dest is a directory
        if (p === finalDestPath)
          return { isDirectory: () => false, isFile: () => true, size: 20 } as Stats; // Final dest is a file
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset().mockResolvedValue(undefined);
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destDirPath);

      expect(mockFs.unlink).toHaveBeenCalledWith(finalDestPath); // Existing file in dir is deleted
      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
    });

    it('should move a file, creating intermediate destination directories', async () => {
      const sourcePath = 'source_for_mkdir.txt';
      const destFilePath = 'new_parent_dir/sub_dir/dest_file.txt';
      const parentOfFinalDest = path.dirname(destFilePath); // 'new_parent_dir/sub_dir'

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destFilePath)
          throw Object.assign(new Error('ENOENT destFilePath for access'), { code: 'ENOENT' }); // Dest does not exist
        if (p === parentOfFinalDest)
          throw Object.assign(new Error('ENOENT parentOfFinalDest for access'), { code: 'ENOENT' }); // Parent does not exist initially
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      // We need to track when mkdir is called to update our mocks
      let parentDirCreated = false;
      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destFilePath)
          throw Object.assign(new Error('ENOENT destFilePath for stat'), { code: 'ENOENT' });
        if (p === parentOfFinalDest) {
          if (parentDirCreated) {
            return { isDirectory: () => true, isFile: () => false } as Stats; // After mkdir is called
          }
          throw Object.assign(new Error('ENOENT parentOfFinalDest for stat'), { code: 'ENOENT' });
        }
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset().mockImplementation(async (p: any, options: any) => {
        if (p === parentOfFinalDest && options.recursive) {
          parentDirCreated = true; // Update our state to show dir was created
          return undefined;
        }
        throw new Error(`Unexpected mkdir call: ${p}`);
      });
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destFilePath);

      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.mkdir).toHaveBeenCalledWith(parentOfFinalDest, { recursive: true });
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destFilePath);
    });

    it('should move a directory to a new path', async () => {
      const sourcePath = 'source_dir_to_move';
      const destPath = 'new_dest_dir_path';
      const destParentPath = path.dirname(destPath); // typically '.' if destPath is simple

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for access'), { code: 'ENOENT' }); // Dest does not exist
        if (p === destParentPath) return undefined; // Dest parent exists
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath) return { isDirectory: () => true, isFile: () => false } as Stats; // Source is a directory
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for stat'), { code: 'ENOENT' });
        if (p === destParentPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destPath);

      expect(mockFs.unlink).not.toHaveBeenCalled(); // Not overwriting a file
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Parent dir exists
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
    });

    it('should throw ConduitError if source path does not exist for move', async () => {
      const sourcePath = 'non_existent_source.txt';
      const destPath = 'dest.txt';
      const destParentPath = path.dirname(destPath);

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          throw Object.assign(new Error('ENOENT sourcePath for access'), { code: 'ENOENT' });
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for access'), { code: 'ENOENT' });
        if (p === destParentPath) return undefined; // Parent of dest exists
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          throw Object.assign(new Error('ENOENT sourcePath for stat'), { code: 'ENOENT' });
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for stat'), { code: 'ENOENT' });
        if (p === destParentPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockRejectedValueOnce(
        Object.assign(new Error('Source does not exist for rename'), { code: 'ENOENT' })
      );

      // await expect(movePath(sourcePath, destPath)).rejects.toThrow(ConduitError);
      // await expect(movePath(sourcePath, destPath)).rejects.toHaveProperty('errorCode', ErrorCode.ERR_FS_MOVE_FAILED);
      try {
        await movePath(sourcePath, destPath);
        throw new Error('movePath should have thrown'); // Should not reach here
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConduitError);
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_MOVE_FAILED);
        expect(e.message).toContain('Move operation failed (ENOENT)');
      }
    });

    it('should throw ConduitError for other fs.rename errors', async () => {
      const sourcePath = 'source_rename_fail.txt';
      const destPath = 'dest_rename_fail.txt';
      const destParentPath = path.dirname(destPath); // typically '.' if destPath is simple

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for access'), { code: 'ENOENT' }); // Dest does not exist
        if (p === destParentPath) return undefined; // Dest parent exists
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destPath)
          throw Object.assign(new Error('ENOENT destPath for stat'), { code: 'ENOENT' });
        if (p === destParentPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockRejectedValue(new Error('FS rename failed'));

      await expect(movePath(sourcePath, destPath)).rejects.toHaveProperty(
        'errorCode',
        ErrorCode.ERR_FS_MOVE_FAILED
      );
    });

    it('should not attempt to delete destination if it is a directory (file overwrite only)', async () => {
      const sourcePath = 'source_file.txt';
      const destPath = 'existing_target_dir';
      const finalDestPath = path.join(destPath, path.basename(sourcePath));

      mockFs.access.mockImplementation(async (p: any) => {
        if (p === sourcePath) return undefined; // Source exists
        if (p === destPath) return undefined; // Dest dir exists
        if (p === finalDestPath)
          throw Object.assign(new Error('ENOENT finalDestPath for access'), { code: 'ENOENT' }); // Final file does not exist
        throw Object.assign(new Error(`Unexpected access call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.stat.mockImplementation(async (p: any) => {
        if (p === sourcePath)
          return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
        if (p === destPath) return { isDirectory: () => true, isFile: () => false } as Stats; // Dest is a directory
        if (p === finalDestPath)
          throw Object.assign(new Error('ENOENT finalDestPath for stat'), { code: 'ENOENT' });
        throw Object.assign(new Error(`Unexpected stat call: ${p}`), { code: 'ENOENT' });
      });

      mockFs.unlink.mockReset();
      mockFs.mkdir.mockReset();
      mockFs.rename.mockReset().mockResolvedValue(undefined);

      await movePath(sourcePath, destPath);

      expect(mockFs.unlink).not.toHaveBeenCalled(); // No file deletion needed
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
    });
  });

  describe('touchFile', () => {
    const filePath = '/path/to/some/file.txt';

    it('should create an empty file if it does not exist', async () => {
      // Mock pathExists to return false initially
      // pathExists itself uses fs.access, so we can mock fs.access
      // mockFs.access is a MockFunction, so mockRejectedValueOnce already handles PathLike correctly
      mockFs.access.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockFs.writeFile.mockResolvedValue(undefined); // For the writeFile call

      await touchFile(filePath);

      expect(mockFs.access).toHaveBeenCalledWith(filePath, fsConstants.F_OK);
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, Buffer.from('')); //writeFile in fsOps converts string to buffer
      expect(mockFs.utimes).not.toHaveBeenCalled();
    });

    it('should update timestamps if the file exists', async () => {
      // Mock pathExists to return true
      // mockFs.access is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.access.mockResolvedValue(undefined);
      mockFs.utimes.mockResolvedValue(undefined);
      const beforeCall = new Date();

      await touchFile(filePath);
      const afterCall = new Date();

      expect(mockFs.access).toHaveBeenCalledWith(filePath, fsConstants.F_OK);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.utimes).toHaveBeenCalledTimes(1);

      const utimesArgs = mockFs.utimes.mock.calls[0];
      expect(utimesArgs[0]).toBe(filePath); // PathLike comparison works because we're comparing with the original value
      // Check if the timestamps are Date objects and are recent
      expect(utimesArgs[1]).toBeInstanceOf(Date);
      expect(utimesArgs[2]).toBeInstanceOf(Date);
      expect((utimesArgs[1] as Date).getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect((utimesArgs[1] as Date).getTime()).toBeLessThanOrEqual(afterCall.getTime());
      expect((utimesArgs[2] as Date).getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect((utimesArgs[2] as Date).getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it('should throw ERR_FS_OPERATION_FAILED if writeFile fails during creation', async () => {
      // mockFs.access is a MockFunction, so mockRejectedValueOnce already handles PathLike correctly
      mockFs.access.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const writeError = new Error('Disk quota exceeded');
      mockFs.writeFile.mockRejectedValue(writeError); // writeFile is called internally by the fsOps.writeFile wrapper

      // To test the wrapper's error, we need to ensure the mock for fsOps.writeFile (if spied) or the underlying fs.writeFile throws.
      // Since we mock fs.writeFile directly, this is fine.

      await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
      try {
        await touchFile(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        // The message comes from the writeFile wrapper if it throws, or the touchFile wrapper if utimes throws.
        // If writeFile in touchFile throws, the message will be about writeFile.
        // The actual fsOps.writeFile creates its own error message.
        // So, we check if the error thrown by touchFile has the correct code and its message indicates the underlying error.
        expect(e.message).toContain(`Failed to touch file: ${filePath}.`);
        // It might be better to check e.originalError or e.cause if available and set by ConduitError
      }
    });

    it('should throw ERR_FS_OPERATION_FAILED if utimes fails', async () => {
      // mockFs.access is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.access.mockResolvedValue(undefined);
      const utimesError = new Error('Operation not permitted');
      mockFs.utimes.mockRejectedValue(utimesError);

      await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
      try {
        await touchFile(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(
          `Failed to touch file: ${filePath}. Error: ${utimesError.message}`
        );
      }
    });
  });

  describe('createEntryInfo', () => {
    const baseDir = '/test';
    const now = new Date();
    const formattedDate = formatToISO8601UTC(now);

    // Mock getMimeType for these tests
    const mockedGetMimeType = getMimeType as MockedFunction<typeof getMimeType>;

    beforeEach(() => {
      vi.clearAllMocks();
      mockedGetMimeType.mockReset().mockResolvedValue('application/octet-stream');
      // Reset fs mocks
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

      // Mock file-specific operations
      mockFs.lstat.mockResolvedValue(fileStats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');

      const entryInfo = await createEntryInfo(filePath, fileStats);

      // Verify createEntryInfo called the right functions
      expect(mockFs.lstat).toHaveBeenCalledWith(filePath);
      expect(mockedGetMimeType).toHaveBeenCalledWith(filePath);

      // Verify the returned EntryInfo object
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
        size: 4096,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o40755, // directory, rwxr-xr-x
      } as Stats;

      // Mock directory-specific operations
      mockFs.lstat.mockResolvedValue(dirStats);

      const entryInfo = await createEntryInfo(dirPath, dirStats);

      // Verify createEntryInfo called the right functions
      expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
      expect(mockedGetMimeType).not.toHaveBeenCalled(); // Not called for directories

      // Verify the returned EntryInfo object
      expect(entryInfo).toEqual({
        name: 'directory',
        path: dirPath,
        type: 'directory',
        size_bytes: undefined, // Not defined for directories per implementation
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
      // Create stats with read-only permissions
      const readonlyStats = {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 500,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o100444, // r--r--r-- (no write permission)
      } as Stats;

      // Mock read-only file operations
      mockFs.lstat.mockResolvedValue(readonlyStats);
      mockedGetMimeType.mockResolvedValueOnce('text/plain');

      const entryInfo = await createEntryInfo(filePath, readonlyStats);

      // Verify the readonly flag is set correctly
      expect(entryInfo.is_readonly).toBe(true);
      expect(entryInfo.size_bytes).toBe(500);
      expect(entryInfo.mime_type).toBe('text/plain');
    });

    it('should create EntryInfo for a symlink to a file correctly', async () => {
      const symlinkPath = '/test/link-to-file.txt';
      const targetPath = '/target/file.txt';
      const symlinkStats = {
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
        size: 10, // Symlink size is typically small
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o120777, // Symlink mode
      } as Stats;

      const targetStats = {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 2000,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o100644,
      } as Stats;

      // Mock symlink-specific operations
      mockFs.lstat.mockResolvedValue(symlinkStats);
      mockFs.readlink.mockResolvedValue(targetPath);
      mockFs.stat.mockResolvedValue(targetStats);

      const entryInfo = await createEntryInfo(symlinkPath, targetStats);

      // Verify the calls
      expect(mockFs.lstat).toHaveBeenCalledWith(symlinkPath);
      expect(mockFs.readlink).toHaveBeenCalledWith(symlinkPath, { encoding: 'utf8' });
      expect(mockFs.stat).toHaveBeenCalledWith(symlinkPath); // Note: follows the symlink
      expect(mockedGetMimeType).not.toHaveBeenCalled(); // Not called for symlinks

      // Verify the returned object
      expect(entryInfo).toEqual({
        name: 'link-to-file.txt',
        path: symlinkPath,
        type: 'symlink',
        size_bytes: undefined, // Undefined for symlinks per implementation
        mime_type: undefined, // Undefined for symlinks per implementation
        created_at: formattedDate,
        modified_at: formattedDate,
        last_accessed_at: formattedDate,
        is_readonly: false,
        symlink_target: targetPath,
      });
    });

    it('should handle broken symlinks gracefully', async () => {
      const brokenLinkPath = '/test/broken-link';
      const nonExistentTarget = '/target/does-not-exist';
      const symlinkStats = {
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
        size: 12,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o120777,
      } as Stats;

      // Mock broken symlink operations
      mockFs.lstat.mockResolvedValue(symlinkStats);
      mockFs.readlink.mockResolvedValue(nonExistentTarget);
      // fs.stat will throw ENOENT for a broken symlink
      const enoentError = new Error('ENOENT: Target not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      mockFs.stat.mockRejectedValue(enoentError);

      const entryInfo = await createEntryInfo(brokenLinkPath, symlinkStats);

      // Verify the calls
      expect(mockFs.lstat).toHaveBeenCalledWith(brokenLinkPath);
      expect(mockFs.readlink).toHaveBeenCalledWith(brokenLinkPath, { encoding: 'utf8' });
      expect(mockFs.stat).toHaveBeenCalledWith(brokenLinkPath);
      expect(mockedGetMimeType).not.toHaveBeenCalled();

      // Verify the returned object - for broken symlinks, we still have type 'symlink' and the target
      expect(entryInfo.type).toBe('symlink');
      expect(entryInfo.symlink_target).toBe(nonExistentTarget);
      expect(entryInfo.size_bytes).toBeUndefined();
      expect(entryInfo.mime_type).toBeUndefined();
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
      mockedGetMimeType.mockResolvedValueOnce('text/plain');

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
        mode: 0o100644, // rw-r--r--
      } as Stats;

      // Mock lstat to return file stats with size 0
      mockFs.lstat.mockResolvedValue(zeroByteStats);

      const entryInfo = await createEntryInfo(filePath, zeroByteStats);

      // Verify getMimeType is still called for zero-byte files
      expect(mockedGetMimeType).toHaveBeenCalledWith(filePath);

      // Verify the returned EntryInfo object
      expect(entryInfo).toEqual({
        name: 'empty.txt',
        path: filePath,
        type: 'file',
        size_bytes: 0,
        mime_type: 'application/octet-stream', // Default from mock
        created_at: formattedDate,
        modified_at: formattedDate,
        last_accessed_at: formattedDate,
        is_readonly: false,
        symlink_target: undefined,
      });
    });
  });

  describe('calculateRecursiveDirectorySize', () => {
    const baseDir = '/base';
    let startTime: number;
    const maxDepth = conduitConfig.maxRecursiveDepth; // Use from mocked config
    const timeoutMs = conduitConfig.recursiveSizeTimeoutMs; // Use from mocked config

    // Helper to create Dirent-like objects for mockFs.readdir
    const createDirent = (
      name: string,
      isFile: boolean,
      isDirectory: boolean
    ): Partial<import('fs').Dirent> => ({
      name,
      isFile: () => isFile,
      isDirectory: () => isDirectory,
    });

    beforeEach(() => {
      vi.useFakeTimers(); // Use fake timers for timeout tests
      startTime = Date.now(); // Get consistent start time for each test
      mockFs.readdir.mockReset();
      mockFs.stat.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers(); // Restore real timers after each test
    });

    it('should calculate size of a simple directory with files', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        createDirent('file1.txt', true, false),
        createDirent('file2.txt', true, false),
      ] as any);
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file1.txt'))
          return { size: 100, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'file2.txt'))
          return { size: 200, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(300);
      expect(result.note).toBeUndefined();
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file1.txt'));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file2.txt'));
    });

    it('should calculate size of nested directories up to maxDepth', async () => {
      // /base
      //   - file1.txt (10)
      //   - sub1 (dir)
      //     - file2.txt (20)
      //     - sub2 (dir)  -> this one is at currentDepth 1, recursion goes to 2
      //       - file3.txt (30)
      //       - sub3 (dir) -> this one is at currentDepth 2, recursion would go to 3 (if maxDepth allows)
      //         - file4.txt (40) -> Should be ignored if maxDepth is 2 for the call to sub2

      const testMaxDepth = 2;

      mockFs.readdir.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === baseDir)
          return [createDirent('file1.txt', true, false), createDirent('sub1', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1'))
          return [createDirent('file2.txt', true, false), createDirent('sub2', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2'))
          return [createDirent('file3.txt', true, false), createDirent('sub3', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'sub3'))
          return [createDirent('file4.txt', true, false)] as any; // Beyond maxDepth for sub2 call
        throw new Error(`Unexpected readdir call: ${pathStr}`);
      });

      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file1.txt'))
          return { size: 10, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'file2.txt'))
          return { size: 20, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'file3.txt'))
          return { size: 30, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'sub3', 'file4.txt'))
          return { size: 40, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        testMaxDepth,
        timeoutMs,
        startTime
      );
      // Expected: file1 (10) + file2 (20) + file3 (30) = 60
      // file4 should be skipped due to maxDepth relative to the recursive call for sub2
      expect(result.size).toBe(60);
      expect(result.note).toBe('Partial size: depth limit reached'); // sub3 was not entered from sub2
    });

    it('should return note if initial depth exceeds maxDepth', async () => {
      const result = await calculateRecursiveDirectorySize(
        baseDir,
        maxDepth + 1,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(0);
      expect(result.note).toBe('Partial size: depth limit reached');
      expect(mockFs.readdir).not.toHaveBeenCalled();
    });

    it('should handle timeout during file iteration', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        createDirent('file1.txt', true, false),
        createDirent('file2_timeout.txt', true, false),
        createDirent('file3.txt', true, false),
      ] as any);
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file1.txt')) {
          // Call vi.advanceTimersByTime WITHIN the file1.txt conditional block
          // This will trigger timeout before file2_timeout.txt's size is added
          vi.advanceTimersByTime(timeoutMs + 1);
          return { size: 100, isFile: () => true, isDirectory: () => false } as Stats;
        }
        if (pathStr === path.join(baseDir, 'file2_timeout.txt')) {
          // Remove the timeout advancement from here
          return { size: 200, isFile: () => true, isDirectory: () => false } as Stats;
        }
        if (pathStr === path.join(baseDir, 'file3.txt'))
          return { size: 300, isFile: () => true, isDirectory: () => false } as Stats; // Should not be reached
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(100); // Only file1.txt before timeout is hit by checking Date.now() *before* processing file2
      expect(result.note).toBe('Calculation timed out due to server limit');
      expect(mockFs.stat).toHaveBeenCalledTimes(1); // Should only be called for file1.txt
    });

    it('should handle timeout during subdirectory recursion and propagate note', async () => {
      mockFs.readdir.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === baseDir) return [createDirent('sub_causes_timeout', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub_causes_timeout')) {
          vi.advanceTimersByTime(timeoutMs + 1); // Timeout happens when trying to read this dir
          // OR timeout happens *inside* this dir's processing. Let's simulate it inside.
          return [createDirent('inner_file.txt', true, false)] as any;
        }
        if (pathStr === path.join(baseDir, 'sub_causes_timeout', 'inner_file.txt')) {
          // This stat call would happen *after* the timeout check in the loop for 'inner_file.txt'
          return { size: 50 } as Stats;
        }
        throw new Error(`Unexpected readdir call: ${pathStr}`);
      });
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'sub_causes_timeout', 'inner_file.txt')) {
          // The loop for sub_causes_timeout will check timeout *before* processing inner_file.txt
          // So the call to calculateRecursiveDirectorySize for sub_causes_timeout will get entries,
          // then for 'inner_file.txt', it will check Date.now() - startTime > timeoutMs. If it is, note set.
          return { size: 50, isFile: () => true, isDirectory: () => false } as Stats;
        }
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      // Test: Timeout occurs *while processing* sub_causes_timeout entries
      // So, the recursive call for sub_causes_timeout will return with a timeout note.
      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(0); // Size from sub_causes_timeout not added as it timed out internally
      expect(result.note).toBe('Calculation timed out due to server limit');
    });

    it('should handle fs.readdir error gracefully', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('Read dir permission denied'));
      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(0);
      expect(result.note).toBe('Error during size calculation');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Error reading directory ${baseDir}`)
      );
    });

    it('should handle fs.stat error for a file gracefully and continue', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        createDirent('file_ok.txt', true, false),
        createDirent('file_stat_error.txt', true, false),
        createDirent('file_after_error.txt', true, false),
      ] as any);
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file_ok.txt'))
          return { size: 70, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'file_stat_error.txt'))
          throw new Error('Stat failed for this file');
        if (pathStr === path.join(baseDir, 'file_after_error.txt'))
          return { size: 30, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(
        baseDir,
        0,
        maxDepth,
        timeoutMs,
        startTime
      );
      expect(result.size).toBe(100); // 70 + 30, file_stat_error.txt is skipped
      expect(result.note).toBeUndefined(); // No overall error note, just a warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Could not stat file ${path.join(baseDir, 'file_stat_error.txt')}`)
      );
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_ok.txt'));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_stat_error.txt'));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_after_error.txt'));
    });
  });
});
