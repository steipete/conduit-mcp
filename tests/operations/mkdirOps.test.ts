// Vitest setup and imports
/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import { type MockedFunction } from 'vitest';
import * as path from 'path'; // For path.resolve if needed in tests, or for matching paths

import { makeDirectory } from '@/operations/mkdirOps';
import { ConduitServerConfig, ErrorCode, ConduitError } from '@/internal';

// Mock @/internal essentials using the robust spread pattern
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();

  const mockedConduitConfig = mockDeep<ConduitServerConfig>();
  const mockedLogger = mockDeep<import('pino').Logger<string>>();
  mockedLogger.child.mockReturnValue(mockedLogger);
  const mockedFileSystemOps = mockDeep<typeof originalModule.fileSystemOps>();
  const mockedSecurityHandler = mockDeep<typeof originalModule.securityHandler>();

  return {
    ...originalModule, // Spread original module first
    // Override specific parts with mocks
    conduitConfig: mockedConduitConfig,
    logger: mockedLogger,
    fileSystemOps: mockedFileSystemOps,
    securityHandler: mockedSecurityHandler,
    // Pass through types/enums from originalModule
    ErrorCode: originalModule.ErrorCode,
    ConduitError: originalModule.ConduitError,
  };
});

// Import mocked items after mock setup
import { conduitConfig, logger, fileSystemOps, securityHandler } from '@/internal';

// Define WriteTool types locally until they're properly exported
interface MkdirEntry {
  path: string;
  recursive?: boolean;
}

describe('mkdirOps', () => {
  // Initialize test-level variables for these mocks with correct proxy/mocked function types
  const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedLogger = logger as unknown as DeepMockProxy<import('pino').Logger<string>>;
  const mockedFsOps = fileSystemOps as DeepMockProxy<typeof fileSystemOps>;
  const mockedSecurityHandler = securityHandler as DeepMockProxy<typeof securityHandler>;

  const defaultTestConfig: Partial<ConduitServerConfig> = {
    workspaceRoot: '/test/workspace',
  };
  const testDirPath = 'new/directory';
  const absoluteTestDirPath = path.join(defaultTestConfig.workspaceRoot!, testDirPath);

  beforeEach(() => {
    // Call mockReset on all these mocks
    mockReset(mockedConfig);
    mockReset(mockedLogger);
    mockReset(mockedFsOps);
    mockReset(mockedSecurityHandler);

    // Assign defaultTestConfig to mockedConfig
    Object.assign(mockedConfig, defaultTestConfig);

    // Set up default implementations
    mockedSecurityHandler.validateAndResolvePath.mockResolvedValue(absoluteTestDirPath);
    mockedFsOps.createDirectory.mockResolvedValue(undefined);
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => false } as import('fs').Stats);
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockResolvedValue(undefined);

    // Ensure logger.child returns the logger
    (mockedLogger.child as MockedFunction<typeof mockedLogger.child>).mockReturnValue(mockedLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully create a new directory (non-recursive implied by ensureDir)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockResolvedValue(undefined);

    const entry: MkdirEntry = { path: testDirPath, recursive: false };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.pathExists).toHaveBeenCalledWith(absoluteTestDirPath);
    expect(mockedFsOps.createDirectory).toHaveBeenCalledWith(absoluteTestDirPath, false);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.path).toBe(testDirPath);
      expect(result.message).toContain('Directory created');
    }
  });

  it('should successfully create a new directory (recursive implied by ensureDir)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockResolvedValue(undefined);

    const entry: MkdirEntry = { path: testDirPath, recursive: true };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.createDirectory).toHaveBeenCalledWith(absoluteTestDirPath, true);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.message).toContain('Directory and any necessary parent directories created');
    }
  });

  it('should return success if directory already exists', async () => {
    mockedFsOps.pathExists.mockResolvedValue(true);
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => true } as import('fs').Stats);

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.createDirectory).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.message).toBe('Directory already exists.');
    }
  });

  it('should return error if path exists and is a file', async () => {
    mockedFsOps.pathExists.mockResolvedValue(true);
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => false } as import('fs').Stats);

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
    }
  });

  it('should return error on permission denied (EACCES)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    const permissionError = new Error('Permission denied') as Error & { code: string };
    permissionError.code = 'EACCES';
    mockedFsOps.createDirectory.mockRejectedValue(permissionError);

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED);
    }
  });

  it('should return error on invalid path component (ENOTDIR)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    const notDirError = new Error('Not a directory') as Error & { code: string };
    notDirError.code = 'ENOTDIR';
    mockedFsOps.createDirectory.mockRejectedValue(notDirError);

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
    }
  });

  it('should return error on other fs operation failure', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.createDirectory.mockRejectedValue(new Error('FS failure'));

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.OPERATION_FAILED);
    }
  });

  it('should return error if path is not provided', async () => {
    const entry: MkdirEntry = { path: '' }; // Test with empty path
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
      expect(result.error_message).toContain('path is required for mkdir');
    }
  });

  it('should return error if path is undefined', async () => {
    const entry: MkdirEntry = { path: undefined as unknown as string }; // Test with undefined path
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
      expect(result.error_message).toContain('path is required for mkdir');
    }
  });

  it('should correctly handle ConduitError thrown by underlying operations', async () => {
    mockedFsOps.pathExists.mockRejectedValue(
      new ConduitError(ErrorCode.ACCESS_DENIED, 'Conduit access denied')
    );

    const entry: MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED);
      expect(result.error_message).toBe(`Permission denied for path: ${testDirPath}`);
    }
  });
});
