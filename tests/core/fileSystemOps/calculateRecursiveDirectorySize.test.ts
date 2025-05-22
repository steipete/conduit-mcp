import { vi } from 'vitest';
import { mockFs, mockConduitConfig, createDirent } from './helpers'; // Added createDirent
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
    // getMimeType and formatToISO8601UTC are not directly used by calculateRecursiveDirectorySize SUT
    // but good to keep the pattern consistent if other utils from @/internal are needed.
    getMimeType: vi.fn().mockResolvedValue('application/octet-stream'),
    formatToISO8601UTC: vi.fn((date: Date) => date.toISOString()),
  };
});

// Now proceed with other imports
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateRecursiveDirectorySize } from '@/core/fileSystemOps';
import { logger } from '@/internal'; // For logger verification
// ConduitError and ErrorCode are not directly asserted in these tests, but might be useful for future extensions
// import { ConduitError, ErrorCode } from '@/utils/errorHandler';


describe('calculateRecursiveDirectorySize', () => {
  const baseDir = '/base';
  let startTime: number;
  // Use conduitConfig from the mock, which is imported and set up in the vi.mock('@/internal', ...)
  const maxDepth = mockConduitConfig.maxRecursiveDepth;
  const timeoutMs = mockConduitConfig.recursiveSizeTimeoutMs;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks, including logger
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
      // Default stat for other paths if any (e.g. the baseDir itself if SUT tried to stat it)
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

    const testMaxDepth = 2; // Using a specific maxDepth for this test

    mockFs.readdir.mockImplementation(async (p: import('fs').PathLike): Promise<any> => {
      const pathStr = p.toString();
      if (pathStr === baseDir)
        return [createDirent('file1.txt', true, false), createDirent('sub1', false, true)];
      if (pathStr === path.join(baseDir, 'sub1'))
        return [createDirent('file2.txt', true, false), createDirent('sub2', false, true)];
      if (pathStr === path.join(baseDir, 'sub1', 'sub2'))
        return [createDirent('file3.txt', true, false), createDirent('sub3', false, true)];
      if (pathStr === path.join(baseDir, 'sub1', 'sub2', 'sub3'))
        return [createDirent('file4.txt', true, false)]; // Beyond maxDepth for sub2 call
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
      testMaxDepth, // Using testMaxDepth here
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
      maxDepth + 1, // currentDepth > maxDepth
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
        // This file will be processed.
        return { size: 100, isFile: () => true, isDirectory: () => false } as Stats;
      }
      if (pathStr === path.join(baseDir, 'file2_timeout.txt')) {
        // Before processing this file (i.e. before its stat), advance timer to trigger timeout
        vi.advanceTimersByTime(timeoutMs + 1);
        return { size: 200, isFile: () => true, isDirectory: () => false } as Stats; // This size won't be added
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
    // Only file1.txt (100) and file2_timeout.txt (200) should be counted.
    // Timeout occurs *after* file2_timeout.txt is processed in the loop, before file3.txt.
    expect(result.size).toBe(300); // Adjusted expected size
    expect(result.note).toBe('Calculation timed out due to server limit');
    expect(mockFs.stat).toHaveBeenCalledTimes(2); // file1.txt and file2_timeout.txt (stat called, then timeout)
  });

  it('should handle timeout during subdirectory recursion and propagate note', async () => {
    mockFs.readdir.mockImplementation(async (p: import('fs').PathLike): Promise<any> => {
      const pathStr = p.toString();
      if (pathStr === baseDir) return [createDirent('sub_causes_timeout', false, true)];
      if (pathStr === path.join(baseDir, 'sub_causes_timeout')) {
        // When readdir for 'sub_causes_timeout' is called, advance timer
        vi.advanceTimersByTime(timeoutMs + 1);
        return [createDirent('inner_file.txt', true, false)]; // This list is returned
      }
      // inner_file.txt is never processed because the timeout check for its parent loop happens first
      throw new Error(`Unexpected readdir call: ${pathStr}`);
    });
    mockFs.stat.mockImplementation(async (p: import('fs').PathLike): Promise<Stats> => {
      // This mock won't be hit for inner_file.txt because the timeout hits before its loop iteration
      const pathStr = p.toString();
      if (pathStr === path.join(baseDir, 'sub_causes_timeout', 'inner_file.txt')) {
        return { size: 50, isFile: () => true, isDirectory: () => false } as Stats;
      }
      return { isFile: () => false, isDirectory: () => true, size: 0 } as Stats;
    });

    const result = await calculateRecursiveDirectorySize(
      baseDir,
      0,
      maxDepth,
      timeoutMs,
      startTime
    );
    expect(result.size).toBe(0); // Size from sub_causes_timeout not added as it timed out
    expect(result.note).toBe('Calculation timed out due to server limit');
    expect(mockFs.readdir).toHaveBeenCalledWith(path.join(baseDir, 'sub_causes_timeout'), { withFileTypes: true });
    expect(mockFs.stat).not.toHaveBeenCalled(); // No files within sub_causes_timeout are stat'd
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
      expect.stringContaining(`Error reading directory ${baseDir} for recursive size calculation: Error: Read dir permission denied`)
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
      expect.stringContaining(`Could not stat file ${path.join(baseDir, 'file_stat_error.txt')} during recursive size calculation: Error: Stat failed for this file`)
    );
    expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_ok.txt'));
    expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_stat_error.txt'));
    expect(mockFs.stat).toHaveBeenCalledWith(path.join(baseDir, 'file_after_error.txt'));
  });
}); 