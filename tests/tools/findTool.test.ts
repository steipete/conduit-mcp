import { findToolHandler } from '@/tools/findTool';
import { FindTool } from '@/types/tools';
import {
  EntryInfo,
  ConduitError,
  ErrorCode,
  conduitConfig,
  ConduitServerConfig,
  validateAndResolvePath,
  fileSystemOps,
} from '@/internal';
import { findEntries } from '@/operations/findOps';
import { vi, type MockedFunction } from 'vitest';

// Mocks
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  return {
    ...originalModule,
    conduitConfig: {
      maxRecursiveDepth: 5,
    },
    validateAndResolvePath: vi.fn(),
    fileSystemOps: {
      getStats: vi.fn(),
    },
  };
});

vi.mock('@/operations/findOps', () => ({
  findEntries: vi.fn(),
}));

const mockedConduitConfig = conduitConfig as vi.Mocked<ConduitServerConfig>;
const mockedValidateAndResolvePath = validateAndResolvePath as MockedFunction<
  typeof validateAndResolvePath
>;
const mockedFileSystemOps = fileSystemOps as vi.Mocked<typeof fileSystemOps>;
const mockedFindEntries = findEntries as MockedFunction<typeof findEntries>;

describe('FindTool', () => {
  const mockBasePath = '/allowed/search_base';
  const mockResolvedPath = '/resolved/allowed/search_base';
  const mockTimestamp = new Date().toISOString();
  const mockEntryInfoFile: EntryInfo = {
    name: 'file.txt',
    path: '/test/file.txt',
    type: 'file',
    size_bytes: 100,
    mime_type: 'text/plain',
    created_at: mockTimestamp,
    modified_at: mockTimestamp,
    permissions_octal: '0644',
    permissions_string: 'rw-r--r--',
  };
  const mockEntryInfoDir: EntryInfo = {
    name: 'directory',
    path: '/test/directory',
    type: 'directory',
    size_bytes: 0,
    created_at: mockTimestamp,
    modified_at: mockTimestamp,
    permissions_octal: '0755',
    permissions_string: 'rwxr-xr-x',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedConduitConfig.maxRecursiveDepth = 5;

    // Default successful mocks
    mockedValidateAndResolvePath.mockResolvedValue(mockResolvedPath);
    mockedFileSystemOps.getStats.mockResolvedValue({ isDirectory: () => true });
    mockedFindEntries.mockResolvedValue([]);
  });

  it('should validate and resolve path, then call findEntries with resolved path', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*.txt' }],
    };

    await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);

    expect(mockedValidateAndResolvePath).toHaveBeenCalledWith(mockBasePath, {
      isExistenceRequired: true,
      checkAllowed: true,
    });
    expect(mockedFileSystemOps.getStats).toHaveBeenCalledWith(mockResolvedPath);
    expect(mockedFindEntries).toHaveBeenCalledWith(
      { ...params, base_path: mockResolvedPath },
      mockedConduitConfig as ConduitServerConfig
    );
  });

  it('should respect recursive:false parameter', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*.txt' }],
      recursive: false,
    };

    await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);

    expect(mockedFindEntries).toHaveBeenCalledWith(
      { ...params, base_path: mockResolvedPath },
      mockedConduitConfig as ConduitServerConfig
    );
  });

  it('should pass entry_type_filter correctly', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
      entry_type_filter: 'file',
    };

    await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);

    expect(mockedFindEntries).toHaveBeenCalledWith(
      { ...params, base_path: mockResolvedPath },
      mockedConduitConfig as ConduitServerConfig
    );
  });

  it('should return results populated by findEntries', async () => {
    const expectedResults: EntryInfo[] = [mockEntryInfoFile, mockEntryInfoDir];
    mockedFindEntries.mockResolvedValue(expectedResults);

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({ tool_name: 'find', results: expectedResults });
  });

  it('should return error response if path validation fails', async () => {
    const validationError = new ConduitError(
      ErrorCode.ERR_PATH_VALIDATION,
      'Path validation failed'
    );
    mockedValidateAndResolvePath.mockRejectedValue(validationError);

    const params: FindTool.Parameters = {
      base_path: '/invalid/path',
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.ERR_PATH_VALIDATION,
      error_message: 'Path validation failed',
    });
  });

  it('should return error response if base_path is a file not directory', async () => {
    mockedFileSystemOps.getStats.mockResolvedValue({ isDirectory: () => false });

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.ERR_FS_PATH_IS_FILE,
      error_message: `Provided base_path is a file, not a directory: ${mockResolvedPath}`,
    });
  });

  it('should return error response if findEntries returns ConduitError', async () => {
    const findError = new ConduitError(ErrorCode.OPERATION_FAILED, 'Find operation failed');
    mockedFindEntries.mockResolvedValue(findError);

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.OPERATION_FAILED,
      error_message: 'Find operation failed',
    });
  });

  it('should return error response if findEntries throws ConduitError', async () => {
    const findError = new ConduitError(ErrorCode.OPERATION_FAILED, 'Find operation failed');
    mockedFindEntries.mockRejectedValue(findError);

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.OPERATION_FAILED,
      error_message: 'Find operation failed',
    });
  });

  it('should return error response if an unexpected error occurs', async () => {
    const genericError = new Error('Unexpected error');
    mockedFindEntries.mockRejectedValue(genericError);

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INTERNAL_ERROR,
      error_message: 'Internal server error: Unexpected error',
    });
  });

  it('should return error response if fileSystemOps.getStats throws error', async () => {
    const statsError = new Error('Stats error');
    mockedFileSystemOps.getStats.mockRejectedValue(statsError);

    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };

    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INTERNAL_ERROR,
      error_message: 'Internal server error: Stats error',
    });
  });
});
