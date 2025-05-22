/// <reference types="vitest/globals" />

import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction, type MockedClass } from 'vitest';
import { mockDeep, type DeepMockProxy, mockReset } from 'vitest-mock-extended';
import * as fsExtra from 'fs-extra'; // Changed from fs/promises
import * as tar from 'tar'; // Corrected import for tar
import AdmZip from 'adm-zip';
import * as path from 'path';
import * as os from 'os';

import { createArchive, extractArchive } from '@/operations/archiveOps';
import {
  ArchiveTool,
  ConduitError,
  ErrorCode,
  logger as internalLogger,
  conduitConfig,
  // fileSystemOps is not directly used by archiveOps, fs-extra is.
  ConduitServerConfig,
} from '@/internal';

// Mock @/internal using the robust spread pattern
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  const loggerForInternalMock = mockDeep<import('pino').Logger<string>>();
  loggerForInternalMock.child.mockReturnValue(loggerForInternalMock);

  const mockedConfigLoader = {
    ...mockDeep<typeof originalModule.configLoader>(),
    conduitConfig: mockDeep<ConduitServerConfig>(),
  };

  return {
    ...originalModule, // Spread original module first
    // Override specific parts with mocks
    logger: loggerForInternalMock,
    configLoader: mockedConfigLoader,
    // fileSystemOps is not mocked here as fs-extra is used directly by archiveOps
    // Other @/internal exports like ConduitError, ErrorCode, ArchiveTool will be passed through.
  };
});

// Mock fs-extra
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  ensureDir: vi.fn(),
  stat: vi.fn(),
  // Add other fs-extra functions used by archiveOps if any
}));

// Mock node-tar (using 'tar' as the import name now)
vi.mock('tar', () => ({
  create: vi.fn(),
  extract: vi.fn(),
}));

// Mock adm-zip
const mockGetEntries = vi.fn(() => []); // Make it a standalone mock fn
const mockAddLocalFolder = vi.fn();
const mockAddLocalFile = vi.fn();
const mockWriteZip = vi.fn();
const mockExtractAllTo = vi.fn();
const mockExtractEntryTo = vi.fn();

vi.mock('adm-zip', () => {
  // Mock the default export (which is the AdmZip class)
  const AdmZipMock = vi.fn().mockImplementation((_zipPath?: string) => {
    // This constructor mock now returns an object with the method mocks
    return {
      addLocalFolder: mockAddLocalFolder,
      addLocalFile: mockAddLocalFile,
      writeZip: mockWriteZip,
      extractAllTo: mockExtractAllTo,
      getEntries: mockGetEntries,
      extractEntryTo: mockExtractEntryTo,
    };
  });
  return { default: AdmZipMock };
});

const MockedAdmZipConstructor = AdmZip as unknown as MockedClass<typeof AdmZip>;

describe('archiveOps', () => {
  const mockedLogger = internalLogger as DeepMockProxy<import('pino').Logger>;
  const mockedConfig = conduitConfig as DeepMockProxy<ConduitServerConfig>;
  const mockedFsExtra = fsExtra as DeepMockProxy<typeof fsExtra>;

  // Correctly type the tar mocks based on the 'tar' import
  const mockedTarCreate = vi.mocked(tar.create, true);
  const mockedTarExtract = vi.mocked(tar.extract, true);

  const mockConfig: ConduitServerConfig = {
    allowedPaths: [path.join(os.tmpdir(), 'conduit-mcp-tests')],
    maxPayloadSizeBytes: 1 * 1024 * 1024,
    maxFileReadBytes: 10 * 1024 * 1024,
    maxUrlDownloadSizeBytes: 10 * 1024 * 1024,
    httpTimeoutMs: 5000,
    imageCompressionQuality: 80,
    maxRecursiveDepth: 10,
    logLevel: 'INFO', // Corrected case
    workspaceRoot: path.join(os.tmpdir(), 'conduit-mcp-tests'), // Added
    maxFileReadBytesFind: 1 * 1024 * 1024, // Added
  };

  const testZipArchivePath = '/test/workspace/archive.zip';
  const testTarGzArchivePath = '/test/workspace/archive.tar.gz';
  const testExtractionPath = '/test/workspace/extracted';

  beforeEach(() => {
    mockReset(mockedLogger);
    // @ts-ignore
    if (mockedLogger.child && typeof mockedLogger.child.mockReset === 'function') {
      // @ts-ignore
      mockedLogger.child.mockReset();
    }
    // @ts-ignore
    mockedLogger.child.mockReturnValue(mockedLogger);

    mockReset(mockedConfig as any); // Reset the deep mock proxy
    // Assign properties individually or clone to ensure type safety and mock behavior
    Object.assign(mockedConfig, mockConfig);

    // Reset fs-extra mocks
    mockedFsExtra.pathExists.mockReset();
    mockedFsExtra.ensureDir.mockReset();
    mockedFsExtra.stat.mockReset();

    // Reset tar mocks
    mockedTarCreate.mockReset();
    mockedTarExtract.mockReset();

    // Reset the constructor mock and the standalone method mocks
    MockedAdmZipConstructor.mockClear(); // Clears calls to the constructor
    mockAddLocalFolder.mockClear();
    mockAddLocalFile.mockClear();
    mockWriteZip.mockClear();
    mockExtractAllTo.mockClear();
    mockGetEntries.mockClear();
    mockGetEntries.mockReturnValue([]); // ensure default for getEntries
    mockExtractEntryTo.mockClear();

    // Default mocks for fsExtra that might be commonly used
    mockedFsExtra.ensureDir.mockResolvedValue(undefined);
    mockedFsExtra.pathExists.mockImplementation(async () => true); // Assume paths exist unless specified
    mockedFsExtra.stat.mockImplementation(
      async (p) =>
        ({
          // Basic stats mock
          isFile: () => !String(p).endsWith('/'),
          isDirectory: () => String(p).endsWith('/'),
          size: 1024,
          mtime: new Date(),
          ctime: new Date(),
          birthtime: new Date(),
        }) as fsExtra.Stats
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createArchive', () => {
    const baseZipParams: ArchiveTool.CreateArchiveParams = {
      operation: 'create',
      archive_path: testZipArchivePath,
      source_paths: ['file1.txt', 'subdir'], // relative to workspaceRoot
      // format: 'zip', // format is inferred by archiveOps
      options: {
        overwrite: true,
      },
    };

    const baseTarGzParams: ArchiveTool.CreateArchiveParams = {
      ...baseZipParams,
      archive_path: testTarGzArchivePath,
      compression: 'gzip',
      // format: 'tar.gz', // format is inferred
    };

    it('should successfully create a ZIP archive', async () => {
      // Mock fs.stat for the source paths, as createArchive calls it
      mockedFsExtra.stat
        .mockImplementationOnce(
          async () => ({ isDirectory: () => false, size: 50 }) as fsExtra.Stats
        ) // file1.txt
        .mockImplementationOnce(
          async () => ({ isDirectory: () => true, size: 100 }) as fsExtra.Stats
        ) // subdir
        .mockImplementationOnce(async () => ({ size: 1024 }) as fsExtra.Stats); // For the final archive stat

      // mockWriteZip is the standalone mock that will be used by the instance
      mockWriteZip.mockReturnValue(undefined); // Explicitly mock as void

      const result = await createArchive(baseZipParams, mockedConfig);

      expect(result.status).toBe('success');
      const successResult = result as ArchiveTool.CreateArchiveSuccess;
      expect(successResult.archive_path).toBe(testZipArchivePath);
      expect(successResult.format_used).toBe('zip');
      expect(successResult.entries_processed).toBe(baseZipParams.source_paths.length);
      expect(successResult.compression_used).toBe('zip');
      expect(successResult.size_bytes).toBe(1024);

      expect(MockedAdmZipConstructor).toHaveBeenCalledTimes(1); // Constructor called once by createArchive
      expect(mockAddLocalFile).toHaveBeenCalledWith(
        `${mockedConfig.workspaceRoot}/file1.txt`,
        '',
        'file1.txt'
      );
      expect(mockAddLocalFolder).toHaveBeenCalledWith(
        `${mockedConfig.workspaceRoot}/subdir`,
        'subdir'
      );
      expect(mockWriteZip).toHaveBeenCalledWith(testZipArchivePath);
      expect(mockedFsExtra.ensureDir).toHaveBeenCalledWith(path.dirname(testZipArchivePath));
      expect(mockedFsExtra.stat).toHaveBeenCalledWith(testZipArchivePath);
    });

    it('should successfully create a TAR.GZ archive', async () => {
      mockedTarCreate.mockResolvedValue(undefined); // tar.create returns void (Promise<void>)
      // Mock fs.stat for source paths if createArchive implementation uses it before tar
      mockedFsExtra.stat.mockImplementation(
        async () => ({ size: 2048, isFile: () => true, isDirectory: () => false }) as fsExtra.Stats
      );

      const result = await createArchive(baseTarGzParams, mockedConfig);

      expect(result.status).toBe('success');
      const successResult = result as ArchiveTool.CreateArchiveSuccess;
      expect(successResult.archive_path).toBe(testTarGzArchivePath);
      expect(successResult.format_used).toBe('tar.gz');
      expect(successResult.entries_processed).toBe(baseTarGzParams.source_paths.length);
      expect(successResult.compression_used).toBe('gzip');
      expect(successResult.size_bytes).toBe(2048);

      expect(mockedTarCreate).toHaveBeenCalledTimes(1);
      expect(mockedTarCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          gzip: true,
          file: testTarGzArchivePath, // Absolute path
          cwd: mockedConfig.workspaceRoot,
          portable: true,
        }),
        baseTarGzParams.source_paths // Paths relative to workspaceRoot
      );
      expect(mockedFsExtra.ensureDir).toHaveBeenCalledWith(path.dirname(testTarGzArchivePath));
      expect(mockedFsExtra.stat).toHaveBeenCalledWith(testTarGzArchivePath); // To get archive size
    });

    it('should return error if source_paths is empty', async () => {
      const params = { ...baseZipParams, source_paths: [] };
      const result = await createArchive(params, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_NO_SOURCES);
    });

    it('should return error if tar creation fails for tar.gz', async () => {
      mockedTarCreate.mockRejectedValue(new Error('Tar creation failed'));
      const result = await createArchive(baseTarGzParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_CREATION_FAILED);
    });

    it('should return error if zip creation fails', async () => {
      mockWriteZip.mockImplementation(() => {
        throw new Error('Zip creation failed');
      });
      mockedFsExtra.stat
        .mockImplementationOnce(
          async () => ({ isDirectory: () => false, size: 50 }) as fsExtra.Stats
        )
        .mockImplementationOnce(
          async () => ({ isDirectory: () => true, size: 100 }) as fsExtra.Stats
        );

      const result = await createArchive(baseZipParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_CREATION_FAILED);
    });
  });

  describe('extractArchive', () => {
    const baseZipParams: ArchiveTool.ExtractArchiveParams = {
      operation: 'extract',
      archive_path: testZipArchivePath,
      target_path: testExtractionPath, // Corrected from destination_path
      // format: 'zip', // inferred
      options: {
        overwrite: true,
      },
    };
    const baseTarGzParams: ArchiveTool.ExtractArchiveParams = {
      ...baseZipParams,
      archive_path: testTarGzArchivePath,
      // format: 'tar.gz', // inferred
    };

    it('should successfully extract a ZIP archive', async () => {
      mockedFsExtra.pathExists.mockImplementation(async () => true);
      // mockExtractAllTo is used here
      mockExtractAllTo.mockReturnThis();

      const result = await extractArchive(baseZipParams, mockedConfig);

      expect(result.status).toBe('success');
      const successResult = result as ArchiveTool.ExtractArchiveSuccess;
      expect(successResult.archive_path).toBe(testZipArchivePath);
      expect(successResult.target_path).toBe(testExtractionPath);
      expect(successResult.format_used).toBe('zip');
      expect(successResult.entries_extracted).toBe(-1); // As per current implementation

      expect(MockedAdmZipConstructor).toHaveBeenCalledWith(testZipArchivePath);
      expect(mockExtractAllTo).toHaveBeenCalledWith(testExtractionPath, true);
      expect(mockedFsExtra.ensureDir).toHaveBeenCalledWith(testExtractionPath);
    });

    it('should successfully extract a TAR.GZ archive', async () => {
      mockedTarExtract.mockResolvedValue(undefined);
      mockedFsExtra.pathExists.mockImplementation(async () => true);

      const result = await extractArchive(baseTarGzParams, mockedConfig);

      expect(result.status).toBe('success');
      const successResult = result as ArchiveTool.ExtractArchiveSuccess;
      expect(successResult.archive_path).toBe(testTarGzArchivePath);
      expect(successResult.target_path).toBe(testExtractionPath);
      expect(successResult.format_used).toBe('tar.gz');
      expect(successResult.entries_extracted).toBe(-1);

      expect(mockedTarExtract).toHaveBeenCalledTimes(1);
      expect(mockedTarExtract).toHaveBeenCalledWith(
        expect.objectContaining({
          file: testTarGzArchivePath, // Absolute path
          cwd: testExtractionPath, // Absolute path
          strip: 0,
        })
      );
      expect(mockedFsExtra.ensureDir).toHaveBeenCalledWith(testExtractionPath);
    });

    it('should return error if archive_path does not exist for zip', async () => {
      mockedFsExtra.pathExists.mockImplementation(async () => false);
      const result = await extractArchive(baseZipParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_NOT_FOUND);
    });

    it('should return error if archive_path does not exist for tar.gz', async () => {
      mockedFsExtra.pathExists.mockImplementation(async () => false);
      const result = await extractArchive(baseTarGzParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_NOT_FOUND);
    });

    it('should return error if tar extraction fails', async () => {
      mockedFsExtra.pathExists.mockImplementation(async () => true);
      mockedTarExtract.mockRejectedValue(new Error('Tar extraction failed'));
      const result = await extractArchive(baseTarGzParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED);
    });

    it('should return error if zip extraction fails', async () => {
      mockedFsExtra.pathExists.mockImplementation(async () => true);
      mockExtractAllTo.mockImplementation(() => {
        throw new Error('Zip extraction failed');
      });
      const result = await extractArchive(baseZipParams, mockedConfig);
      expect(result.status).toBe('error');
      const errorResult = result as ArchiveTool.ArchiveResultError;
      expect(errorResult.error_code).toBe(ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED);
    });
  });
});
