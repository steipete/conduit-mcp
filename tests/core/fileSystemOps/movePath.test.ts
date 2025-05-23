import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers';
import type { Stats } from 'fs';
import path from 'path';

// Mock fs/promises AT THE TOP of the test file
vi.mock('fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));

// Mock @/internal AT THE TOP of the test file
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
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
    formatToISO8601UTC: vi.fn((date: Date) => date.toISOString()),
  };
});

// Now proceed with other imports
import { describe, it, expect, beforeEach } from 'vitest';
import { movePath } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { logger } from '@/internal'; // For logger verification

describe('movePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks. Tests should override if specific behavior for access/stat is needed.
    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      // Default: path does not exist. Tests for existing paths will override.
      const error = new Error(`ENOENT: no such file or directory, access '${p.toString()}'`);
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      const error = new Error(`ENOENT: no such file or directory, stat '${p.toString()}'`);
      // @ts-expect-error code is readonly
      error.code = 'ENOENT';
      throw error;
    });
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
  });

  it('should move a file to a new file path (rename)', async () => {
    const sourcePath = 'source.txt';
    const destPath = 'dest_new.txt';
    const destParentPath = path.dirname(destPath);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath) return undefined;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destPath);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
  });

  it('should move a file to overwrite an existing file', async () => {
    const sourcePath = 'source_overwrite.txt';
    const destPath = 'dest_existing_file_to_overwrite.txt';
    const destParentPath = path.dirname(destPath);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destPath) return undefined; // Dest file exists
      if (p.toString() === destParentPath) return undefined;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destPath)
        return { isDirectory: () => false, isFile: () => true, size: 20 } as Stats; // Dest is file
      if (p.toString() === destParentPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destPath);
    expect(mockFs.unlink).toHaveBeenCalledWith(destPath);
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
  });

  it('should move a file into an existing directory', async () => {
    const sourcePath = 'file_to_move_into_dir.txt';
    const destDirPath = 'existing_dir_for_move';
    const finalDestPath = path.join(destDirPath, path.basename(sourcePath));

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destDirPath) return undefined; // Dest dir exists
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      } // Final path no exist
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destDirPath)
        return { isDirectory: () => true, isFile: () => false } as Stats; // Dest is dir
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destDirPath);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
  });

  it('should move a file into an existing directory, overwriting a file of the same name', async () => {
    const sourcePath = 'file_to_move_and_overwrite.txt';
    const destDirPath = 'existing_dir_with_conflict_move';
    const finalDestPath = path.join(destDirPath, path.basename(sourcePath));

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destDirPath) return undefined;
      if (p.toString() === finalDestPath) return undefined; // Final path exists (file)
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destDirPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      if (p.toString() === finalDestPath)
        return { isDirectory: () => false, isFile: () => true, size: 20 } as Stats; // Final path is file
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destDirPath);
    expect(mockFs.unlink).toHaveBeenCalledWith(finalDestPath);
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
  });

  it('should move a file, creating intermediate destination directories', async () => {
    const sourcePath = 'source_for_mkdir_move.txt';
    const destFilePath = 'new_parent_dir_move/sub_dir_move/dest_file.txt';
    const parentOfFinalDest = path.dirname(destFilePath);

    let parentDirCreated = false;
    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destFilePath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === parentOfFinalDest) {
        if (!parentDirCreated) {
          const e = new Error('ENOENT');
          (e as any).code = 'ENOENT';
          throw e;
        } else {
          return undefined;
        } // Exists after creation
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destFilePath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === parentOfFinalDest) {
        if (!parentDirCreated) {
          const e = new Error('ENOENT');
          (e as any).code = 'ENOENT';
          throw e;
        } else {
          return { isDirectory: () => true, isFile: () => false } as Stats;
        } // Is a dir after creation
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.mkdir.mockImplementation(async (p: import('fs').PathLike, options?: any) => {
      if (p.toString() === parentOfFinalDest && options?.recursive) {
        parentDirCreated = true;
        return undefined;
      }
      throw new Error('Unexpected mkdir call');
    });

    await movePath(sourcePath, destFilePath);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.mkdir).toHaveBeenCalledWith(parentOfFinalDest, { recursive: true });
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destFilePath);
  });

  it('should move a directory to a new path', async () => {
    const sourcePath = 'source_dir_to_move_actual';
    const destPath = 'new_dest_dir_path_actual';
    const destParentPath = path.dirname(destPath);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath) return undefined;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destPath);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath);
  });

  it('should throw ConduitError if source path does not exist for move (rename fails with ENOENT)', async () => {
    const sourcePath = 'non_existent_source_move.txt';
    const destPath = 'dest_for_non_existent_source.txt';

    // Simulate source not existing by having access & stat throw for it
    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) {
        const e = new Error('ENOENT source');
        (e as any).code = 'ENOENT';
        throw e;
      }
      // For dest and its parent, they might or might not exist, doesn't change outcome if source is gone
      return undefined;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) {
        const e = new Error('ENOENT source');
        (e as any).code = 'ENOENT';
        throw e;
      }
      return { isDirectory: () => false, isFile: () => true } as Stats; // Default for others
    });

    const renameError = new Error('ENOENT from rename');
    // @ts-expect-error code is readonly
    renameError.code = 'ENOENT';
    mockFs.rename.mockRejectedValue(renameError);

    await expect(movePath(sourcePath, destPath)).rejects.toThrow(ConduitError);
    try {
      await movePath(sourcePath, destPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND);
      expect(err.message).toContain(`Path not found: ${sourcePath}`);
    }
  });

  it('should throw ConduitError for other fs.rename errors', async () => {
    const sourcePath = 'source_rename_fail_other.txt';
    const destPath = 'dest_rename_fail_other.txt';
    const destParentPath = path.dirname(destPath);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath) return undefined;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    const renameError = new Error('FS rename permission denied');
    // @ts-expect-error code is readonly
    renameError.code = 'EACCES'; // Example of another error
    mockFs.rename.mockRejectedValue(renameError);

    await expect(movePath(sourcePath, destPath)).rejects.toThrow(ConduitError);
    try {
      await movePath(sourcePath, destPath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_MOVE_FAILED);
      expect(err.message).toContain(
        `Failed to move/rename: ${sourcePath} to ${destPath}. Error: FS rename permission denied`
      );
    }
  });

  it('should not attempt to delete destination if it is a directory (when moving a file)', async () => {
    const sourcePath = 'source_file_not_delete_dir.txt';
    const destDirPath = 'existing_target_dir_no_delete';
    const finalDestPath = path.join(destDirPath, path.basename(sourcePath));

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath) return undefined;
      if (p.toString() === destDirPath) return undefined; // Dest dir exists
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      } // Final path no exist
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourcePath)
        return { isDirectory: () => false, isFile: () => true, size: 10 } as Stats;
      if (p.toString() === destDirPath)
        return { isDirectory: () => true, isFile: () => false } as Stats; // Dest is dir
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourcePath, destDirPath);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, finalDestPath);
  });

  // Specific test for when target is a directory and source is also a directory - should rename source to target name
  it('should rename source directory to target directory name if target does not exist', async () => {
    const sourceDirPath = '/source/dir_to_rename';
    const destDirPathNonExistent = '/dest/new_dir_name'; // Target path does not exist
    const destParentPath = path.dirname(destDirPathNonExistent);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDirPath) return undefined;
      if (p.toString() === destDirPathNonExistent) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath) return undefined; // Parent exists
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDirPath)
        return { isDirectory: () => true, isFile: () => false } as Stats; // Source is dir
      if (p.toString() === destDirPathNonExistent) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      if (p.toString() === destParentPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourceDirPath, destDirPathNonExistent);
    expect(mockFs.unlink).not.toHaveBeenCalled(); // No file to delete
    expect(mockFs.rename).toHaveBeenCalledWith(sourceDirPath, destDirPathNonExistent);
  });

  it('should throw ERR_FS_MOVE_TARGET_IS_FILE_SOURCE_IS_DIR if target is file and source is dir', async () => {
    const sourceDirPath = '/source/dir_is_src';
    const destFilePath = '/dest/file_is_target.txt'; // Target is a file
    const destParentPath = path.dirname(destFilePath);

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDirPath) return undefined;
      if (p.toString() === destFilePath) return undefined; // Target file exists
      if (p.toString() === destParentPath) return undefined;
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      const pathStr = p.toString();
      if (pathStr === sourceDirPath) {
        return { isDirectory: () => true, isFile: () => false } as Stats;
      }
      if (pathStr === destFilePath) {
        return { isDirectory: () => false, isFile: () => true } as Stats;
      }
      const e = new Error(`ENOENT test-specific stat mock for ${pathStr}`);
      (e as any).code = 'ENOENT';
      throw e;
    });

    await expect(movePath(sourceDirPath, destFilePath)).rejects.toThrow(ConduitError);
    try {
      await movePath(sourceDirPath, destFilePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_MOVE_TARGET_IS_FILE_SOURCE_IS_DIR);
      expect(err.message).toContain(
        `Cannot move directory ${sourceDirPath} to path ${destFilePath} because target is a file.`
      );
      expect(mockFs.rename).not.toHaveBeenCalled();
      expect(mockFs.unlink).not.toHaveBeenCalled(); // Should not attempt to delete the target file in this case
    }
  });

  it('should move source directory into target directory if target is an existing directory', async () => {
    const sourceDirPath = '/source/another_dir_to_move';
    const destDirPathExisting = '/dest/existing_target_directory';
    const finalDestPath = path.join(destDirPathExisting, path.basename(sourceDirPath));

    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDirPath) return undefined;
      if (p.toString() === destDirPathExisting) return undefined; // Target dir exists
      // The path where source dir would land *inside* target dir should not exist before move
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === sourceDirPath)
        return { isDirectory: () => true, isFile: () => false } as Stats;
      if (p.toString() === destDirPathExisting)
        return { isDirectory: () => true, isFile: () => false } as Stats; // Target is dir
      if (p.toString() === finalDestPath) {
        const e = new Error('ENOENT');
        (e as any).code = 'ENOENT';
        throw e;
      }
      const e = new Error('ENOENT default');
      (e as any).code = 'ENOENT';
      throw e;
    });

    await movePath(sourceDirPath, destDirPathExisting);
    expect(mockFs.unlink).not.toHaveBeenCalled();
    expect(mockFs.rename).toHaveBeenCalledWith(sourceDirPath, finalDestPath);
  });
});
