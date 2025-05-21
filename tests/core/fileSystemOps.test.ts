import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import path from 'path';
import type { Stats } from 'fs';
import { constants as fsConstants } from 'fs';

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
import { conduitConfig } from '@/core/configLoader'; // For default limits
import logger from '@/utils/logger'; // Mocked globally
import { EntryInfo, formatToISO8601UTC, getMimeType } from '@/internal';

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
  };
  return {
    ...fsMockFunctions,
    default: fsMockFunctions,
  };
});

// Mock getMimeType as it's used by createEntryInfo
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    getMimeType: vi.fn().mockResolvedValue('application/octet-stream'), // Default mock
  };
});

// Temporarily mock conduitConfig for tests requiring it, e.g. maxFileReadBytes
// This can be refined if more specific config mocking per test suite is needed.
vi.mock('@/core/configLoader', () => ({
  conduitConfig: {
    maxFileReadBytes: 1000, // Test with a smaller limit
    // Add other necessary default config properties if fileSystemOps uses them directly
    logLevel: 'INFO',
    allowedPaths: ['/tmp'],
    httpTimeoutMs: 30000,
    maxPayloadSizeBytes: 10485760,
    maxFileReadBytesFind: 524288, 
    maxUrlDownloadSizeBytes: 20971520,
    imageCompressionThresholdBytes: 1048576,
    imageCompressionQuality: 75,
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 10,
    recursiveSizeTimeoutMs: 60000,
    serverStartTimeIso: '2023-01-01T00:00:00.000Z',
    serverVersion: 'test-version',
    workspaceRoot: '/test-ws',
  }
}));

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
};

describe('fileSystemOps', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clears call counts, mock implementations, etc.
    // Reset specific mock implementations if they were changed in a test
    // For example, if a test makes mockFs.stat throw an error once:
    // mockFs.stat.mockReset().mockResolvedValue({ isDirectory: () => false, size: 100 } as Stats);
    // Reset fs.stat specifically as it's used by readFileAs*
    mockFs.stat.mockReset();
    mockFs.lstat.mockReset(); // Reset lstat as it's used by deletePath
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
        expect(e.message).toContain('Failed to get stats for path: protected/path. Error: Permission denied');
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
        expect(e.message).toContain('Failed to get lstats for path: broken/symlink. Error: I/O error');
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
        expect(e.message).toContain(`File size ${conduitConfig.maxFileReadBytes + 1} bytes exceeds maximum allowed read limit of ${conduitConfig.maxFileReadBytes} bytes`);
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
        expect(e.message).toContain(`File size 10 bytes exceeds maximum allowed read limit of ${specifiedMaxLength} bytes`);
      }
    });

    it('should throw ERR_FS_NOT_FOUND if fs.readFile throws ENOENT', async () => {
      const error = new Error('File not found') as any; error.code = 'ENOENT';
      // Mock getStats to succeed, but readFile to fail
      mockFs.stat.mockResolvedValue({ size: 100 } as Stats);
      mockFs.readFile.mockRejectedValue(error);
      await expect(readFileAsString(filePath)).rejects.toThrow(ConduitError);
      try { await readFileAsString(filePath); } catch (e: any) { expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND); }
    });

    it('should throw ERR_FS_READ_FAILED for other fs.readFile errors', async () => {
      const error = new Error('Read permission denied') as any; error.code = 'EACCES';
      mockFs.stat.mockResolvedValue({ size: 100 } as Stats);
      mockFs.readFile.mockRejectedValue(error);
      await expect(readFileAsString(filePath)).rejects.toThrow(ConduitError);
      try { await readFileAsString(filePath); } catch (e: any) { expect(e.errorCode).toBe(ErrorCode.ERR_FS_READ_FAILED); }
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
      await expect(writeFile(filePath, largeTextContent)).rejects.toThrow(ConduitError);
      try {
        await writeFile(filePath, largeTextContent);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
        expect(e.message).toContain(`Content size ${largeTextContent.length} bytes exceeds maximum allowed write limit of ${conduitConfig.maxFileReadBytes} bytes`);
      }
    });

    it('should throw ERR_FS_WRITE_FAILED if fs.writeFile fails', async () => {
      const error = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(error);
      await expect(writeFile(filePath, textContent, 'text', 'overwrite')).rejects.toThrow(ConduitError);
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
      await expect(writeFile(filePath, textContent, 'text', 'append')).rejects.toThrow(ConduitError);
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
      const error = new Error('Directory exists') as any; error.code = 'EEXIST';
      mockFs.mkdir.mockRejectedValue(error);
      await expect(createDirectory(dirPath)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(`Directory already exists (idempotent success): ${dirPath}`);
    });

    it('should throw ERR_FS_OPERATION_FAILED for other fs.mkdir errors', async () => {
      const error = new Error('Permission denied') as any; error.code = 'EACCES';
      mockFs.mkdir.mockRejectedValue(error);
      await expect(createDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await createDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(`Failed to create directory: ${dirPath}. Error: Permission denied`);
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
      const error = new Error('Path does not exist') as any; error.code = 'ENOENT';
      mockFs.lstat.mockRejectedValue(error);
      await expect(deletePath(filePath)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(`Path not found for deletion (considered success): ${filePath}`);
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('should throw ERR_FS_DELETE_FAILED if fs.unlink fails for a file', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => false } as Stats);
      const error = new Error('Cannot delete file') as any; error.code = 'EPERM';
      mockFs.unlink.mockRejectedValue(error);
      await expect(deletePath(filePath)).rejects.toThrow(ConduitError);
      try {
        await deletePath(filePath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
        expect(e.message).toContain(`Failed to delete path: ${filePath}. Error: Cannot delete file`);
      }
    });

    it('should throw ERR_FS_DELETE_FAILED if fs.rm fails for a directory', async () => {
      // mockFs.lstat is a MockFunction, so mockResolvedValue already handles PathLike correctly
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      const error = new Error('Cannot delete directory') as any; error.code = 'EACCES';
      mockFs.rm.mockRejectedValue(error);
      await expect(deletePath(dirPath, true)).rejects.toThrow(ConduitError);
      try {
        await deletePath(dirPath, true);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_DELETE_FAILED);
        expect(e.message).toContain(`Failed to delete path: ${dirPath}. Error: Cannot delete directory`);
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

    it('should throw ERR_FS_NOT_FOUND if directory does not exist (ENOENT)', async () => {
      // mockFs.readdir is a MockFunction, so mockRejectedValue already handles PathLike correctly
      const error = new Error('Directory not found') as any; error.code = 'ENOENT';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
        expect(e.message).toContain(`Directory not found: ${dirPath}`);
      }
    });

    it('should throw ERR_FS_IS_FILE if path is a file (ENOTDIR)', async () => {
      // mockFs.readdir is a MockFunction, so mockRejectedValue already handles PathLike correctly
      const error = new Error('Path is a file') as any; error.code = 'ENOTDIR';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
        expect(e.message).toContain(`Path is a file, not a directory: ${dirPath}`);
      }
    });

    it('should throw ERR_FS_OPERATION_FAILED for other fs.readdir errors', async () => {
      // mockFs.readdir is a MockFunction, so mockRejectedValue already handles PathLike correctly
      const error = new Error('Permission denied') as any; error.code = 'EACCES';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(`Failed to list directory: ${dirPath}. Error: Permission denied`);
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
      expect(mockFs.stat).toHaveBeenCalledWith(destFile);   // Second call for destination
      expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, destFile, { recursive: false, force: true });
    });

    it('should copy a file into an existing directory', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false } as Stats); // Source is file
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true } as Stats);  // Destination is directory
      mockFs.cp.mockResolvedValue(undefined);
      const expectedDestPath = path.join(destDir, path.basename(sourceFile));

      await copyPath(sourceFile, destDir);
      expect(mockFs.stat).toHaveBeenCalledWith(sourceFile);
      expect(mockFs.stat).toHaveBeenCalledWith(destDir);
      expect(mockFs.cp).toHaveBeenCalledWith(sourceFile, expectedDestPath, { recursive: false, force: true });
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
      const error = new Error('Source not found') as any; error.code = 'ENOENT';
      mockFs.stat.mockRejectedValueOnce(error); // Source stat fails

      await expect(copyPath(sourceFile, destFile)).rejects.toThrow(ConduitError);
      try {
        await copyPath(sourceFile, destFile);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
        expect(e.message).toContain(`Source path not found for copy: ${sourceFile}`);
      }
    });

    it('should throw ERR_FS_OPERATION_FAILED if fs.cp fails', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false } as Stats);
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' }); // Dest doesn't exist
      const error = new Error('Copy failed') as any; error.code = 'EIO';
      mockFs.cp.mockRejectedValue(error);

      await expect(copyPath(sourceFile, destFile)).rejects.toThrow(ConduitError);
      try {
        await copyPath(sourceFile, destFile);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.OPERATION_FAILED);
        expect(e.message).toContain(`Failed to copy: ${sourceFile} to ${destFile}. Error: Copy failed`);
      }
    });

    it('should copy a file to a file, overwriting destination', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source.txt') return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
        if (pathStr === 'dest.txt') return { isDirectory: () => false, isFile: () => true, size: 200 } as Stats; // Dest exists
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      await copyPath('source.txt', 'dest.txt');
      expect(mockFs.cp).toHaveBeenCalledWith('source.txt', 'dest.txt', { recursive: false, force: true });
    });

    it('should copy a file into a directory', async () => {
      const sourceBasename = path.basename('source.txt');
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source.txt') return { isDirectory: () => false, isFile: () => true, size: 100 } as Stats;
        if (pathStr === 'dest_dir') return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      await copyPath('source.txt', 'dest_dir');
      expect(mockFs.cp).toHaveBeenCalledWith('source.txt', path.join('dest_dir', sourceBasename), { recursive: false, force: true });
    });

    it('should copy a directory to a new directory path (destination does not exist)', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source_dir') return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        if (pathStr === 'dest_dir_new') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); // Dest does not exist
        return { isDirectory: () => false, isFile: () => false } as Stats; // Default for other paths
      });
      await copyPath('source_dir', 'dest_dir_new');
      expect(mockFs.cp).toHaveBeenCalledWith('source_dir', 'dest_dir_new', { recursive: true, force: true });
    });
    
    it('should copy a directory into an existing directory (destination is a dir)', async () => {
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source_dir') return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        if (pathStr === 'existing_dest_dir') return { isDirectory: () => true, isFile: () => false, size: 0 } as Stats;
        return { isDirectory: () => false, isFile: () => false } as Stats; // Default for other paths
      });
      await copyPath('source_dir', 'existing_dest_dir');
      // fs.cp handles copying 'source_dir' *into* 'existing_dest_dir' correctly when dest is a dir.
      // The destination path for fs.cp remains 'existing_dest_dir'.
      expect(mockFs.cp).toHaveBeenCalledWith('source_dir', 'existing_dest_dir', { recursive: true, force: true });
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
      const mockPathDirname = vi.spyOn(path, 'dirname');
      mockPathDirname.mockReturnValueOnce('.'); // parent of 'dest_new.txt'
      
      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source.txt') return { isDirectory: () => false, isFile: () => true, mode: 0o644, birthtime: new Date(), mtime: new Date(), size: 10 } as Stats;
          if (pathStr === 'dest_new.txt') throw Object.assign(new Error('ENOENT_dest_new.txt'), { code: 'ENOENT' });
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false, mode: 0o755 } as Stats; // Parent of dest_new.txt
          throw Object.assign(new Error(`ENOENT_default_stat_mock_in_move_rename_test: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);


      await movePath('source.txt', 'dest_new.txt');
      
      expect(mockFs.unlink).not.toHaveBeenCalled(); // Destination doesn't exist, so no unlink
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Parent dir '.' is mocked to exist, so createDirectory should not be called for it.
      expect(mockFs.rename).toHaveBeenCalledWith('source.txt', 'dest_new.txt');
      mockPathDirname.mockRestore();
    });

    it('should move a file to overwrite an existing file', async () => {
      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source.txt') return { isDirectory: () => false, isFile: () => true, size:10 } as Stats;
          if (pathStr === 'dest_existing_file.txt') return { isDirectory: () => false, isFile: () => true, size:20 } as Stats; // Dest file exists
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats; // Parent dir of dest_existing_file.txt
          throw Object.assign(new Error(`ENOENT_move_overwrite_existing: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);

      await movePath('source.txt', 'dest_existing_file.txt');
      
      expect(mockFs.unlink).toHaveBeenCalledWith('dest_existing_file.txt'); // Existing file deleted
      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith('source.txt', 'dest_existing_file.txt');
    });

    it('should move a file into an existing directory', async () => {
      const sourceBasename = path.basename('source.txt');
      const destDirPath = 'existing_dest_dir';
      const finalDestPath = path.join(destDirPath, sourceBasename);

      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
          if (pathStr === destDirPath) return { isDirectory: () => true, isFile: () => false } as Stats; // Dest dir exists
          if (pathStr === finalDestPath) throw Object.assign(new Error('ENOENT_finalDestPath_not_exist_initially'), { code: 'ENOENT' }); 
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats; // Parent of destDirPath
          throw Object.assign(new Error(`ENOENT_stat_move_file_into_dir: ${pathStr}`), { code: 'ENOENT' });
      });
       mockFs.lstat.mockImplementation(mockFs.stat);

      await movePath('source.txt', destDirPath);
      
      expect(mockFs.unlink).not.toHaveBeenCalled(); // No file to overwrite at final path
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Dest dir and its parent exist
      expect(mockFs.rename).toHaveBeenCalledWith('source.txt', finalDestPath);
    });
    
    it('should move a file into an existing directory, overwriting a file of the same name', async () => {
      const sourceBasename = path.basename('source_to_overwrite.txt');
      const destDirPath = 'existing_dest_dir_with_conflict';
      const finalDestPath = path.join(destDirPath, sourceBasename);

      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source_to_overwrite.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
          if (pathStr === destDirPath) return { isDirectory: () => true, isFile: () => false } as Stats;
          if (pathStr === finalDestPath) return { isDirectory: () => false, isFile: () => true } as Stats; // File with same name exists in dest_dir
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats;
          throw Object.assign(new Error(`ENOENT_move_overwrite_in_dir: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);

      await movePath('source_to_overwrite.txt', destDirPath);
      
      expect(mockFs.unlink).toHaveBeenCalledWith(finalDestPath); // Existing file in dir is deleted
      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith('source_to_overwrite.txt', finalDestPath);
    });

    it('should move a file, creating intermediate destination directories', async () => {
      const destFilePath = 'new_parent_dir/sub_dir/dest_file.txt';
      const parentOfFinalDest = path.dirname(destFilePath); // 'new_parent_dir/sub_dir'
      
      mockFs.stat.mockReset();
      let parentDirExists = false;
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source_for_mkdir.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
          if (pathStr === destFilePath) throw Object.assign(new Error('ENOENT_destFilePath'), { code: 'ENOENT' });
          if (pathStr === parentOfFinalDest) {
            if (!parentDirExists) throw Object.assign(new Error('ENOENT_parentOfFinalDest_initially'), { code: 'ENOENT' });
            return { isDirectory: () => true, isFile: () => false } as Stats; // Exists after creation
          }
          if (pathStr === 'new_parent_dir') throw Object.assign(new Error('ENOENT_new_parent_dir'), { code: 'ENOENT' });
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats; // Current dir exists
          throw Object.assign(new Error(`ENOENT_move_mkdir_intermediate: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);
      mockFs.mkdir.mockImplementation(async (p: import('fs').PathLike, options: any) => {
        const pathStr = p.toString();
        if (pathStr === parentOfFinalDest && options.recursive) {
            parentDirExists = true; // Simulate directory creation
            return undefined;
        }
        throw new Error('Unexpected mkdir call');
      });

      await movePath('source_for_mkdir.txt', destFilePath);
      
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.mkdir).toHaveBeenCalledWith(parentOfFinalDest, { recursive: true }); 
      expect(mockFs.rename).toHaveBeenCalledWith('source_for_mkdir.txt', destFilePath);
    });
    
    it('should move a directory to a new path', async () => {
      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source_dir_to_move') return { isDirectory: () => true, isFile: () => false } as Stats;
          if (pathStr === 'new_dest_dir_path') throw Object.assign(new Error('ENOENT_new_dest_dir_path'), { code: 'ENOENT' });
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats; // Parent of new_dest_dir_path assumed to be '.'
          throw Object.assign(new Error(`ENOENT_move_dir_new_path: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);

      await movePath('source_dir_to_move', 'new_dest_dir_path');
      
      expect(mockFs.unlink).not.toHaveBeenCalled(); // Not overwriting a file
      expect(mockFs.mkdir).not.toHaveBeenCalled(); // Parent dir exists, dest is not a file path
      expect(mockFs.rename).toHaveBeenCalledWith('source_dir_to_move', 'new_dest_dir_path');
    });

    it('should throw ConduitError if source path does not exist for move', async () => {
      mockFs.stat.mockReset();
      mockFs.stat.mockRejectedValueOnce(Object.assign(new Error('ENOENT_source_nonexistent'), { code: 'ENOENT' }));
      
      await expect(movePath('nonexistent_source_for_move', 'dest_path_for_move'))
        .rejects.toThrow(ConduitError);
      mockFs.stat.mockRejectedValueOnce(Object.assign(new Error('ENOENT_source_nonexistent_again'), { code: 'ENOENT' }));
      await expect(movePath('nonexistent_source_for_move', 'dest_path_for_move'))
        .rejects.toHaveProperty('errorCode', ErrorCode.ERR_FS_NOT_FOUND);
      
      expect(mockFs.rename).not.toHaveBeenCalled();
    });
    
    it('should throw ConduitError for other fs.rename errors', async () => {
      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source_rename_fail.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
          if (pathStr === 'dest_rename_fail.txt') throw Object.assign(new Error('ENOENT_dest_rename_fail'), { code: 'ENOENT' });
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats;
          throw Object.assign(new Error(`ENOENT_rename_fail_setup: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);
      mockFs.rename.mockRejectedValueOnce(new Error('FS rename failed miserably'));
      
      await expect(movePath('source_rename_fail.txt', 'dest_rename_fail.txt'))
        .rejects.toThrow(ConduitError);
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
        const pathStr = p.toString();
        if (pathStr === 'source_rename_fail.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
        if (pathStr === 'dest_rename_fail.txt') throw Object.assign(new Error('ENOENT_dest_rename_fail'), { code: 'ENOENT' });
        if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats;
        throw Object.assign(new Error(`ENOENT_rename_fail_setup_again: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);
      mockFs.rename.mockRejectedValueOnce(new Error('FS rename failed miserably again'));
      await expect(movePath('source_rename_fail.txt', 'dest_rename_fail.txt'))
        .rejects.toHaveProperty('errorCode', ErrorCode.OPERATION_FAILED);
    });

     it('should not attempt to delete destination if it is a directory (file overwrite only)', async () => {
      mockFs.stat.mockReset();
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
          const pathStr = p.toString();
          if (pathStr === 'source_file.txt') return { isDirectory: () => false, isFile: () => true } as Stats;
          if (pathStr === 'existing_target_dir') return { isDirectory: () => true, isFile: () => false } as Stats; 
          if (pathStr === path.join('existing_target_dir', 'source_file.txt')) return { isDirectory: () => true, isFile: () => false } as Stats; 
          if (pathStr === '.') return { isDirectory: () => true, isFile: () => false } as Stats;
          throw Object.assign(new Error(`ENOENT_move_target_is_dir: ${pathStr}`), { code: 'ENOENT' });
      });
      mockFs.lstat.mockImplementation(mockFs.stat);

      await movePath('source_file.txt', 'existing_target_dir');
      
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith('source_file.txt', path.join('existing_target_dir', 'source_file.txt'));
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
        expect(e.message).toContain(`Failed to touch file: ${filePath}. Error: ${utimesError.message}`);
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
      mockReset(mockFs.lstat);
      mockReset(mockedGetMimeType);
      // Provide a default minimal mock for lstat for this suite
      mockFs.lstat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 0,
        mtime: now,
        birthtime: now,
        mode: 0o777, // Default to full permissions
      } as Stats);

      // Ensure conduitConfig is reset to default test values or specific test values if needed
      (configLoader.conduitConfig as any) = { ...defaultTestConfig };
    });

    it('should create EntryInfo for a file correctly', async () => {
      vi.mocked(getMimeType).mockResolvedValueOnce('text/plain');
      const entryInfo = await createEntryInfo('/test/file.txt', {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 1234,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o100644, // regular file, rw-r--r--
        uid: 1000,
        gid: 1000,
        dev: 1,
        ino: 123,
        nlink: 1,
        rdev: 0,
        blksize: 4096,
        blocks: 1,
      });

      expect(getMimeType).toHaveBeenCalledWith('/test/file.txt');
      expect(entryInfo).toEqual({
        name: 'file.txt',
        path: '/test/file.txt',
        type: 'file',
        size_bytes: 1234,
        mime_type: 'text/plain',
        created_at_iso: formattedDate,
        modified_at_iso: formattedDate,
        permissions_octal: '0644',
        permissions_string: 'rw-r--r--',
      });
    });

    it('should create EntryInfo for a directory correctly', async () => {
      const entryInfo = await createEntryInfo('/test/directory', {
        isFile: () => false,
        isDirectory: () => true,
        size: 4096, // Directories have size
        mode: 0o40755, // directory, rwxr-xr-x
      });

      expect(getMimeType).not.toHaveBeenCalled(); // Not called for directories
      expect(entryInfo).toEqual({
        name: 'directory',
        path: '/test/directory',
        type: 'directory',
        size_bytes: 4096,
        mime_type: undefined, // No mime type for directories
        created_at_iso: formattedDate,
        modified_at_iso: formattedDate,
        permissions_octal: '0755',
        permissions_string: 'rwxr-xr-x',
      });
    });

    it('should not call getMimeType for a zero-byte file', async () => {
      const entryInfo = await createEntryInfo('/test/file.txt', {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 0,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o777, // Default to full permissions
      });
      expect(getMimeType).not.toHaveBeenCalled();
      expect(entryInfo.mime_type).toBeUndefined();
    });

    it('should use provided name override', async () => {
      const overriddenName = 'customName.zip';
      vi.mocked(getMimeType).mockResolvedValueOnce('application/zip');
      const entryInfo = await createEntryInfo('/test/file.txt', {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 1234,
        birthtime: now,
        mtime: now,
        atime: now,
        mode: 0o100644, // regular file, rw-r--r--
      }, overriddenName);
      expect(entryInfo.name).toBe(overriddenName);
      expect(entryInfo.mime_type).toBe('application/zip');
    });
    
    it('should correctly format permissions string for different modes', async () => {
        const statsWithFullPermissions: Stats = { ...{
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1234,
          birthtime: now,
          mtime: now,
          atime: now,
          mode: 0o100777, // rwxrwxrwx
        }, ...{ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1234, birthtime: now, mtime: now, atime: now, mode: 0o100777 } };
        let entryInfo = await createEntryInfo('/test/full_perm_file.sh', statsWithFullPermissions);
        expect(entryInfo.permissions_string).toBe('rwxrwxrwx');
        expect(entryInfo.permissions_octal).toBe('0777');

        const statsWithMinimalPermissions: Stats = { ...{
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1234,
          birthtime: now,
          mtime: now,
          atime: now,
          mode: 0o100000, // ---------
        }, ...{ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1234, birthtime: now, mtime: now, atime: now, mode: 0o100000 } };
        entryInfo = await createEntryInfo('/test/no_perm_file.dat', statsWithMinimalPermissions);
        expect(entryInfo.permissions_string).toBe('---------');
        expect(entryInfo.permissions_octal).toBe('0000');

        const statsWithMixedPermissions: Stats = { ...{
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1234,
          birthtime: now,
          mtime: now,
          atime: now,
          mode: 0o100750, // rwxr-x---
        }, ...{ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1234, birthtime: now, mtime: now, atime: now, mode: 0o100750 } };
        entryInfo = await createEntryInfo('/test/mixed_perm_file.cfg', statsWithMixedPermissions);
        expect(entryInfo.permissions_string).toBe('rwxr-x---');
        expect(entryInfo.permissions_octal).toBe('0750');
    });
  });

  describe('calculateRecursiveDirectorySize', () => {
    const baseDir = '/base';
    let startTime: number;
    const maxDepth = conduitConfig.maxRecursiveDepth; // Use from (mocked) config
    const timeoutMs = conduitConfig.recursiveSizeTimeoutMs; // Use from (mocked) config

    // Helper to create Dirent-like objects for mockFs.readdir
    const createDirent = (name: string, isFile: boolean, isDirectory: boolean): Partial<import('fs').Dirent> => ({
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
        if (pathStr === path.join(baseDir, 'file1.txt')) return { size: 100, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'file2.txt')) return { size: 200, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(baseDir, 0, maxDepth, timeoutMs, startTime);
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
        if (pathStr === baseDir) return [createDirent('file1.txt', true, false), createDirent('sub1', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1')) return [createDirent('file2.txt', true, false), createDirent('sub2', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2')) return [createDirent('file3.txt', true, false), createDirent('sub3', false, true)] as any;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'sub3')) return [createDirent('file4.txt', true, false)] as any; // Beyond maxDepth for sub2 call
        throw new Error(`Unexpected readdir call: ${pathStr}`);
      });

      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file1.txt')) return { size: 10, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'file2.txt')) return { size: 20, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'file3.txt')) return { size: 30, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'sub3', 'file4.txt')) return { size: 40, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(baseDir, 0, testMaxDepth, timeoutMs, startTime);
      // Expected: file1 (10) + file2 (20) + file3 (30) = 60
      // file4 should be skipped due to maxDepth relative to the recursive call for sub2
      expect(result.size).toBe(60);
      expect(result.note).toBe('Partial size: depth limit reached'); // sub3 was not entered from sub2
    });

    it('should return note if initial depth exceeds maxDepth', async () => {
      const result = await calculateRecursiveDirectorySize(baseDir, maxDepth + 1, maxDepth, timeoutMs, startTime);
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
        if (pathStr === path.join(baseDir, 'file1.txt')) return { size: 100, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'file2_timeout.txt')) {
          vi.advanceTimersByTime(timeoutMs + 1); // Advance time past timeout
          return { size: 200, isFile: () => true, isDirectory: () => false } as Stats;
        }
        if (pathStr === path.join(baseDir, 'file3.txt')) return { size: 300, isFile: () => true, isDirectory: () => false } as Stats; // Should not be reached
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(baseDir, 0, maxDepth, timeoutMs, startTime);
      expect(result.size).toBe(100); // Only file1.txt before timeout is hit by checking Date.now() *before* processing file2
      expect(result.note).toBe('Calculation timed out due to server limit');
      expect(mockFs.stat).toHaveBeenCalledTimes(2); // Called for file1.txt and file2_timeout.txt (where timeout occurs before summing)
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
      const result = await calculateRecursiveDirectorySize(baseDir, 0, maxDepth, timeoutMs, startTime);
      expect(result.size).toBe(0); // Size from sub_causes_timeout not added as it timed out internally
      expect(result.note).toBe('Calculation timed out due to server limit');
    });

    it('should handle fs.readdir error gracefully', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('Read dir permission denied'));
      const result = await calculateRecursiveDirectorySize(baseDir, 0, maxDepth, timeoutMs, startTime);
      expect(result.size).toBe(0);
      expect(result.note).toBe('Error during size calculation');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`Error reading directory ${baseDir}`));
    });

    it('should handle fs.stat error for a file gracefully and continue', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        createDirent('file_ok.txt', true, false),
        createDirent('file_stat_error.txt', true, false),
        createDirent('file_after_error.txt', true, false),
      ] as any);
      mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
        const pathStr = p.toString();
        if (pathStr === path.join(baseDir, 'file_ok.txt')) return { size: 70, isFile: () => true, isDirectory: () => false } as Stats;
        if (pathStr === path.join(baseDir, 'file_stat_error.txt')) throw new Error('Stat failed for this file');
        if (pathStr === path.join(baseDir, 'file_after_error.txt')) return { size: 30, isFile: () => true, isDirectory: () => false } as Stats;
        return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
      });

      const result = await calculateRecursiveDirectorySize(baseDir, 0, maxDepth, timeoutMs, startTime);
      expect(result.size).toBe(100); // 70 + 30, file_stat_error.txt is skipped
      expect(result.note).toBeUndefined(); // No overall error note, just a warning
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`Could not stat file ${path.join(baseDir, 'file_stat_error.txt')}`));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_ok.txt'));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_stat_error.txt'));
      expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_after_error.txt'));
    });
  });
});