import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import {
  handleBatchPut,
  handleBatchMkdir,
  handleBatchCopy,
  handleBatchMove,
  handleBatchDelete,
  handleBatchTouch,
} from '@/operations/batchWriteOps';
import {
  WriteTool,
  ConduitServerConfig,
  validateAndResolvePath,
  putContent,
  makeDirectory,
  fileSystemOps,
} from '@/internal';

// Mock dependencies
vi.mock('@/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/internal')>();
  const mockLogger = mockDeep<import('pino').Logger>();
  mockLogger.child.mockReturnValue(mockLogger as unknown as import('pino').Logger);

  return {
    ...actual,
    validateAndResolvePath: vi.fn(),
    putContent: vi.fn(),
    makeDirectory: vi.fn(),
    fileSystemOps: mockDeep<typeof fileSystemOps>(),
    logger: mockLogger,
  };
});

const mockedValidateAndResolvePath = vi.mocked(validateAndResolvePath);
const mockedPutContent = vi.mocked(putContent);
const mockedMakeDirectory = vi.mocked(makeDirectory);
const mockedFileSystemOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;

describe('batchWriteOps', () => {
  let mockConfig: ConduitServerConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      workspaceRoot: '/workspace',
      allowedPaths: ['/workspace'],
      resolvedAllowedPaths: ['/workspace'],
    } as ConduitServerConfig;
  });

  describe('handleBatchPut', () => {
    it('should handle successful put operations', async () => {
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [
          {
            path: '/workspace/file1.txt',
            content: 'Hello World',
            input_encoding: 'text',
          },
          {
            path: '/workspace/file2.txt',
            content: 'Hello Again',
            input_encoding: 'text',
          },
        ],
      };

      mockedValidateAndResolvePath
        .mockResolvedValueOnce('/workspace/file1.txt')
        .mockResolvedValueOnce('/workspace/file2.txt');

      mockedPutContent
        .mockResolvedValueOnce({
          status: 'success',
          action_performed: 'put',
          path: '/workspace/file1.txt',
          bytes_written: 11,
        } as WriteTool.WriteResultSuccess)
        .mockResolvedValueOnce({
          status: 'success',
          action_performed: 'put',
          path: '/workspace/file2.txt',
          bytes_written: 11,
        } as WriteTool.WriteResultSuccess);

      const result = await handleBatchPut(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('success');
      expect(result.results[1].status).toBe('success');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledTimes(2);
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(1, '/workspace/file1.txt', {
        forCreation: true,
        checkAllowed: true,
      });
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(2, '/workspace/file2.txt', {
        forCreation: true,
        checkAllowed: true,
      });
    });

    it('should handle path validation errors', async () => {
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [
          {
            path: '/invalid/path.txt',
            content: 'Hello World',
            input_encoding: 'text',
          },
        ],
      };

      mockedValidateAndResolvePath.mockRejectedValueOnce(new Error('Path validation failed'));

      const result = await handleBatchPut(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[0].error_message).toBe('Path validation failed');
    });

    it('should handle empty entries array', async () => {
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [],
      };

      const result = await handleBatchPut(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[0].error_message).toBe(
        "'entries' array is missing or empty for put operation."
      );
    });
  });

  describe('handleBatchMkdir', () => {
    it('should handle successful mkdir operations', async () => {
      const params: WriteTool.MkdirParams = {
        action: 'mkdir',
        entries: [{ path: '/workspace/dir1' }, { path: '/workspace/dir2', recursive: true }],
      };

      mockedValidateAndResolvePath
        .mockResolvedValueOnce('/workspace/dir1')
        .mockResolvedValueOnce('/workspace/dir2');

      mockedMakeDirectory
        .mockResolvedValueOnce({
          status: 'success',
          action_performed: 'mkdir',
          path: '/workspace/dir1',
          message: 'Directory created.',
        } as WriteTool.WriteResultSuccess)
        .mockResolvedValueOnce({
          status: 'success',
          action_performed: 'mkdir',
          path: '/workspace/dir2',
          message: 'Directory and any necessary parent directories created.',
        } as WriteTool.WriteResultSuccess);

      const result = await handleBatchMkdir(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('success');
      expect(result.results[1].status).toBe('success');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledTimes(2);
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(1, '/workspace/dir1', {
        forCreation: true,
        checkAllowed: true,
      });
    });
  });

  describe('handleBatchCopy', () => {
    it('should handle successful copy operations', async () => {
      const params: WriteTool.CopyParams = {
        action: 'copy',
        entries: [
          {
            source_path: '/workspace/source.txt',
            destination_path: '/workspace/dest.txt',
          },
        ],
      };

      mockedValidateAndResolvePath
        .mockResolvedValueOnce('/workspace/source.txt')
        .mockResolvedValueOnce('/workspace/dest.txt');

      mockedFileSystemOps.copyPath.mockResolvedValueOnce(undefined);

      const result = await handleBatchCopy(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('success');
      expect(result.results[0].action_performed).toBe('copy');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledTimes(2);
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(1, '/workspace/source.txt', {
        isExistenceRequired: true,
        checkAllowed: true,
      });
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(2, '/workspace/dest.txt', {
        forCreation: true,
        checkAllowed: true,
      });
    });
  });

  describe('handleBatchMove', () => {
    it('should handle successful move operations', async () => {
      const params: WriteTool.MoveParams = {
        action: 'move',
        entries: [
          {
            source_path: '/workspace/source.txt',
            destination_path: '/workspace/moved.txt',
          },
        ],
      };

      mockedValidateAndResolvePath
        .mockResolvedValueOnce('/workspace/source.txt')
        .mockResolvedValueOnce('/workspace/moved.txt');

      mockedFileSystemOps.movePath.mockResolvedValueOnce(undefined);

      const result = await handleBatchMove(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('success');
      expect(result.results[0].action_performed).toBe('move');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledTimes(2);
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(1, '/workspace/source.txt', {
        isExistenceRequired: true,
        checkAllowed: true,
      });
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(2, '/workspace/moved.txt', {
        forCreation: true,
        checkAllowed: true,
      });
    });
  });

  describe('handleBatchDelete', () => {
    it('should handle successful delete operations', async () => {
      const params: WriteTool.DeleteParams = {
        action: 'delete',
        entries: [{ path: '/workspace/file.txt' }, { path: '/workspace/dir', recursive: true }],
      };

      mockedValidateAndResolvePath
        .mockResolvedValueOnce('/workspace/file.txt')
        .mockResolvedValueOnce('/workspace/dir');

      mockedFileSystemOps.deletePath
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await handleBatchDelete(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('success');
      expect(result.results[1].status).toBe('success');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledTimes(2);
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(1, '/workspace/file.txt', {
        isExistenceRequired: true,
        checkAllowed: true,
      });
      expect(mockedValidateAndResolvePath).toHaveBeenNthCalledWith(2, '/workspace/dir', {
        isExistenceRequired: true,
        checkAllowed: true,
      });
    });
  });

  describe('handleBatchTouch', () => {
    it('should handle successful touch operations', async () => {
      const params: WriteTool.TouchParams = {
        action: 'touch',
        entries: [{ path: '/workspace/newfile.txt' }],
      };

      mockedValidateAndResolvePath.mockResolvedValueOnce('/workspace/newfile.txt');
      mockedFileSystemOps.touchFile.mockResolvedValueOnce(undefined);

      const result = await handleBatchTouch(params, mockConfig);

      expect(result.tool_name).toBe('write');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('success');
      expect(result.results[0].action_performed).toBe('touch');

      expect(mockedValidateAndResolvePath).toHaveBeenCalledWith('/workspace/newfile.txt', {
        forCreation: true,
        checkAllowed: true,
      });
    });
  });
});
