import { handleWriteTool } from '@/tools/writeTool';
import { WriteTool } from '@/types/tools';
import * as securityHandler from '@/core/securityHandler';
import * as fsOps from '@/core/fileSystemOps';
import * as archiveOps from '@/operations/archiveOps';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';

// Mock core modules
vi.mock('@/core/securityHandler');
vi.mock('@/core/fileSystemOps');
vi.mock('@/operations/archiveOps');

const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedFsOps = fsOps as Mocked<typeof fsOps>;
const mockedArchiveOps = archiveOps as Mocked<typeof archiveOps>;

describe('WriteTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockedSecurityHandler.validatePathForCreation.mockImplementation((p) => p); // Return path as is
    mockedSecurityHandler.validateAndResolvePath.mockImplementation(async (p) => p);
    mockedFsOps.writeFile.mockResolvedValue(100); // Default bytes written
    mockedFsOps.createDirectory.mockResolvedValue(undefined);
    mockedFsOps.copyPath.mockResolvedValue(undefined);
    mockedFsOps.movePath.mockResolvedValue(undefined);
    mockedFsOps.deletePath.mockResolvedValue(undefined);
    mockedFsOps.touchFile.mockResolvedValue(undefined);
    mockedArchiveOps.createArchive.mockResolvedValue({ skipped_sources: undefined });
    mockedArchiveOps.extractArchive.mockResolvedValue({ extracted_files_count: 5 });
  });

  describe('Batch Actions (put, mkdir, copy, move, delete, touch)', () => {
    it('should handle put action successfully', async () => {
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [{ path: '/file.txt', content: 'Hello' }],
      };
      const result = await handleWriteTool(params) as WriteTool.WriteResultItem[];
      expect(result[0].status).toBe('success');
      expect(result[0].action_performed).toBe('put');
      expect(result[0].path).toBe('/file.txt');
      expect((result[0] as WriteTool.WriteResultSuccess).bytes_written).toBe(100);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith('/file.txt', 'Hello', 'text', 'overwrite');
    });

    it('should handle mkdir action successfully', async () => {
      const params: WriteTool.MkdirParams = {
        action: 'mkdir',
        entries: [{ path: '/newdir', recursive: true }],
      };
      const result = await handleWriteTool(params) as WriteTool.WriteResultItem[];
      expect(result[0].status).toBe('success');
      expect(mockedFsOps.createDirectory).toHaveBeenCalledWith('/newdir', true);
    });
    
    // Add similar tests for copy, move, delete, touch
    it('should handle copy action successfully', async () => {
        const params: WriteTool.CopyParams = {
            action: 'copy',
            entries: [{ source_path: '/src.txt', destination_path: '/dest.txt'}]
        };
        const result = await handleWriteTool(params) as WriteTool.WriteResultItem[];
        expect(result[0].status).toBe('success');
        expect(result[0].action_performed).toBe('copy');
        expect(mockedFsOps.copyPath).toHaveBeenCalledWith('/src.txt', '/dest.txt');
    });

    it('should report individual errors in batch operations', async () => {
      mockedFsOps.writeFile.mockResolvedValueOnce(10).mockRejectedValueOnce(new ConduitError(ErrorCode.ERR_FS_ACCESS_DENIED, 'Access denied'));
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [
          { path: '/file1.txt', content: 'OK' },
          { path: '/file2.txt', content: 'FAIL' },
        ],
      };
      const results = await handleWriteTool(params) as WriteTool.WriteResultItem[];
      expect(results.length).toBe(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('error');
      if (results[1].status === 'error') {
        expect(results[1].error_code).toBe(ErrorCode.ERR_FS_ACCESS_DENIED);
        expect(results[1].path).toBe('/file2.txt');
      }
    });

    it('should throw ERR_MISSING_ENTRIES_FOR_BATCH if entries is empty for batch action', async () => {
        const params = { action: 'put', entries: [] } as WriteTool.PutParams;
        await expect(handleWriteTool(params)).rejects.toThrow(
            new ConduitError(ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH, "'entries' array cannot be missing or empty for action 'put'.")
        );
    });
  });

  describe('Archive Actions', () => {
    it('should handle archive action successfully', async () => {
      const params: WriteTool.ArchiveParams = {
        action: 'archive',
        source_paths: ['/dir1', '/file.txt'],
        archive_path: '/myarchive.zip',
        format: 'zip',
      };
      const result = await handleWriteTool(params) as WriteTool.WriteResultSuccess;
      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('archive');
      expect(result.path).toBe('/myarchive.zip');
      expect(mockedArchiveOps.createArchive).toHaveBeenCalledWith(params);
    });

    it('should return error if createArchive fails', async () => {
        mockedArchiveOps.createArchive.mockRejectedValueOnce(new ConduitError(ErrorCode.ERR_ARCHIVE_CREATION_FAILED, 'Zip error'));
        const params: WriteTool.ArchiveParams = {
            action: 'archive',
            source_paths: ['/dir1'],
            archive_path: '/myarchive.zip'
        };
        const result = await handleWriteTool(params) as WriteTool.WriteResultItem;
        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_CREATION_FAILED);
        }
    });

    it('should handle unarchive action successfully', async () => {
      const params: WriteTool.UnarchiveParams = {
        action: 'unarchive',
        archive_path: '/myarchive.zip',
        destination_path: '/extract_here',
      };
      const result = await handleWriteTool(params) as WriteTool.WriteResultSuccess;
      expect(result.status).toBe('success');
      expect(result.action_performed).toBe('unarchive');
      expect((result as WriteTool.WriteResultSuccess).extracted_files_count).toBe(5);
      expect(mockedArchiveOps.extractArchive).toHaveBeenCalledWith(params);
    });
  });

  it('should throw error for invalid action', async () => {
    const params = { action: 'invalid_action' } as any;
    await expect(handleWriteTool(params)).rejects.toThrow(new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION));
  });
}); 