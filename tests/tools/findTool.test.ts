import { handleFindTool } from '@/tools/findTool';
import { FindTool } from '@/types/tools';
import { conduitConfig } from '@/core/configLoader';
import * as securityHandler from '@/core/securityHandler';
import * as findOps from '@/operations/findOps'; // findEntriesRecursive is here
import { EntryInfo } from '@/types/common';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';

// Mocks
vi.mock('@/core/configLoader');
vi.mock('@/core/securityHandler');
vi.mock('@/operations/findOps');

const mockedConduitConfig = conduitConfig as Mocked<typeof conduitConfig>;
const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedFindOps = findOps as Mocked<typeof findOps>;

describe('FindTool', () => {
  const mockBasePath = '/allowed/search_base';
  const mockEntryInfoFile: EntryInfo = {
    name: 'file.txt',
    path: `${mockBasePath}/file.txt`,
    type: 'file',
    size_bytes: 100,
    mime_type: 'text/plain',
    created_at_iso: new Date().toISOString(),
    modified_at_iso: new Date().toISOString(),
  };
  const mockEntryInfoDir: EntryInfo = {
    name: 'subdir',
    path: `${mockBasePath}/subdir`,
    type: 'directory',
    size_bytes: 0,
    created_at_iso: new Date().toISOString(),
    modified_at_iso: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSecurityHandler.validateAndResolvePath.mockImplementation(async (p) => p); // Pass through
    // @ts-ignore
    mockedConduitConfig.maxRecursiveDepth = 5;
    
    // Default mock for findEntriesRecursive: resolves without finding anything
    // Test cases will override this if they expect results.
    mockedFindOps.findEntriesRecursive.mockImplementation(async (base, crit, type, rec, curDepth, maxDepth, results) => {
      // In a real scenario, this function would push to `results` array.
      // For testing handleFindTool, we mostly care that it's called with correct parameters.
      // If a test expects results, it should provide a specific mock for this call.
      return Promise.resolve();
    });
  });

  it('should call findEntriesRecursive with correct parameters (default recursive)', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*.txt' }],
    };
    await handleFindTool(params);
    expect(mockedSecurityHandler.validateAndResolvePath).toHaveBeenCalledWith(mockBasePath, { isExistenceRequired: true });
    expect(mockedFindOps.findEntriesRecursive).toHaveBeenCalledWith(
      mockBasePath,
      params.match_criteria,
      'any', // default entry_type_filter
      true,  // default recursive
      0,     // initial currentDepth
      mockedConduitConfig.maxRecursiveDepth, // maxDepth from config
      expect.any(Array) // results array
    );
  });

  it('should respect recursive:false parameter', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*.txt' }],
      recursive: false,
    };
    await handleFindTool(params);
    expect(mockedFindOps.findEntriesRecursive).toHaveBeenCalledWith(
      mockBasePath,
      params.match_criteria,
      'any',
      false, // recursive set to false
      0,
      0,     // maxDepth becomes 0 if not recursive
      expect.any(Array)
    );
  });

  it('should pass entry_type_filter correctly', async () => {
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*'}],
      entry_type_filter: 'file',
    };
    await handleFindTool(params);
    expect(mockedFindOps.findEntriesRecursive).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'file', // entry_type_filter passed
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should return results populated by findEntriesRecursive', async () => {
    const expectedResults = [mockEntryInfoFile, mockEntryInfoDir];
    mockedFindOps.findEntriesRecursive.mockImplementation(async (base, crit, type, rec, curDepth, maxDepth, results) => {
      results.push(...expectedResults);
      return Promise.resolve();
    });
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    const actualResults = await handleFindTool(params) as EntryInfo[];
    expect(actualResults).toEqual(expectedResults);
  });

  it('should throw ERR_INVALID_PARAMETER if base_path is missing', async () => {
    const params = { match_criteria: [] } as any;
    await expect(handleFindTool(params)).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing 'base_path' parameter for find tool.")
    );
  });

  it('should throw ERR_INVALID_PARAMETER if match_criteria is missing or empty', async () => {
    let params = { base_path: mockBasePath } as any;
    await expect(handleFindTool(params)).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'match_criteria' for find tool.")
    );
    params = { base_path: mockBasePath, match_criteria: [] } as any;
    await expect(handleFindTool(params)).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'match_criteria' for find tool.")
    );
  });

  it('should propagate errors from findEntriesRecursive if they are ConduitErrors', async () => {
    const specificError = new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, 'Specific find op failure');
    mockedFindOps.findEntriesRecursive.mockRejectedValueOnce(specificError);
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    await expect(handleFindTool(params)).rejects.toThrow(specificError);
  });

  it('should wrap generic errors from findEntriesRecursive into ConduitError', async () => {
    const genericError = new Error('Generic failure in find op');
    mockedFindOps.findEntriesRecursive.mockRejectedValueOnce(genericError);
    const params: FindTool.Parameters = {
      base_path: mockBasePath,
      match_criteria: [{ type: 'name_pattern', pattern: '*' }],
    };
    await expect(handleFindTool(params)).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Find operation failed: ${genericError.message}`)
    );
  });
}); 