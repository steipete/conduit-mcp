import { listToolHandler } from '@/tools/listTool';
import { ListTool } from '@/types/tools';
import { conduitConfig, ErrorCode } from '@/internal';
import { ConduitServerConfig } from '@/internal';
import { ConduitError } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';
import * as listOps from '@/operations/listOps';

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

// Typed Mocks
const mockedConduitConfig = conduitConfig as Mocked<ConduitServerConfig>;
const mockedListOps = listOps as Mocked<typeof listOps>;

describe('ListTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
      mockedListOps.handleListEntries.mockResolvedValue([]);
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

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockResolvedValueOnce(mockEntries);
      }

      const params: ListTool.EntriesParams = {
        operation: 'entries',
        path: '/testdir',
        calculate_recursive_size: true,
      };
      const response = await listToolHandler(params, mockedConduitConfig as ConduitServerConfig);

      // Add assertion to verify the function was called and response is valid
      expect(mockedListOps.handleListEntries).toHaveBeenCalledWith(
        '/testdir',
        mockedConduitConfig,
        true
      );
      expect(response).toBeDefined();
    });

    it('should throw error if path is not a directory', async () => {
      const params: ListTool.EntriesParams = { operation: 'entries', path: '/notadir' };

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockRejectedValueOnce(
          new ConduitError(ErrorCode.ERR_FS_PATH_IS_FILE)
        );
      }

      await expect(
        listToolHandler(params, mockedConduitConfig as ConduitServerConfig)
      ).rejects.toThrow(new ConduitError(ErrorCode.ERR_FS_PATH_IS_FILE));
    });

    // Test case: path is a file, not a directory
    it('should return ERR_FS_PATH_IS_FILE if base path is a file', async () => {
      const params: ListTool.Parameters = { operation: 'entries', path: '/test/file.txt' };

      if (mockedListOps && typeof mockedListOps.handleListEntries === 'function') {
        mockedListOps.handleListEntries.mockRejectedValueOnce(
          new ConduitError(ErrorCode.ERR_FS_PATH_IS_FILE, 'Path is a file, not a directory')
        );
      }

      await expect(
        listToolHandler(params, mockedConduitConfig as ConduitServerConfig)
      ).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_FS_PATH_IS_FILE, 'Path is a file, not a directory')
      );
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

  it('should throw error for invalid operation', async () => {
    const params = { operation: 'invalid_op' } as unknown;
    await expect(
      listToolHandler(params, mockedConduitConfig as ConduitServerConfig)
    ).rejects.toThrow(new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION));
  });
});
