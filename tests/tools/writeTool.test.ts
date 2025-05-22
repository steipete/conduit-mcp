import { writeToolHandler } from '@/tools/writeTool';
import { WriteTool, MCPErrorStatus, ArchiveTool } from '@/types/tools';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked, MockedFunction } from 'vitest';

// Mock internal module
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  return {
    ...original,
    conduitConfig: {
      server_name: 'test-server',
      server_version: '1.0.0',
      allowed_paths: ['/'],
      max_file_size_mb: 100,
      max_request_size_mb: 50,
      require_path_in_allowed_list: false,
      enable_security_restrictions: false,
      enable_notice_generation: false,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    fileSystemOps: {
      writeFile: vi.fn(),
      createDirectory: vi.fn(),
      copyPath: vi.fn(),
      movePath: vi.fn(),
      deletePath: vi.fn(),
      touchFile: vi.fn(),
    },
    securityHandler: {
      validateAndResolvePath: vi.fn(),
      isPathAllowed: vi.fn(),
    },
    createArchive: vi.fn(),
    extractArchive: vi.fn(),
  };
});

// Mock separate operations
vi.mock('@/operations/archiveOps', () => ({
  createArchive: vi.fn(),
  extractArchive: vi.fn(),
}));

// Import mocked modules
import { conduitConfig, fileSystemOps, securityHandler, ConduitServerConfig } from '@/internal';
import { createArchive, extractArchive } from '@/operations/archiveOps';

const mockedConduitConfig = conduitConfig as Mocked<ConduitServerConfig>;
// Removed unused mockedLogger variable
const mockedFsOps = fileSystemOps as Mocked<typeof fileSystemOps>;
const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedCreateArchive = createArchive as MockedFunction<typeof createArchive>;
const mockedExtractArchive = extractArchive as MockedFunction<typeof extractArchive>;

describe('WriteTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockedSecurityHandler.validateAndResolvePath.mockImplementation(async (p) => p);
    mockedFsOps.writeFile.mockResolvedValue(100); // Default bytes written
    mockedFsOps.createDirectory.mockResolvedValue(undefined);
    mockedFsOps.copyPath.mockResolvedValue(undefined);
    mockedFsOps.movePath.mockResolvedValue(undefined);
    mockedFsOps.deletePath.mockResolvedValue(undefined);
    mockedFsOps.touchFile.mockResolvedValue(undefined);
    mockedCreateArchive.mockResolvedValue({
      status: 'success',
      operation: 'create',
      archive_path: '/myarchive.zip',
      format_used: 'zip',
      size_bytes: 12345,
      entries_processed: 2,
      checksum_sha256: 'mock-checksum',
      compression_used: 'zip',
      metadata: undefined,
      options_applied: undefined,
      message: 'Archive created successfully at /myarchive.zip.',
    });
    mockedExtractArchive.mockResolvedValue({
      status: 'success',
      operation: 'extract',
      archive_path: '/myarchive.zip',
      target_path: '/extract_here',
      format_used: 'zip',
      entries_extracted: -1,
      options_applied: undefined,
      message: 'Archive extracted successfully to /extract_here.',
    });
  });

  describe('Batch Actions (put, mkdir, copy, move, delete, touch)', () => {
    it('should handle put action successfully', async () => {
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [{ path: '/file.txt', content: 'Hello' }],
      };
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedBatchResponse;
      const result = response.results;
      expect(response.tool_name).toBe('write');
      expect(result[0].status).toBe('success');
      expect(result[0].action_performed).toBe('put');
      expect(result[0].path).toBe('/file.txt');
      expect((result[0] as WriteTool.WriteResultSuccess).bytes_written).toBe(100);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(
        '/file.txt',
        'Hello',
        undefined,
        'overwrite'
      );
    });

    it('should handle mkdir action successfully', async () => {
      const params: WriteTool.MkdirParams = {
        action: 'mkdir',
        entries: [{ path: '/newdir', recursive: true }],
      };
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedBatchResponse;
      const result = response.results;
      expect(response.tool_name).toBe('write');
      expect(result[0].status).toBe('success');
      expect(mockedFsOps.createDirectory).toHaveBeenCalledWith('/newdir', true);
    });

    // Add similar tests for copy, move, delete, touch
    it('should handle copy action successfully', async () => {
      const params: WriteTool.CopyParams = {
        action: 'copy',
        entries: [{ source_path: '/src.txt', destination_path: '/dest.txt' }],
      };
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedBatchResponse;
      const result = response.results;
      expect(response.tool_name).toBe('write');
      expect(result[0].status).toBe('success');
      expect(result[0].action_performed).toBe('copy');
      expect(mockedFsOps.copyPath).toHaveBeenCalledWith('/src.txt', '/dest.txt');
    });

    it('should report individual errors in batch operations', async () => {
      mockedFsOps.writeFile
        .mockResolvedValueOnce(10)
        .mockRejectedValueOnce(
          new ConduitError(ErrorCode.ERR_FS_PERMISSION_DENIED, 'Access denied')
        );
      const params: WriteTool.PutParams = {
        action: 'put',
        entries: [
          { path: '/file1.txt', content: 'OK' },
          { path: '/file2.txt', content: 'FAIL' },
        ],
      };
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedBatchResponse;
      const results = response.results;
      expect(results.length).toBe(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('error');
      if (results[1].status === 'error') {
        expect(results[1].error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED);
        expect(results[1].path).toBe('/file2.txt');
      }
    });

    it('should throw ERR_MISSING_ENTRIES_FOR_BATCH if entries is empty for batch action', async () => {
      const params = { action: 'put', entries: [] } as WriteTool.PutParams;
      const response = (await writeToolHandler(params, mockedConduitConfig)) as MCPErrorStatus;
      expect(response.status).toBe('error');
      expect(response.error_code).toBe(ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH);
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
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedArchiveResponse;
      const archiveResultItem = response.results[0] as ArchiveTool.CreateArchiveSuccess;
      expect(archiveResultItem.status).toBe('success');
      expect(archiveResultItem.operation).toBe('create');
      expect(archiveResultItem.archive_path).toBe(params.archive_path);
      expect(mockedCreateArchive).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          source_paths: params.source_paths,
          archive_path: params.archive_path,
          compression: undefined,
          options: undefined,
          metadata: undefined,
        }),
        mockedConduitConfig
      );
    });

    it('should return error if createArchive fails', async () => {
      mockedCreateArchive.mockResolvedValueOnce({
        status: 'error',
        error_code: ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
        error_message: 'Zip error',
        operation: 'create',
      } as ArchiveTool.ArchiveResultError);
      const params: WriteTool.ArchiveParams = {
        action: 'archive',
        source_paths: ['/dir1'],
        archive_path: '/myarchive.zip',
      };
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedArchiveResponse;
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
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
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedArchiveResponse;
      const unarchiveResultItem = response.results[0] as ArchiveTool.ExtractArchiveSuccess;
      expect(unarchiveResultItem.status).toBe('success');
      expect(unarchiveResultItem.operation).toBe('extract');
      expect(unarchiveResultItem.entries_extracted).toBe(-1);
      expect(mockedExtractArchive).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'extract',
          archive_path: params.archive_path,
          target_path: params.destination_path,
          options: undefined,
        }),
        mockedConduitConfig
      );
    });
  });

  it('should throw error for invalid action', async () => {
    const params = { action: 'invalid_action' } as unknown;
    const response = (await writeToolHandler(params, mockedConduitConfig)) as MCPErrorStatus;
    expect(response.status).toBe('error');
    expect(response.error_code).toBe(ErrorCode.UNSUPPORTED_OPERATION);
  });
});
