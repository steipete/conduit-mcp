// Vitest setup and imports
/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import * as path from 'path'; // For path.resolve if needed in tests, or for matching paths

import { makeDirectory } from '@/operations/mkdirOps';
import {
  WriteTool,
  ConduitServerConfig,
  ErrorCode,
  logger as internalLogger,
  configLoader,
  fileSystemOps as internalFileSystemOps,
  ConduitError,
  conduitConfig,
} from '@/internal';

// Mock @/internal essentials using the robust spread pattern
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();

  const loggerMock = mockDeep<import('pino').Logger<string>>();
  loggerMock.child.mockReturnValue(loggerMock);

  const configLoaderMock = {
    ...mockDeep<typeof originalModule.configLoader>(),
    conduitConfig: mockDeep<ConduitServerConfig>(),
  };

  const fileSystemOpsMock = mockDeep<typeof originalModule.fileSystemOps>();

  return {
    ...originalModule, // Spread original module first
    // Override specific parts with mocks
    logger: loggerMock,
    configLoader: configLoaderMock,
    fileSystemOps: fileSystemOpsMock,
    // ConduitError, ErrorCode, WriteTool etc. will be passed from originalModule
  };
});

describe('mkdirOps', () => {
  const mockedLogger = internalLogger as DeepMockProxy<import('pino').Logger>;
  const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedFsOps = internalFileSystemOps as DeepMockProxy<typeof internalFileSystemOps>;

  const defaultTestConfig: Partial<ConduitServerConfig> = {
    workspaceRoot: '/test/workspace',
  };
  const testDirPath = 'new/directory';
  const absoluteTestDirPath = path.join(defaultTestConfig.workspaceRoot!, testDirPath);

  beforeEach(() => {
    mockReset(mockedLogger);
    if (mockedLogger.child && typeof mockedLogger.child.mockReset === 'function') {
      mockedLogger.child.mockReset();
    }
    mockedLogger.child.mockReturnValue(mockedLogger as any); // Ensure child() returns the mock post-reset

    mockReset(mockedConfig as any);
    Object.assign(mockedConfig, defaultTestConfig);
    // Ensure workspaceRoot is set for path resolution in tests
    mockedConfig.workspaceRoot = defaultTestConfig.workspaceRoot!;

    mockReset(mockedFsOps);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully create a new directory (non-recursive implied by ensureDir)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockResolvedValue(undefined);

    const entry: WriteTool.MkdirEntry = { path: testDirPath, recursive: false };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.pathExists).toHaveBeenCalledWith(absoluteTestDirPath);
    expect(mockedFsOps.ensureDirectoryExists).toHaveBeenCalledWith(absoluteTestDirPath);
    expect(result.status).toBe('success');
    const successResult = result as WriteTool.WriteResultSuccess;
    expect(successResult.path).toBe(testDirPath);
    expect(successResult.message).toContain('Directory created');
  });

  it('should successfully create a new directory (recursive implied by ensureDir)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockResolvedValue(undefined);

    const entry: WriteTool.MkdirEntry = { path: testDirPath, recursive: true };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.ensureDirectoryExists).toHaveBeenCalledWith(absoluteTestDirPath);
    expect(result.status).toBe('success');
    const successResult = result as WriteTool.WriteResultSuccess;
    expect(successResult.message).toContain(
      'Directory and any necessary parent directories created'
    );
  });

  it('should return success if directory already exists', async () => {
    mockedFsOps.pathExists.mockResolvedValue(true);
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => true } as any);

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(mockedFsOps.ensureDirectoryExists).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    const successResult = result as WriteTool.WriteResultSuccess;
    expect(successResult.message).toBe('Directory already exists.');
  });

  it('should return error if path exists and is a file', async () => {
    mockedFsOps.pathExists.mockResolvedValue(true);
    mockedFsOps.getStats.mockResolvedValue({ isDirectory: () => false } as any);

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
    }
  });

  it('should return error on permission denied (EACCES)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    const permissionError: any = new Error('Permission denied');
    permissionError.code = 'EACCES';
    mockedFsOps.ensureDirectoryExists.mockRejectedValue(permissionError);

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED);
    }
  });

  it('should return error on invalid path component (ENOTDIR)', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    const notDirError: any = new Error('Not a directory');
    notDirError.code = 'ENOTDIR';
    mockedFsOps.ensureDirectoryExists.mockRejectedValue(notDirError);

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PATH_IS_FILE);
    }
  });

  it('should return error on other fs operation failure', async () => {
    mockedFsOps.pathExists.mockResolvedValue(false);
    mockedFsOps.ensureDirectoryExists.mockRejectedValue(new Error('FS failure'));

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.OPERATION_FAILED);
    }
  });

  it('should return error if path is not provided', async () => {
    const entry: WriteTool.MkdirEntry = { path: '' }; // Test with empty path
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
      expect(result.error_message).toContain('path is required for mkdir');
    }
  });

  it('should return error if path is undefined', async () => {
    const entry: WriteTool.MkdirEntry = { path: undefined as any }; // Test with undefined path
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

    const entry: WriteTool.MkdirEntry = { path: testDirPath };
    const result = await makeDirectory(entry, mockedConfig as ConduitServerConfig);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED);
      expect(result.error_message).toBe(`Permission denied for path: ${testDirPath}`);
    }
  });
});
