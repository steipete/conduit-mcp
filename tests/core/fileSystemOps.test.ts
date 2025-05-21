import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  // calculateRecursiveDirectorySize, // Will add later due to complexity
} from '@/core/fileSystemOps';

// Import dependencies to be mocked or used
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { conduitConfig } from '@/core/configLoader'; // For default limits
import logger from '@/utils/logger'; // Mocked globally
import { EntryInfo, formatToISO8601UTC, getMimeType } from '@/internal';

// Mock the entire fs/promises module
const mockFs = {
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
vi.mock('fs/promises', () => mockFs);

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
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_OPERATION_FAILED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_OPERATION_FAILED);
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
      mockFs.readFile.mockResolvedValue(fileBuffer); // readFile in fs/promises returns buffer by default
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
        expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_OPERATION_FAILED);
        expect(e.message).toContain(`Failed to create directory: ${dirPath}. Error: Permission denied`);
      }
    });
  });

  // Tests for deletePath
  describe('deletePath', () => {
    const filePath = '/path/to/file.txt';
    const dirPath = '/path/to/dir';

    it('should delete a file using fs.unlink', async () => {
      mockFs.lstat.mockResolvedValue({ isDirectory: () => false } as Stats);
      mockFs.unlink.mockResolvedValue(undefined);
      await deletePath(filePath);
      expect(mockFs.lstat).toHaveBeenCalledWith(filePath);
      expect(mockFs.unlink).toHaveBeenCalledWith(filePath);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('should delete a directory using fs.rm with recursive option based on param', async () => {
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockFs.rm.mockResolvedValue(undefined);
      await deletePath(dirPath, true); // Recursive true
      expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
      expect(mockFs.rm).toHaveBeenCalledWith(dirPath, { recursive: true, force: true });
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('should delete a directory using fs.rm (non-recursive by default for rm call structure in code)', async () => {
      mockFs.lstat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockFs.rm.mockResolvedValue(undefined);
      await deletePath(dirPath, false); // Recursive false
      expect(mockFs.lstat).toHaveBeenCalledWith(dirPath);
      expect(mockFs.rm).toHaveBeenCalledWith(dirPath, { recursive: false, force: false });
    });

    it('should be idempotent and log debug if path does not exist (ENOENT on lstat)', async () => {
      const error = new Error('Path does not exist') as any; error.code = 'ENOENT';
      mockFs.lstat.mockRejectedValue(error);
      await expect(deletePath(filePath)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(`Path not found for deletion (considered success): ${filePath}`);
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it('should throw ERR_FS_DELETE_FAILED if fs.unlink fails for a file', async () => {
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
      mockFs.readdir.mockResolvedValue(entries as any); // fs.readdir returns string[] or Dirent[]
      const result = await listDirectory(dirPath);
      expect(result).toEqual(entries);
      expect(mockFs.readdir).toHaveBeenCalledWith(dirPath);
    });

    it('should throw ERR_FS_NOT_FOUND if directory does not exist (ENOENT)', async () => {
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
      const error = new Error('Path is a file') as any; error.code = 'ENOTDIR';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_IS_FILE);
        expect(e.message).toContain(`Path is a file, not a directory: ${dirPath}`);
      }
    });

    it('should throw ERR_FS_OPERATION_FAILED for other fs.readdir errors', async () => {
      const error = new Error('Permission denied') as any; error.code = 'EACCES';
      mockFs.readdir.mockRejectedValue(error);
      await expect(listDirectory(dirPath)).rejects.toThrow(ConduitError);
      try {
        await listDirectory(dirPath);
      } catch (e: any) {
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_OPERATION_FAILED);
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
        expect(e.errorCode).toBe(ErrorCode.ERR_FS_OPERATION_FAILED);
        expect(e.message).toContain(`Failed to copy: ${sourceFile} to ${destFile}. Error: Copy failed`);
      }
    });
  });

});
