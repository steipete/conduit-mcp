import { vi } from 'vitest';
import { validateAndResolvePath } from '@/core/securityHandler';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
// Removed unused logger import
import fsPromises from 'fs/promises'; // Import fs/promises as a namespace
import type { Stats, PathLike } from 'fs'; // Import types from 'fs'
import path from 'path';
import os from 'os'; // Import os
import { fileSystemOps } from '@/internal';
import { conduitConfig } from '@/internal';

// Mock fs/promises
vi.mock('fs/promises');
const mockFs = fsPromises as import('vitest').Mocked<typeof fsPromises>; // Typed mock, using the namespace import

// Mock os
vi.mock('os');
const mockOs = os as import('vitest').Mocked<typeof os>;

// Mock fileSystemOps
vi.mock('@/core/fileSystemOps', () => ({
  pathExists: vi.fn(),
}));

// Mock configLoader.conduitConfig
vi.mock('@/core/configLoader', () => {
  const mockConfig = {
    allowedPaths: ['/allowed/path1', '/allowed/path2/sub'],
    resolvedAllowedPaths: ['/allowed/path1', '/allowed/path2/sub'],
    workspaceRoot: '/workspace',
    allowTildeExpansion: true,
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
    serverVersion: '1.0.0-test',
  };
  return {
    loadConfig: () => mockConfig,
    get conduitConfig() {
      return mockConfig;
    },
  };
});

// Type the imported conduitConfig as mutable for tests
const mockConduitConfig = conduitConfig as typeof conduitConfig & {
  allowedPaths: string[];
  resolvedAllowedPaths: string[];
};

describe('securityHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock os.homedir()
    mockOs.homedir.mockReturnValue('/mock/home');

    // Mock fileSystemOps.pathExists
    vi.mocked(fileSystemOps.pathExists).mockImplementation(async (p: string) => {
      return !p.includes('nonexistent');
    });

    // Default mock implementations for fs operations
    mockFs.lstat.mockImplementation(async (p: PathLike) => {
      const pStr = p.toString();
      if (pStr.includes('nonexistent'))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (pStr.includes('symlinkloop')) throw new Error('Too many symbolic links');
      return {
        isSymbolicLink: () => pStr.includes('symlink') && !pStr.includes('symlink_target'),
        // Add other fs.Stats properties if needed by the code path being tested
        isFile: () => true,
        isDirectory: () => false,
        ino: 0,
        dev: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: 0,
        blksize: 0,
        blocks: 0,
        atimeMs: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      } as Stats; // Use imported Stats
    });
    mockFs.readlink.mockImplementation(async (p: PathLike) => {
      const pStr = p.toString();
      if (pStr.includes('symlink_to_allowed')) return path.resolve('/allowed/path1/file.txt');
      if (pStr.includes('symlink_to_disallowed')) return path.resolve('/disallowed/file.txt');
      if (pStr.includes('symlink_to_relative_allowed')) return '../path1/relative_target.txt'; // relative from symlink location
      if (pStr.includes('symlink_to_relative_disallowed')) return '../../../../outside/file.txt';
      return pStr.replace('symlink', 'symlink_target');
    });
    mockFs.realpath.mockImplementation(async (p: PathLike) => {
      // Simplified realpath: assumes path.resolve is enough after symlink resolution in tests
      // or returns a pre-resolved form based on test case names
      const pStr = p.toString();
      if (pStr.includes('symlink_to_allowed')) return path.resolve('/allowed/path1/file.txt');
      if (pStr.includes('symlink_to_disallowed')) return path.resolve('/disallowed/file.txt');
      if (pStr.includes('symlink_to_relative_allowed_resolved'))
        return path.resolve('/allowed/path1/relative_target.txt');
      if (pStr.includes('symlink_to_relative_disallowed_resolved'))
        return path.resolve('/outside/file.txt');
      if (pStr.includes('nonexistent'))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return path.resolve(pStr); // Default realpath mock
    });
    mockFs.stat.mockImplementation(async (p: PathLike) => {
      const pStr = p.toString();
      if (pStr.includes('nonexistent'))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return {
        isFile: () => true,
        isDirectory: () => false,
        // Add other fs.Stats properties as needed
      } as Stats;
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
      await expect(validateAndResolvePath(userPath)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
    });

    it('should deny access using path traversal like ..', async () => {
      const userPath = '/allowed/path1/../../disallowed/file.txt';
      await expect(validateAndResolvePath(userPath)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
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
      await expect(validateAndResolvePath(userPath)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
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

      await expect(validateAndResolvePath(userPath)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
    });

    it('should throw ERR_FS_NOT_FOUND if path does not exist and isExistenceRequired is true', async () => {
      const userPath = '/allowed/path1/nonexistentfile.txt';
      // mockFs.realpath will throw ENOENT from its default implementation if path includes 'nonexistent'
      await expect(validateAndResolvePath(userPath, { isExistenceRequired: true })).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_NOT_FOUND,
          `Path not found: ${userPath} (resolved to ${userPath})`
        )
      );
    });

    it('should succeed if path does not exist but isExistenceRequired is false and path is in allowed dir', async () => {
      const userPath = '/allowed/path1/newfile.txt';
      // Mock realpath to throw ENOENT, simulating non-existence
      mockFs.realpath.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const resolved = await validateAndResolvePath(userPath, { isExistenceRequired: false });
      // It should return the path.resolve() version, not the realpath, as realpath failed.
      expect(resolved).toBe(path.resolve(userPath));
    });

    it('should deny if path does not exist, isExistenceRequired is false, but path is in disallowed dir', async () => {
      const userPath = '/disallowed/path/newfile.txt';
      mockFs.realpath.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      await expect(
        validateAndResolvePath(userPath, { isExistenceRequired: false })
      ).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
    });

    it('should throw ERR_FS_BAD_PATH_INPUT for empty or whitespace path', async () => {
      await expect(validateAndResolvePath('')).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.')
      );
      await expect(validateAndResolvePath('   ')).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.')
      );
    });

    it('should resolve tilde (~) to mocked home directory and allow if path is within allowed paths', async () => {
      const userPath = '~/allowed_in_home/file.txt';
      const expectedPath = path.resolve('/mock/home/allowed_in_home/file.txt');
      // Adjust mockConduitConfig.allowedPaths to include a path within /mock/home for this test
      mockConduitConfig.allowedPaths = [path.resolve('/mock/home/allowed_in_home')];
      mockConduitConfig.resolvedAllowedPaths = [path.resolve('/mock/home/allowed_in_home')];
      mockFs.realpath.mockResolvedValueOnce(expectedPath);

      const resolved = await validateAndResolvePath(userPath);
      expect(resolved).toBe(expectedPath);
      // Reset allowedPaths for other tests if necessary, or ensure tests are independent
      // For now, we assume tests re-initialize config or this is the last relevant test for allowedPaths modification.
      // Better to set it specifically for the test and revert or have beforeEach handle default config.
      // Let's restore it.
      mockConduitConfig.allowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
      mockConduitConfig.resolvedAllowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
    });

    it('should resolve tilde (~) and deny if resulting path is outside allowed paths', async () => {
      const userPath = '~/disallowed_in_home/file.txt';
      const resolvedUserPath = path.resolve('/mock/home/disallowed_in_home/file.txt');
      // Ensure default allowedPaths do not include /mock/home/disallowed_in_home
      mockConduitConfig.allowedPaths = [path.resolve('/allowed/path1')];
      mockConduitConfig.resolvedAllowedPaths = [path.resolve('/allowed/path1')];
      mockFs.realpath.mockResolvedValueOnce(resolvedUserPath);

      await expect(validateAndResolvePath(userPath)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${userPath}`
        )
      );
      // Restore allowedPaths
      mockConduitConfig.allowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
      mockConduitConfig.resolvedAllowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
    });

    it('should correctly resolve a path that starts with ~/ and points to an existing, allowed file', async () => {
      const userPath = '~/file.txt';
      const homeDir = '/mock/home';
      mockOs.homedir.mockReturnValue(homeDir);
      const expectedResolvedPath = path.join(homeDir, 'file.txt');

      mockConduitConfig.allowedPaths = [homeDir]; // Allow the home directory
      mockConduitConfig.resolvedAllowedPaths = [homeDir]; // Allow the home directory
      mockFs.realpath.mockResolvedValue(expectedResolvedPath); // Simulate file exists at the resolved path

      const resolved = await validateAndResolvePath(userPath, { isExistenceRequired: true });
      expect(mockOs.homedir).toHaveBeenCalled();
      expect(resolved).toBe(expectedResolvedPath);

      // Restore original allowedPaths for other tests
      mockConduitConfig.allowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
      mockConduitConfig.resolvedAllowedPaths = [
        path.resolve('/allowed/path1'),
        path.resolve('/allowed/path2/sub'),
      ];
    });

    it('should correctly resolve a path with ~/ that points to a non-existent file in an allowed directory when existence is not required', async () => {
      const userPath = '~/new_file.txt';
      const homeDir = '/mock/home';
      mockOs.homedir.mockReturnValue(homeDir);
      const expectedResolvedPath = path.join(homeDir, 'new_file.txt');

      mockConduitConfig.allowedPaths = [homeDir]; // Allow the home directory
      mockConduitConfig.resolvedAllowedPaths = [homeDir]; // Allow the home directory
      // Simulate realpath throwing ENOENT because new_file.txt doesn't exist
      mockFs.realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const resolved = await validateAndResolvePath(userPath, { isExistenceRequired: false });
      expect(mockOs.homedir).toHaveBeenCalled();
      // When realpath fails with ENOENT and existence is not required,
      // validateAndResolvePath should return the path.resolve() version, not the realpath one.
      expect(resolved).toBe(path.resolve(expectedResolvedPath)); // path.resolve() on the tilde-expanded path

      // Restore original allowedPaths
      mockConduitConfig.allowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
      mockConduitConfig.resolvedAllowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
    });

    // Tests for the new forCreation option
    describe('forCreation option', () => {
      it('should validate parent directory for creation and return target path', async () => {
        // This test validates the scenario where the target file itself is NOT in allowed paths,
        // but the parent directory IS allowed after realpath resolution
        const userPath = '/unallowed/path/newfile.txt'; // Not directly in allowed paths
        // Don't add this path to allowed paths initially
        
        // Mock parent directory exists and resolves to an allowed path
        mockFs.realpath.mockImplementation(async (p: PathLike) => {
          const pStr = p.toString();
          if (pStr === '/unallowed/path') return '/allowed/path1'; // Parent resolves to allowed path
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); // File doesn't exist
        });

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(userPath));
        expect(mockFs.realpath).toHaveBeenCalledWith('/unallowed/path');
      });

      it('should throw ERR_FS_DIR_NOT_FOUND if parent directory does not exist', async () => {
        const userPath = '/nonexistent/parent/newfile.txt'; // Use a path not in allowed paths
        // Don't add to allowed paths so parent validation is triggered
        
        // Mock parent directory doesn't exist
        mockFs.realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

        await expect(validateAndResolvePath(userPath, { forCreation: true })).rejects.toThrow(
          new ConduitError(
            ErrorCode.ERR_FS_DIR_NOT_FOUND,
            `Parent directory not found for creation: ${userPath} (parent: /nonexistent/parent)`
          )
        );
      });

      it('should throw ERR_FS_PERMISSION_DENIED if parent directory is not allowed', async () => {
        const userPath = '/disallowed/newfile.txt';
        // Mock parent directory exists but is not allowed
        mockFs.realpath.mockResolvedValue('/disallowed');

        await expect(validateAndResolvePath(userPath, { forCreation: true })).rejects.toThrow(
          new ConduitError(
            ErrorCode.ERR_FS_PERMISSION_DENIED,
            `Parent directory access denied for creation: ${userPath}`
          )
        );
      });

      it('should handle tilde expansion in creation mode', async () => {
        // Update the config in the mock factory dynamically
        const userPath = '~/subdir/newfile.txt';

        // Mock parent directory exists and resolves correctly
        mockFs.realpath.mockImplementation(async (p: PathLike) => {
          const pStr = p.toString();
          if (pStr === '/allowed/path1/subdir') return '/allowed/path1/subdir';
          if (pStr === '/allowed/path1') return '/allowed/path1';
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        });

        // Mock tilde expansion to resolve to allowed area by mocking os.homedir
        mockOs.homedir.mockReturnValueOnce('/allowed/path1');

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve('/allowed/path1/subdir/newfile.txt'));
      });

      it('should skip checkAllowed when checkAllowed is false in creation mode', async () => {
        const userPath = '/disallowed/newfile.txt';
        // Mock parent directory exists
        mockFs.realpath.mockResolvedValue('/disallowed');

        const resolved = await validateAndResolvePath(userPath, {
          forCreation: true,
          checkAllowed: false,
        });
        expect(resolved).toBe(path.resolve(userPath));
      });

      it('should handle creation at root of allowed directory', async () => {
        const userPath = '/allowed/path1/newfile.txt';
        // Mock parent directory exists and is allowed
        mockFs.realpath.mockResolvedValue('/allowed/path1');

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(userPath));
      });

      // Archive extraction scenario - extracting to an allowed directory should work
      it('should allow creation when target path itself is in allowed paths (archive extraction scenario)', async () => {
        const userPath = '/allowed/path1'; // Extracting directly to an allowed directory
        // The target path itself is allowed, so it should succeed without checking parent

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(userPath));
        // Should not call realpath for parent directory since target itself is allowed
        expect(mockFs.realpath).not.toHaveBeenCalled();
      });

      it('should allow creation when target path with tilde is in allowed paths (Desktop extraction scenario)', async () => {
        const userPath = '~/Desktop';
        const homeDir = '/mock/home';
        const desktopPath = path.join(homeDir, 'Desktop');
        
        mockOs.homedir.mockReturnValue(homeDir);
        mockConduitConfig.allowedPaths = [desktopPath];
        mockConduitConfig.resolvedAllowedPaths = [desktopPath];

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(desktopPath));
        // Should not call realpath for parent directory since target itself is allowed
        expect(mockFs.realpath).not.toHaveBeenCalled();

        // Restore original allowedPaths
        mockConduitConfig.allowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
        mockConduitConfig.resolvedAllowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
      });

      it('should allow creation when target path with trailing slash is in allowed paths', async () => {
        const userPath = '/allowed/path1/'; // Directory with trailing slash
        
        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(userPath));
        // Should not call realpath for parent directory since target itself is allowed
        expect(mockFs.realpath).not.toHaveBeenCalled();
      });

      it('should handle root directory creation validation correctly', async () => {
        const userPath = '/';
        mockConduitConfig.allowedPaths = ['/'];
        mockConduitConfig.resolvedAllowedPaths = ['/'];

        const resolved = await validateAndResolvePath(userPath, { forCreation: true });
        expect(resolved).toBe(path.resolve(userPath));

        // Restore original allowedPaths
        mockConduitConfig.allowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
        mockConduitConfig.resolvedAllowedPaths = ['/allowed/path1', '/allowed/path2/sub'];
      });

      it('should deny root directory creation when not allowed', async () => {
        const userPath = '/';
        // Root is not in allowed paths by default

        await expect(validateAndResolvePath(userPath, { forCreation: true })).rejects.toThrow(
          new ConduitError(
            ErrorCode.ERR_FS_PERMISSION_DENIED,
            `Access to root directory is denied: ${userPath}`
          )
        );
      });
    });
  });
});
