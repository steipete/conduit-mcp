import { vi } from 'vitest';
import { mockFs, mockConduitConfig } from './helpers';
import type { Stats } from 'fs';
import { constants as fsConstants } from 'fs'; // Added fsConstants import

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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { touchFile } from '@/core/fileSystemOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { logger } from '@/internal'; // For logger verification

describe('touchFile', () => {
  const filePath = '/path/to/some/file.txt';
  const parentDir = '/path/to/some';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset specific mocks that touchFile interacts with
    mockFs.access.mockReset();
    mockFs.stat.mockReset();
    mockFs.writeFile.mockReset().mockResolvedValue(undefined); // Default success for writeFile
    mockFs.utimes.mockReset().mockResolvedValue(undefined);   // Default success for utimes
    mockFs.mkdir.mockReset().mockResolvedValue(undefined); // Default success for mkdir (used by createDirectory)

    // Default behavior for pathExists (via fs.access) - usually overridden per test
    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
      const e = new Error('ENOENT default access'); (e as any).code='ENOENT'; throw e;
    });
    // Default behavior for getStats (via fs.stat) - usually overridden per test
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
       const e = new Error('ENOENT default stat'); (e as any).code='ENOENT'; throw e;
    });
  });

  it('should create an empty file if it does not exist', async () => {
    // Mock pathExists to return false initially for the file
    mockFs.access.mockImplementation(async (p: import('fs').PathLike, mode?: number) => {
      if (p.toString() === filePath && mode === fsConstants.F_OK) {
        const e = new Error('ENOENT file access'); (e as any).code = 'ENOENT'; throw e;
      }
      if (p.toString() === parentDir && mode === fsConstants.F_OK) { // Parent directory exists
        return undefined;
      }
      // Default for other access calls if any (shouldn't be for this test path)
      const e = new Error('ENOENT unexpected access'); (e as any).code = 'ENOENT'; throw e;
    });
    
    // Mock stat for parent directory check (createDirectory might call this via getStats)
    // Since createDirectory itself checks pathExists first, this stat mock might only be for its internal getStats if path is a file.
    // For simplicity, ensure parentDir is seen as a directory if createDirectory -> getStats is called for it.
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => {
      if (p.toString() === parentDir) {
        return { isDirectory: () => true, isFile: () => false } as Stats;
      }
      const e = new Error('ENOENT stat in create empty file'); (e as any).code = 'ENOENT'; throw e;
    });


    await touchFile(filePath);

    expect(mockFs.access).toHaveBeenCalledWith(filePath, fsConstants.F_OK); // pathExists check
    // createDirectory(parentDir, true) will be called.
    // It first calls pathExists(parentDir). Our mockFs.access for parentDir returns undefined (exists).
    // Then createDirectory's getStats(parentDir) is called. Our mockFs.stat for parentDir returns isDirectory: true.
    // So, fs.mkdir within createDirectory should NOT be called if parentDir exists and is a directory.
    // However, if pathExists for parentDir initially says "doesn't exist", then mkdir would be called.
    // Let's assume parentDir exists for this test to focus on writeFile.
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, Buffer.from(''));
    expect(mockFs.utimes).not.toHaveBeenCalled();
  });

  it('should update timestamps if the file exists', async () => {
    mockFs.access.mockResolvedValue(undefined); // pathExists returns true
    mockFs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats); // getStats for the file
    
    const beforeCall = new Date();
    // vi.useFakeTimers(); // Using fake timers can be tricky with async operations if not careful
    // vi.setSystemTime(beforeCall);


    await touchFile(filePath);
    const afterCall = new Date();
    // vi.useRealTimers();


    expect(mockFs.access).toHaveBeenCalledWith(filePath, fsConstants.F_OK);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    expect(mockFs.utimes).toHaveBeenCalledTimes(1);

    const utimesArgs = mockFs.utimes.mock.calls[0];
    expect(utimesArgs[0]).toBe(filePath);
    expect(utimesArgs[1]).toBeInstanceOf(Date);
    expect(utimesArgs[2]).toBeInstanceOf(Date);
    // Looser check for time due to potential slight delays in async execution
    expect((utimesArgs[1] as Date).getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 100); // Allow small diff
    expect((utimesArgs[1] as Date).getTime()).toBeLessThanOrEqual(afterCall.getTime() + 100);
    expect((utimesArgs[2] as Date).getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 100);
    expect((utimesArgs[2] as Date).getTime()).toBeLessThanOrEqual(afterCall.getTime() + 100);
  });

  it('should throw ERR_FS_TOUCH_FAILED if writeFile fails during creation', async () => {
    mockFs.access.mockImplementation(async (p: import('fs').PathLike, mode?: number) => {
      if (p.toString() === filePath && mode === fsConstants.F_OK) {
        const e = new Error('ENOENT for writeFile fail test'); (e as any).code = 'ENOENT'; throw e;
      }
      if (p.toString() === parentDir && mode === fsConstants.F_OK) {
         return undefined; // Parent dir exists
      }
      const e = new Error('ENOENT default access in writeFile fail test'); (e as any).code = 'ENOENT'; throw e;
    });
     mockFs.stat.mockImplementation(async (p: import('fs').PathLike) => { // For createDirectory's getStats
      if (p.toString() === parentDir) return { isDirectory: () => true, isFile: () => false } as Stats;
      const e = new Error('ENOENT default stat in writeFile fail test'); (e as any).code = 'ENOENT'; throw e;
    });

    const writeError = new Error('Disk quota exceeded for touch');
    mockFs.writeFile.mockRejectedValue(writeError);

    await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
    try {
      await touchFile(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_TOUCH_FAILED);
      expect(err.message).toContain(`Failed to touch path: ${filePath}. Error: ${writeError.message}`);
    }
  });

  it('should throw ERR_FS_TOUCH_FAILED if utimes fails', async () => {
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats); // It's a file

    const utimesError = new Error('Operation not permitted for utimes');
    mockFs.utimes.mockRejectedValue(utimesError);

    await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
    try {
      await touchFile(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_TOUCH_FAILED);
      expect(err.message).toContain(`Failed to touch path: ${filePath}. Error: ${utimesError.message}`);
    }
  });

  it('should throw ERR_FS_PATH_IS_DIR if the path is a directory', async () => {
    mockFs.access.mockResolvedValue(undefined); // Path exists
    mockFs.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats); // It's a directory

    await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
    try {
      await touchFile(filePath);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_PATH_IS_DIR);
      expect(err.message).toBe(`Path ${filePath} is a directory, cannot touch.`);
    }
  });
  
  it('should correctly handle createDirectory failure when creating a new file', async () => {
    // Simulate file not existing
    mockFs.access.mockImplementation(async (p: import('fs').PathLike) => {
        if (p.toString() === filePath) { const e = new Error('ENOENT file'); (e as any).code = 'ENOENT'; throw e; }
        // Simulate parentDir NOT existing to trigger createDirectory, which will then fail
        if (p.toString() === parentDir) { const e = new Error('ENOENT parent'); (e as any).code = 'ENOENT'; throw e; }
        const e = new Error('ENOENT default'); (e as any).code = 'ENOENT'; throw e;
    });

    // Mock fs.mkdir (called by SUT's createDirectory) to throw an error
    const mkdirError = new Error('Permission denied for mkdir');
    (mkdirError as any).code = 'EACCES'; // Simulate a permission error from fs.mkdir
    mockFs.mkdir.mockRejectedValue(mkdirError);
    
    // pathExists(parentDir) fails -> createDirectory(parentDir, true) is called.
    // createDirectory -> fs.mkdir(parentDir, {recursive:true}) -> throws mkdirError.
    // This error should be caught by touchFile and wrapped.

    await expect(touchFile(filePath)).rejects.toThrow(ConduitError);
    try {
        await touchFile(filePath);
    } catch (e) {
        const err = e as ConduitError;
        expect(err.errorCode).toBe(ErrorCode.ERR_FS_TOUCH_FAILED);
        // The error message in touchFile comes from createDirectory's error wrapping
        // createDirectory wraps fs.mkdir error like: `Failed to create directory: ${dirPath}. Error: ${nodeError.message}`
        // touchFile then wraps that: `Failed to touch path: ${filePath}. Error: ${underlyingError}`
        expect(err.message).toContain(`Failed to touch path: ${filePath}. Error: Failed to create directory: ${parentDir}. Error: ${mkdirError.message}`);
    }
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    expect(mockFs.utimes).not.toHaveBeenCalled();
  });
}); 