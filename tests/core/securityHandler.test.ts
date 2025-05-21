import { vi } from 'vitest';
import { validateAndResolvePath, validatePathForCreation } from '@/core/securityHandler';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import fsPromises from 'fs/promises'; // Import fs/promises as a namespace
import type { Stats, PathLike } from 'fs'; // Import types from 'fs'
import path from 'path';

// Mock fs/promises
vi.mock('fs/promises');
const mockFs = fsPromises as import('vitest').Mocked<typeof fsPromises>; // Typed mock, using the namespace import

// Mock configLoader.conduitConfig
const mockConduitConfig = {
  allowedPaths: [path.resolve('/allowed/path1'), path.resolve('/allowed/path2/sub')],
  // Add other necessary config properties if securityHandler uses them directly
  // For now, only allowedPaths is critical for these tests.
  logLevel: 'INFO',
  httpTimeoutMs: 30000,
  maxPayloadSizeBytes: 1024,
  maxFileReadBytes: 1024,
  maxUrlDownloadBytes: 1024,
  imageCompressionThresholdBytes: 1024,
  imageCompressionQuality: 75,
  defaultChecksumAlgorithm: 'sha256',
  maxRecursiveDepth: 10,
  recursiveSizeTimeoutMs: 60000,
  serverStartTimeIso: new Date().toISOString(),
  serverVersion: '1.0.0-test'
};
vi.mock('@/core/configLoader', () => ({
  get conduitConfig() { return mockConduitConfig; }
}));


describe('securityHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations for fs operations
    mockFs.lstat.mockImplementation(async (p: PathLike) => {
      const pStr = p.toString();
      if (pStr.includes('nonexistent')) throw { code: 'ENOENT' };
      if (pStr.includes('symlinkloop')) throw new Error('Too many symbolic links');
      return { 
        isSymbolicLink: () => pStr.includes('symlink') && !pStr.includes('symlink_target'),
        // Add other fs.Stats properties if needed by the code path being tested
        isFile: () => true, isDirectory: () => false, ino: 0, dev:0, mode:0, nlink:0,uid:0,gid:0,rdev:0,size:0,blksize:0,blocks:0,atimeMs:0,mtimeMs:0,ctimeMs:0,birthtimeMs:0,atime:new Date(),mtime:new Date(),ctime:new Date(),birthtime:new Date()
      } as Stats; // Use imported Stats
    });
    mockFs.readlink.mockImplementation(async (p: PathLike) => {
        const pStr = p.toString();
        if(pStr.includes('symlink_to_allowed')) return path.resolve('/allowed/path1/file.txt');
        if(pStr.includes('symlink_to_disallowed')) return path.resolve('/disallowed/file.txt');
        if(pStr.includes('symlink_to_relative_allowed')) return '../path1/relative_target.txt'; // relative from symlink location
        if(pStr.includes('symlink_to_relative_disallowed')) return '../../../../outside/file.txt';
        return pStr.replace('symlink', 'symlink_target');
    });
    mockFs.realpath.mockImplementation(async (p: PathLike) => {
        // Simplified realpath: assumes path.resolve is enough after symlink resolution in tests
        // or returns a pre-resolved form based on test case names
        const pStr = p.toString();
        if (pStr.includes('symlink_to_allowed')) return path.resolve('/allowed/path1/file.txt');
        if (pStr.includes('symlink_to_disallowed')) return path.resolve('/disallowed/file.txt');
        if (pStr.includes('symlink_to_relative_allowed_resolved')) return path.resolve('/allowed/path1/relative_target.txt');
        if (pStr.includes('symlink_to_relative_disallowed_resolved')) return path.resolve('/outside/file.txt');
        if (pStr.includes('nonexistent')) throw { code: 'ENOENT' }; 
        return path.resolve(pStr); // Default realpath mock
    });
  });

  describe('validateAndResolvePath', () => {
    it('should allow access to a path directly within an allowed directory', async () => {
      const userPath = '/allowed/path1/somefile.txt';
      const resolved = await validateAndResolvePath(userPath);
      expect(resolved).toBe(path.resolve(userPath));
    });

    it('should allow access to a path within a nested allowed directory', async () => {
      const userPath = '/allowed/path2/sub/somefile.txt';
      const resolved = await validateAndResolvePath(userPath);
      expect(resolved).toBe(path.resolve(userPath));
    });

    it('should deny access to a path outside allowed directories', async () => {
      const userPath = '/disallowed/path/somefile.txt';
      await expect(validateAndResolvePath(userPath))
        .rejects.toThrow(new ConduitError(ErrorCode.ACCESS_DENIED, `Access to path '${userPath}' is denied.`));
    });

    it('should deny access using path traversal like ..', async () => {
      const userPath = '/allowed/path1/../../disallowed/file.txt';
      await expect(validateAndResolvePath(userPath))
        .rejects.toThrow(new ConduitError(ErrorCode.ACCESS_DENIED, expect.stringContaining('Access to path')));
    });

    it('should resolve and allow a symlink pointing to an allowed path', async () => {
      // Mock setup for this specific test case in beforeEach might be more robust,
      // but for now, assume mockFs.realpath handles it if path includes 'symlink_to_allowed'
      const userPath = '/some/path/symlink_to_allowed';
      mockFs.realpath.mockResolvedValueOnce(path.resolve('/allowed/path1/file.txt')); // Override for this one call
      const resolved = await validateAndResolvePath(userPath);
      expect(resolved).toBe(path.resolve('/allowed/path1/file.txt'));
    });

    it('should resolve and deny a symlink pointing to a disallowed path', async () => {
      const userPath = '/allowed/path1/symlink_to_disallowed';
      // Symlink itself is in allowed path, but its target (after realpath) is not.
      // resolveToRealPath internally calls lstat and readlink, then realpath.
      // Our mocks need to simulate this flow correctly.
      // Let's refine mocks for symlink tests if current ones are insufficient.
      mockFs.realpath.mockResolvedValueOnce(path.resolve('/disallowed/file.txt')); 
      await expect(validateAndResolvePath(userPath))
        .rejects.toThrow(new ConduitError(ErrorCode.ACCESS_DENIED, expect.stringContaining('Access to path')));
    });
    
    it('should handle symlink to relative path resolving to allowed', async () => {
        const userPath = '/allowed/path2/symlink_to_relative_allowed'; // symlink at /allowed/path2/symlink...
        // readlink returns '../path1/relative_target.txt'
        // resolved from /allowed/path2/ is /allowed/path1/relative_target.txt
        mockFs.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true } as Stats);
        mockFs.readlink.mockResolvedValueOnce('../path1/relative_target.txt');
        mockFs.realpath.mockResolvedValueOnce(path.resolve('/allowed/path1/relative_target.txt'));
        
        const resolved = await validateAndResolvePath(userPath);
        expect(resolved).toBe(path.resolve('/allowed/path1/relative_target.txt'));
    });

    it('should handle symlink to relative path resolving to disallowed', async () => {
        const userPath = '/allowed/path1/symlink_to_relative_disallowed'; // symlink at /allowed/path1/symlink...
        // readlink returns '../../../../outside/file.txt'
        // resolved from /allowed/path1/ is /../../outside/file.txt -> /outside/file.txt
        mockFs.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true } as Stats);
        mockFs.readlink.mockResolvedValueOnce('../../../../outside/file.txt');
        mockFs.realpath.mockResolvedValueOnce(path.resolve('/outside/file.txt'));

        await expect(validateAndResolvePath(userPath))
            .rejects.toThrow(new ConduitError(ErrorCode.ACCESS_DENIED));
    });

    it('should throw ERR_FS_NOT_FOUND if path does not exist and isExistenceRequired is true', async () => {
      const userPath = '/allowed/path1/nonexistentfile.txt';
      // mockFs.realpath will throw ENOENT from its default implementation if path includes 'nonexistent'
      await expect(validateAndResolvePath(userPath, { isExistenceRequired: true }))
        .rejects.toThrow(new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Path not found or could not be resolved: ${userPath}`));
    });

    it('should succeed if path does not exist but isExistenceRequired is false and path is in allowed dir', async () => {
      const userPath = '/allowed/path1/newfile.txt';
      // Mock realpath to throw ENOENT, simulating non-existence
      mockFs.realpath.mockRejectedValueOnce({ code: 'ENOENT' }); 
      const resolved = await validateAndResolvePath(userPath, { isExistenceRequired: false });
      // It should return the path.resolve() version, not the realpath, as realpath failed.
      expect(resolved).toBe(path.resolve(userPath));
    });

    it('should deny if path does not exist, isExistenceRequired is false, but path is in disallowed dir', async () => {
      const userPath = '/disallowed/path/newfile.txt';
      mockFs.realpath.mockRejectedValueOnce({ code: 'ENOENT' });
      await expect(validateAndResolvePath(userPath, { isExistenceRequired: false }))
        .rejects.toThrow(new ConduitError(ErrorCode.ACCESS_DENIED));
    });

    it('should throw ERR_FS_BAD_PATH_INPUT for empty or whitespace path', async () => {
      await expect(validateAndResolvePath(''))
        .rejects.toThrow(new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.'));
      await expect(validateAndResolvePath('   '))
        .rejects.toThrow(new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.'));
    });
  });

  describe('validatePathForCreation', () => {
    it('should allow a path for creation if its resolved absolute form is within allowed directories', async () => {
      const userPath = '/allowed/path1/new_sub/newfile.txt';
      const resolved = validatePathForCreation(userPath);
      expect(resolved).toBe(path.resolve(userPath));
    });

    it('should deny a path for creation if its resolved absolute form is outside allowed directories', async () => {
      const userPath = '/disallowed/new_sub/newfile.txt';
      expect(() => validatePathForCreation(userPath))
        .toThrow(new ConduitError(ErrorCode.ACCESS_DENIED, expect.stringContaining('Access to path')));
    });
    
    it('should deny path traversal for creation path', () => {
        const userPath = '/allowed/path1/../../disallowed/newfile.txt';
        expect(() => validatePathForCreation(userPath))
            .toThrow(new ConduitError(ErrorCode.ACCESS_DENIED));
    });

    it('should throw ERR_FS_BAD_PATH_INPUT for empty or whitespace path for creation', async () => {
      expect(() => validatePathForCreation(''))
        .toThrow(new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.'));
      expect(() => validatePathForCreation('   '))
        .toThrow(new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.'));
    });
  });
}); 