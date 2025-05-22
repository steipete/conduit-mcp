import { listToolHandler } from '@/tools/listTool';
import { ListTool } from '@/types/tools';
import { conduitConfig, ErrorCode, EntryInfo } from '@/internal';
import { ConduitServerConfig } from '@/internal';
import { ConduitError } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';
import * as listOps from '@/operations/listOps';
import * as securityHandler from '@/core/securityHandler';
import * as fileSystemOps from '@/core/fileSystemOps';
import * as fs from 'fs';

// Mocks
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  return {
    ...originalModule,
    conduitConfig: {
      logLevel: 'INFO',
      allowedPaths: ['/allowed'],
      workspaceRoot: '/test-ws',
      httpTimeoutMs: 30000,
      maxPayloadSizeBytes: 1024,
      maxFileReadBytes: 1024,
      imageCompressionThresholdBytes: 1024,
      imageCompressionQuality: 75,
      defaultChecksumAlgorithm: 'sha256',
      maxRecursiveDepth: 10,
      recursiveSizeTimeoutMs: 60000,
      serverStartTimeIso: '2023-01-01T00:00:00.000Z',
      serverVersion: '1.0.0-test',
      maxUrlDownloadSizeBytes: 1024,
      maxFileReadBytesFind: 512,
      userDidSpecifyAllowedPaths: true,
      resolvedAllowedPaths: ['/allowed'],
    } as ConduitServerConfig,
  };
});
vi.mock('@/operations/listOps');
vi.mock('@/core/securityHandler');
vi.mock('@/core/fileSystemOps');

// Typed Mocks
const mockedConduitConfig = conduitConfig as Mocked<ConduitServerConfig>;
const mockedListOps = listOps as Mocked<typeof listOps>;
const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedFileSystemOps = fileSystemOps as Mocked<typeof fileSystemOps>;

describe('ListTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default successful mocks
    if (
      mockedSecurityHandler &&
      typeof mockedSecurityHandler.validateAndResolvePath === 'function'
    ) {
      mockedSecurityHandler.validateAndResolvePath.mockResolvedValue('/resolved/path');
    }

    if (mockedFileSystemOps && typeof mockedFileSystemOps.getStats === 'function') {
      mockedFileSystemOps.getStats.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
    }

    if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
      mockedListOps.handleListEntries.mockResolvedValue([]);
    }

    if (mockedFileSystemOps && typeof mockedFileSystemOps.getFilesystemStats === 'function') {
      mockedFileSystemOps.getFilesystemStats.mockResolvedValue({
        total_bytes: 1000000,
        free_bytes: 500000,
        available_bytes: 500000,
        used_bytes: 500000,
      });
    }
  });

  describe('entries operation', () => {
    it('should list entries in a directory', async () => {
      const mockEntries = [
        {
          name: 'file1.txt',
          path: '/testdir/file1.txt',
          type: 'file',
          size_bytes: 100,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
          permissions_octal: '0644',
          permissions_string: 'rw-r--r--',
        },
        {
          name: 'subdir',
          path: '/testdir/subdir',
          type: 'directory',
          size_bytes: 0,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
          permissions_octal: '0755',
          permissions_string: 'rwxr-xr-x',
        },
      ] as EntryInfo[];

      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockResolvedValueOnce('/testdir');
      }

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockResolvedValueOnce(mockEntries);
      }

      const params: ListTool.EntriesParams = { operation: 'entries', path: '/testdir' };
      const response = (await listToolHandler(
        params,
        mockedConduitConfig as ConduitServerConfig
      )) as ListTool.DefinedEntriesResponse;

      expect(response.results.length).toBe(2);
      expect(response.results[0].name).toBe('file1.txt');
      expect(response.results[1].name).toBe('subdir');
    });

    it('should handle recursive listing', async () => {
      const mockEntries = [
        {
          name: 'subdir',
          path: '/testdir/subdir',
          type: 'directory',
          size_bytes: 0,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
          permissions_octal: '0755',
          permissions_string: 'rwxr-xr-x',
          children: [
            {
              name: 'file.txt',
              path: '/testdir/subdir/file.txt',
              type: 'file',
              size_bytes: 50,
              created_at: new Date().toISOString(),
              modified_at: new Date().toISOString(),
              permissions_octal: '0644',
              permissions_string: 'rw-r--r--',
            },
          ],
        },
      ] as EntryInfo[];

      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockResolvedValueOnce('/testdir');
      }

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockResolvedValueOnce(mockEntries);
      }

      const params: ListTool.EntriesParams = {
        operation: 'entries',
        path: '/testdir',
        recursive_depth: 1,
      };
      const response = (await listToolHandler(
        params,
        mockedConduitConfig as ConduitServerConfig
      )) as ListTool.DefinedEntriesResponse;
      expect(response.results.length).toBe(1);
      expect(response.results[0].name).toBe('subdir');
      expect(response.results[0].children).toBeDefined();
      expect(response.results[0].children?.length).toBe(1);
      expect(response.results[0].children?.[0].name).toBe('file.txt');
    });

    it('should calculate recursive size if requested', async () => {
      const mockEntries = [
        {
          name: 'file1.txt',
          path: '/testdir/file1.txt',
          type: 'file',
          size_bytes: 123,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
          permissions_octal: '0644',
          permissions_string: 'rw-r--r--',
        },
      ] as EntryInfo[];

      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockResolvedValueOnce('/testdir');
      }

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockResolvedValueOnce(mockEntries);
      }

      const params: ListTool.EntriesParams = {
        operation: 'entries',
        path: '/testdir',
        calculate_recursive_size: true,
      };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      // Verify the function was called and response is valid
      expect(mockedListOps.handleListEntries).toHaveBeenCalledWith(params);
      expect(response).toBeDefined();
    });

    it('should return error status object when path validation fails', async () => {
      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockRejectedValueOnce(
          new ConduitError(ErrorCode.ERR_FS_PERMISSION_DENIED, 'Path not allowed')
        );
      }

      const params: ListTool.EntriesParams = { operation: 'entries', path: '/notallowed' };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      expect(response).toMatchObject({
        status: 'error',
        error_code: ErrorCode.ERR_FS_PERMISSION_DENIED,
        error_message: 'Path not allowed',
      });
    });

    it('should return error status object when path is a file', async () => {
      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockResolvedValueOnce('/test/file.txt');
      }

      if (mockedFileSystemOps && typeof mockedFileSystemOps.getStats === 'function') {
        mockedFileSystemOps.getStats.mockResolvedValueOnce({
          isDirectory: () => false,
          isFile: () => true,
        } as fs.Stats);
      }

      const params: ListTool.EntriesParams = { operation: 'entries', path: '/test/file.txt' };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      expect(response).toMatchObject({
        status: 'error',
        error_code: ErrorCode.ERR_FS_PATH_IS_FILE,
        error_message: 'Provided path is a file, not a directory: /test/file.txt',
      });
    });

    it('should return error status object when path does not exist', async () => {
      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockRejectedValueOnce(
          new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, 'Path does not exist')
        );
      }

      const params: ListTool.EntriesParams = { operation: 'entries', path: '/nonexistent' };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      expect(response).toMatchObject({
        status: 'error',
        error_code: ErrorCode.ERR_FS_NOT_FOUND,
        error_message: 'Path does not exist',
      });
    });

    it('should return error status object for unexpected validation errors', async () => {
      if (
        mockedSecurityHandler &&
        typeof mockedSecurityHandler.validateAndResolvePath === 'function'
      ) {
        mockedSecurityHandler.validateAndResolvePath.mockRejectedValueOnce(
          new Error('Unexpected filesystem error')
        );
      }

      const params: ListTool.EntriesParams = { operation: 'entries', path: '/testdir' };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      expect(response).toMatchObject({
        status: 'error',
        error_code: ErrorCode.INTERNAL_ERROR,
        error_message: 'Path validation failed: Unexpected filesystem error',
      });
    });
  });

  describe('system_info operation', () => {
    it('should return server_capabilities', async () => {
      const params: ListTool.SystemInfoParams = {
        operation: 'system_info',
        info_type: 'server_capabilities',
      };
      const response = (await listToolHandler(
        params,
        mockedConduitConfig as ConduitServerConfig
      )) as ListTool.DefinedServerCapabilitiesResponse;
      expect(response.results.server_version).toBe('1.0.0-test');
      expect(response.results.supported_checksum_algorithms).toEqual([
        'md5',
        'sha1',
        'sha256',
        'sha512',
      ]);
      expect(response.results.active_configuration).toBeDefined();
    });

    it('should return filesystem_stats with path', async () => {
      const params: ListTool.SystemInfoParams = {
        operation: 'system_info',
        info_type: 'filesystem_stats',
        path: '/allowed/somepath',
      };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);
      expect(response).toBeDefined();
      expect((response as unknown as { tool_name: string }).tool_name).toBe('list');
      expect((response as unknown as { results: unknown }).results).toBeDefined();
    });

    it('should return guidance if filesystem_stats requested without path', async () => {
      const params: ListTool.SystemInfoParams = {
        operation: 'system_info',
        info_type: 'filesystem_stats',
      };
      const response = (await listToolHandler(
        params,
        mockedConduitConfig as ConduitServerConfig
      )) as { tool_name: string; results: ListTool.FilesystemStatsNoPath };
      expect(response.results.status_message).toContain('No specific path provided');
      expect(response.results.configured_allowed_paths).toEqual(mockedConduitConfig.allowedPaths);
    });

    it('should return server capabilities for system_info operation', async () => {
      const params: ListTool.SystemInfoParams = {
        operation: 'system_info',
        info_type: 'server_capabilities',
      };
      const response = (await listToolHandler(
        params,
        mockedConduitConfig as ConduitServerConfig
      )) as ListTool.DefinedServerCapabilitiesResponse;
      expect(response.results.server_version).toBe('1.0.0-test');
      expect(response.results.supported_checksum_algorithms).toEqual([
        'md5',
        'sha1',
        'sha256',
        'sha512',
      ]);
      expect(response.results.active_configuration).toBeDefined();
    });
  });

  it('should return error status object for invalid operation', async () => {
    const params = { operation: 'invalid_op' } as unknown;
    const response = await listToolHandler(
      params as any,
      mockedConduitConfig as ConduitServerConfig
    );

    expect(response).toMatchObject({
      status: 'error',
      error_code: ErrorCode.INVALID_PARAMETER,
      error_message: 'Unknown operation: invalid_op',
    });
  });
});
