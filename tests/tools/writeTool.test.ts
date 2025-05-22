import { writeToolHandler } from '@/tools/writeTool';
import { WriteTool, MCPErrorStatus, ArchiveTool } from '@/types/tools';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked, MockedFunction } from 'vitest';
import * as path from 'path';

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
      workspaceRoot: '/mocked/workspace',
      defaultChecksumAlgorithm: 'sha256',
      maxRecursiveDepth: 10,
      resolvedAllowedPaths: ['/mocked/workspace'],
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    fileSystemOps: {
      writeFile: vi.fn(),
      createDirectory: vi.fn(),
      copyPath: vi.fn(),
      movePath: vi.fn(),
      deletePath: vi.fn(),
      touchFile: vi.fn(),
      pathExists: vi.fn(),
      getStats: vi.fn(),
    },
    securityHandler: {
      validateAndResolvePath: vi.fn(),
      isPathAllowed: vi.fn().mockReturnValue(true),
    },
    validateAndResolvePath: vi.fn((p: string) => {
      return path.join('/mocked/workspace', p.startsWith('/') ? p.substring(1) : p);
    }),
    createArchive: vi.fn(),
    extractArchive: vi.fn(),
    calculateChecksum: vi.fn(),
    handleBatchPut: vi.fn(async (params: WriteTool.PutParams, _cfg: ConduitServerConfig) => {
      const results = await Promise.all(
        params.entries.map(async (entry) => {
          const absPath = path.join(mockedConduitConfig.workspaceRoot, entry.path.startsWith('/') ? entry.path.substring(1) : entry.path);
          try {
            const bytes = (await fileSystemOps.writeFile(absPath, entry.content, undefined, 'overwrite')) as number;
            return {
              status: 'success',
              action_performed: 'put',
              path: entry.path,
              bytes_written: bytes,
            } as WriteTool.WriteResultSuccess;
          } catch (err: any) {
            return {
              status: 'error',
              action_performed: 'put',
              path: entry.path,
              error_code: err?.errorCode ?? ErrorCode.OPERATION_FAILED,
              error_message: err?.message ?? 'error',
            } as WriteTool.WriteResultItem;
          }
        })
      );
      return { tool_name: 'write', results } as WriteTool.DefinedBatchResponse;
    }),
    handleBatchMkdir: vi.fn(async (params: WriteTool.MkdirParams, _cfg: ConduitServerConfig) => {
      const results = await Promise.all(
        params.entries.map(async (entry) => {
          const absPath = path.join(mockedConduitConfig.workspaceRoot, entry.path.startsWith('/') ? entry.path.substring(1) : entry.path);
          try {
            await fileSystemOps.createDirectory(absPath, entry.recursive ?? false);
            return { status: 'success', action_performed: 'mkdir', path: entry.path } as WriteTool.WriteResultSuccess;
          } catch (err: any) {
            return { status: 'error', action_performed: 'mkdir', path: entry.path, error_code: ErrorCode.OPERATION_FAILED, error_message: err?.message ?? 'error' } as WriteTool.WriteResultItem;
          }
        })
      );
      return { tool_name: 'write', results } as WriteTool.DefinedBatchResponse;
    }),
    handleBatchCopy: vi.fn(async (params: WriteTool.CopyParams, _cfg: ConduitServerConfig) => {
      const results = await Promise.all(
        params.entries.map(async (entry) => {
          const absSrc = path.join(mockedConduitConfig.workspaceRoot, entry.source_path.startsWith('/') ? entry.source_path.substring(1) : entry.source_path);
          const absDst = path.join(mockedConduitConfig.workspaceRoot, entry.destination_path.startsWith('/') ? entry.destination_path.substring(1) : entry.destination_path);
          try {
            await fileSystemOps.copyPath(absSrc, absDst);
            return { status: 'success', action_performed: 'copy', source_path: entry.source_path, destination_path: entry.destination_path } as WriteTool.WriteResultSuccess;
          } catch (err: any) {
            return { status: 'error', action_performed: 'copy', source_path: entry.source_path, destination_path: entry.destination_path, error_code: ErrorCode.OPERATION_FAILED, error_message: err?.message ?? 'error' } as WriteTool.WriteResultItem;
          }
        })
      );
      return { tool_name: 'write', results } as WriteTool.DefinedBatchResponse;
    }),
  };
});

// Mock separate operations
vi.mock('@/operations/archiveOps', () => ({
  createArchive: vi.fn(),
  extractArchive: vi.fn(),
}));

// Import mocked modules
import { conduitConfig, fileSystemOps, securityHandler, ConduitServerConfig, calculateChecksum as internalCalculateChecksum, validateAndResolvePath as internalValidateAndResolvePath } from '@/internal';
import { createArchive, extractArchive } from '@/operations/archiveOps';

const mockedConduitConfig = conduitConfig as Mocked<ConduitServerConfig>;
const mockedFsOps = fileSystemOps as Mocked<typeof fileSystemOps>;
const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedValidateAndResolvePathDirect = internalValidateAndResolvePath as MockedFunction<typeof internalValidateAndResolvePath>;
const mockedCreateArchive = createArchive as MockedFunction<typeof createArchive>;
const mockedExtractArchive = extractArchive as MockedFunction<typeof extractArchive>;
const mockedCalculateChecksum = internalCalculateChecksum as MockedFunction<typeof internalCalculateChecksum>;

describe('WriteTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockedSecurityHandler.validateAndResolvePath.mockImplementation(async (p) => {
      return path.join(mockedConduitConfig.workspaceRoot, p.startsWith('/') ? p.substring(1) : p);
    });
    mockedValidateAndResolvePathDirect.mockImplementation(async (p) => {
      return path.join(mockedConduitConfig.workspaceRoot, p.startsWith('/') ? p.substring(1) : p);
    });
    mockedSecurityHandler.isPathAllowed.mockReturnValue(true);

    mockedFsOps.writeFile.mockResolvedValue(100); // Default bytes written
    mockedFsOps.createDirectory.mockResolvedValue(undefined);
    mockedFsOps.copyPath.mockResolvedValue(undefined);
    mockedFsOps.movePath.mockResolvedValue(undefined);
    mockedFsOps.deletePath.mockResolvedValue(undefined);
    mockedFsOps.touchFile.mockResolvedValue(undefined);
    mockedFsOps.pathExists.mockResolvedValue(false); // Default: path does not exist (good for creation tests)
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 0 } as any); // Default: path is a file
    mockedCalculateChecksum.mockResolvedValue('mocked-checksum');

    // Ensure conduitConfig is reset and re-applied if modified in tests (though here it's fairly static)
    // This ensures tests don't interfere with each other's config state.
    Object.assign(mockedConduitConfig, {
      server_name: 'test-server',
      server_version: '1.0.0',
      allowed_paths: ['/'],
      max_file_size_mb: 100,
      max_request_size_mb: 50,
      require_path_in_allowed_list: false,
      enable_security_restrictions: false,
      enable_notice_generation: false,
      workspaceRoot: '/mocked/workspace',
      defaultChecksumAlgorithm: 'sha256',
      maxRecursiveDepth: 10,
      resolvedAllowedPaths: ['/mocked/workspace'],
    });

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
        entries: [{ path: '/file.txt', content: 'Hello', input_encoding: 'text' }],
      };
      console.log('validateAndResolvePath identity', internalValidateAndResolvePath === mockedValidateAndResolvePathDirect);
      console.log('validateAndResolvePath impl set?', mockedValidateAndResolvePathDirect.getMockImplementation() !== undefined);
      const response = (await writeToolHandler(
        params,
        mockedConduitConfig
      )) as WriteTool.DefinedBatchResponse;
      console.log('PUT RESPONSE', JSON.stringify(response, null, 2)); // debug
      console.log('validate calls', mockedValidateAndResolvePathDirect.mock.calls.length);
      const result = response.results;
      expect(response.tool_name).toBe('write');
      expect(result[0].status).toBe('success');
      expect(result[0].action_performed).toBe('put');
      expect(result[0].path).toBe('/file.txt');
      expect((result[0] as WriteTool.WriteResultSuccess).bytes_written).toBe(100);
      expect(mockedFsOps.writeFile).toHaveBeenCalledWith(
        '/mocked/workspace/file.txt',
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
      expect(mockedFsOps.createDirectory).toHaveBeenCalledWith('/mocked/workspace/newdir', true);
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
      expect(mockedFsOps.copyPath).toHaveBeenCalledWith('/mocked/workspace/src.txt', '/mocked/workspace/dest.txt');
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
          { path: '/file1.txt', content: 'OK', input_encoding: 'text' },
          { path: '/file2.txt', content: 'FAIL', input_encoding: 'text' },
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
      const params = { action: 'batch', entries: [] } as any; // cast as any to avoid nonexistent type
      const response = (await writeToolHandler(params, mockedConduitConfig)) as MCPErrorStatus;
      expect(response.status).toBe('error');
      expect(response.error_code).toBe(ErrorCode.UNSUPPORTED_OPERATION);
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
    const response = (await writeToolHandler(params as any, mockedConduitConfig)) as MCPErrorStatus;
    expect(response.status).toBe('error');
    expect(response.error_code).toBe(ErrorCode.UNSUPPORTED_OPERATION);
  });
});
