import { findToolHandler } from '@/tools/findTool';
import { FindTool } from '@/types/tools';
import { EntryInfo, ConduitError, ErrorCode, conduitConfig, ConduitServerConfig } from '@/internal';
import { findEntriesRecursive } from '@/operations/findOps';
import { vi, type MockedFunction } from 'vitest';

// Mocks
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  return {
    ...originalModule,
    conduitConfig: {
      maxRecursiveDepth: 5,
    },
  };
});
vi.mock('@/operations/findOps', () => ({
  findEntriesRecursive: vi.fn()
}));

const mockedConduitConfig = conduitConfig as any;
const mockedFindEntriesRecursive = findEntriesRecursive as MockedFunction<typeof findEntriesRecursive>;

describe('FindTool', () => {
  const mockBasePath = '/allowed/search_base';
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

    // Default mock for findEntriesRecursive: resolves with empty array
    // Test cases will override this if they expect results.
    mockedFindEntriesRecursive.mockResolvedValue([]);
  });

  it('should call findEntriesRecursive with correct parameters (default recursive)', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*.txt' }],
    };
    await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(mockedFindEntriesRecursive).toHaveBeenCalledWith(
      params,
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
    expect(mockedFindEntriesRecursive).toHaveBeenCalledWith(
      params,
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
    expect(mockedFindEntriesRecursive).toHaveBeenCalledWith(
      params,
      mockedConduitConfig as ConduitServerConfig
    );
  });

  it('should return results populated by findEntriesRecursive', async () => {
    const expectedResults: EntryInfo[] = [mockEntryInfoFile, mockEntryInfoDir];
    mockedFindEntriesRecursive.mockResolvedValue(expectedResults);
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({ tool_name: 'find', results: expectedResults });
  });

  it('should return error response if base_path is missing', async () => {
    const params: Partial<FindTool.Parameters> = { match_criteria: [] };
    mockedFindEntriesRecursive.mockRejectedValueOnce(new ConduitError(ErrorCode.INVALID_PARAMETER, "Missing 'base_path' parameter for find tool."));
    const result = await findToolHandler(params as FindTool.Parameters, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INVALID_PARAMETER,
      error_message: "Missing 'base_path' parameter for find tool."
    });
  });

  it('should return error response if match_criteria is missing or empty', async () => {
    let params: Partial<FindTool.Parameters> = { base_path: mockBasePath };
    mockedFindEntriesRecursive.mockRejectedValueOnce(new ConduitError(ErrorCode.INVALID_PARAMETER, "Missing or empty 'match_criteria' for find tool."));
    let result = await findToolHandler(params as FindTool.Parameters, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INVALID_PARAMETER,
      error_message: "Missing or empty 'match_criteria' for find tool."
    });
    
    params = { base_path: mockBasePath, match_criteria: [] };
    mockedFindEntriesRecursive.mockRejectedValueOnce(new ConduitError(ErrorCode.INVALID_PARAMETER, "Missing or empty 'match_criteria' for find tool."));
    result = await findToolHandler(params as FindTool.Parameters, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INVALID_PARAMETER,
      error_message: "Missing or empty 'match_criteria' for find tool."
    });
  });

  it('should return error response if findEntriesRecursive throws specific ConduitError', async () => {
    const specificError = new ConduitError(ErrorCode.OPERATION_FAILED, 'Specific find op failure');
    mockedFindEntriesRecursive.mockRejectedValueOnce(specificError);
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.OPERATION_FAILED,
      error_message: 'Specific find op failure'
    });
  });

  it('should return error response with generic message if findEntriesRecursive throws non-ConduitError', async () => {
    const genericError = new Error('Generic find op failure');
    mockedFindEntriesRecursive.mockRejectedValueOnce(genericError);
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    const result = await findToolHandler(params, mockedConduitConfig as ConduitServerConfig);
    expect(result).toEqual({
      status: 'error',
      error_code: ErrorCode.INTERNAL_ERROR,
      error_message: 'Internal server error: Generic find op failure'
    });
  });
});