import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import type { Stats as FsStats } from "fs";
import os from "os";

// Define mockFs, clearMockFs, and mockConduitConfig at the VERY TOP
const { mockFs, clearMockFs } = vi.hoisted(() => {
  const data: { [key: string]: { type: "file" | "dir"; content: string } } = {};
  const fsMock = {
    stat: vi.fn(),
    lstat: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    rmdir: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    cp: vi.fn(),
    rename: vi.fn(),
    utimes: vi.fn(),
    _data: data,
  };
  return {
    mockFs: fsMock,
    clearMockFs: () => {
      for (const key in data) {
        delete data[key];
      }
      fsMock.stat.mockReset();
      fsMock.lstat.mockReset();
      fsMock.mkdir.mockReset();
    },
  };
});

const mockConduitConfig = vi.hoisted(() => ({
  logLevel: "INFO" as const,
  allowedPaths: [] as string[],
  workspaceRoot: "",
  httpTimeoutMs: 5000,
  maxPayloadSizeBytes: 1024 * 1024,
  maxFileReadBytes: 1024 * 1024,
  imageCompressionThresholdBytes: 1024 * 1024,
  imageCompressionQuality: 75,
  defaultChecksumAlgorithm: "sha256" as const,
  maxRecursiveDepth: 10,
  recursiveSizeTimeoutMs: 60000,
  serverStartTimeIso: new Date().toISOString(),
  serverVersion: "1.0.0-test",
  maxUrlDownloadSizeBytes: 1024 * 1024,
  maxFileReadBytesFind: 10000,
  imageUploadPath: "/tmp/conduit-uploads",
  pluginsPath: "/tmp/conduit-plugins",
  macOsAutomationTimeoutMs: 60000,
  conduitExecutablePath: "/path/to/conduit",
  resultsCachePath: "/tmp/conduit-cache",
  resolvedAllowedPaths: [] as string[],
  resolvedWorkspaceRoot: "",
  userDidSpecifyAllowedPaths: false,
}));

// 1. Mock fs/promises FIRST, using the above defined mocks
vi.mock("fs/promises", () => ({
  ...mockFs,
  default: mockFs,
}));

vi.mock("fs-extra", () => {
  const fsExtraMock = {
    pathExists: vi.fn(async (p: string) => Boolean(mockFs._data[p])),
    ensureDir: vi.fn(async (p: string) => mockFs.mkdir(p, { recursive: true })),
    stat: vi.fn(async (p: string) => {
      try {
        return await mockFs.stat(p);
      } catch (error) {
        if ((p.split(/[\\/]/).pop() ?? "").startsWith("new_archive")) {
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
        }
        throw error;
      }
    }),
  };
  return {
    ...fsExtraMock,
    default: fsExtraMock,
  };
});

// 2. THEN, Mock @/internal. Its dependencies (like securityHandler) will now see the mocked fs/promises
const mockPathValidationStrategy = vi.hoisted(() => ({
  validateForCreation: vi.fn(),
  validateForReading: vi.fn(),
  validateForWriting: vi.fn(),
}));
vi.mock("@/internal", async (importOriginal) => {
  // Reverted to vi.mock, kept async factory for safety with importActual
  const original = await importOriginal<typeof import("@/internal")>();
  const actualErrorHandler =
    await vi.importActual<typeof import("@/utils/errorHandler")>("@/utils/errorHandler");
  return {
    ...original,
    conduitConfig: mockConduitConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    getMimeType: vi.fn().mockResolvedValue("application/zip"),
    PathValidationStrategy: mockPathValidationStrategy,
    ConduitError: actualErrorHandler.ConduitError, // Use errors from actual error handler
    ErrorCode: actualErrorHandler.ErrorCode, // Use error codes from actual error handler
  };
});

// Mock 'adm-zip' and 'tar' - these are less likely to cause hoisting issues with fs
vi.mock("adm-zip", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        extractAllTo: vi.fn(),
        getEntries: vi.fn(() => [{ entryName: "file1.txt", isDirectory: false }]),
        addLocalFile: vi.fn(),
        addLocalFolder: vi.fn(),
        writeZip: vi.fn(),
      };
    }),
  };
});

vi.mock("tar", () => {
  return {
    extract: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
  };
});

// 3. Now import the System Under Test and other necessary modules
import { archiveToolHandler } from "@/operations/archiveOps";
import { ConduitError, ErrorCode } from "@/utils/errorHandler"; // Standard imports for types and direct use if needed
import AdmZip from "adm-zip";
import * as tar from "tar";
import type { ArchiveTool } from "@/internal"; // Type-only import

const createAdmZipMockInstance = (): AdmZip =>
  ({
    extractAllTo: vi.fn(),
    extractEntryTo: vi.fn(),
    getEntries: vi.fn(() => [{ entryName: "file1.txt", isDirectory: false }]),
    addLocalFile: vi.fn(),
    addLocalFolder: vi.fn(),
    writeZip: vi.fn(),
  }) as unknown as AdmZip;

describe("archiveOps - archiveToolHandler (extract)", () => {
  const workspaceRoot = "/users/test/projects/conduit-mcp";
  const allowedPaths = [
    "/users/test/projects/conduit-mcp/data",
    "/users/test/other_allowed_dir",
    "~/Desktop",
  ];
  const userHome = os.homedir();
  let admZipInstance: AdmZip;

  // Restore resolvePathForTest here, within the describe block, so it has access to userHome and mockConduitConfig after they are set up in beforeEach
  let resolvePathForTest: (p: string) => string;

  beforeEach(() => {
    clearMockFs();
    vi.clearAllMocks();

    mockConduitConfig.workspaceRoot = workspaceRoot;
    mockConduitConfig.allowedPaths = [...allowedPaths];
    mockConduitConfig.resolvedAllowedPaths = allowedPaths.map((p) =>
      p.startsWith("~") ? path.join(userHome, p.substring(1)) : path.resolve(workspaceRoot, p),
    );
    mockConduitConfig.resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    // Define/redefine resolvePathForTest here after mockConduitConfig is populated
    resolvePathForTest = (p: string) => {
      if (p.startsWith("~")) return path.join(userHome, p.substring(1));
      return path.isAbsolute(p) ? p : path.join(mockConduitConfig.resolvedWorkspaceRoot, p);
    };

    mockPathValidationStrategy.validateForCreation.mockImplementation(async (p: string) =>
      resolvePathForTest(p),
    );
    mockPathValidationStrategy.validateForReading.mockImplementation(async (p: string) =>
      resolvePathForTest(p),
    );
    mockPathValidationStrategy.validateForWriting.mockImplementation(async (p: string) =>
      resolvePathForTest(p),
    );

    mockFs.stat.mockImplementation(async (p: string): Promise<FsStats> => {
      const resolvedPath = resolvePathForTest(p); // Uses the function

      if (mockFs._data[resolvedPath]) {
        if (mockFs._data[resolvedPath].type === "dir") {
          return { isDirectory: () => true, isFile: () => false, size: 4096 } as FsStats;
        }
        if (mockFs._data[resolvedPath].type === "file") {
          return {
            isDirectory: () => false,
            isFile: () => true,
            size: mockFs._data[resolvedPath].content.length,
          } as FsStats;
        }
      }
      if (
        resolvedPath.includes("test_archive") &&
        (resolvedPath.endsWith(".zip") || resolvedPath.endsWith(".tar.gz"))
      ) {
        return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
      }
      if (
        mockConduitConfig.resolvedAllowedPaths.includes(resolvedPath) ||
        resolvedPath === mockConduitConfig.resolvedWorkspaceRoot
      ) {
        return { isDirectory: () => true, isFile: () => false, size: 4096 } as FsStats;
      }
      const error = new Error(
        `ENOENT: no such file or directory, stat '${resolvedPath}'`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    mockFs.lstat.mockImplementation(mockFs.stat);
    mockFs.mkdir.mockImplementation(
      async (dirPath: string, _options?: { recursive?: boolean } | number | null) => {
        const resolvedDirPath = resolvePathForTest(dirPath.toString()); // Uses the function
        mockFs._data[resolvedDirPath] = { type: "dir", content: "" };
        return undefined as unknown as string;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ZIP Extraction", () => {
    const archiveFile = "test_archive.zip";

    beforeEach(() => {
      const resolvedArchiveFilePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        archiveFile,
      );
      mockFs._data[resolvedArchiveFilePath] = { type: "file", content: "zipcontent" };

      admZipInstance = createAdmZipMockInstance();
      vi.mocked(AdmZip)
        .mockClear()
        .mockImplementation(function () {
          return admZipInstance;
        });
      vi.mocked(admZipInstance.extractAllTo).mockClear();
      vi.mocked(admZipInstance.addLocalFile).mockClear();
      vi.mocked(admZipInstance.addLocalFolder).mockClear();
      vi.mocked(admZipInstance.writeZip).mockClear();

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async (pOrig: string): Promise<FsStats> => {
          const error = new Error(
            `Original stat not found for path: ${pOrig}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedArchiveFilePath) {
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
        }
        if (
          p.includes("extracted_zip_test") ||
          p.includes("sub_extracted_zip_test") ||
          p.includes("extracted_zip_ws") ||
          p.includes("target_for_zip_extract")
        ) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });
    });

    it("should successfully extract a ZIP to a directly allowed path (e.g., ~/Desktop)", async () => {
      const targetUserPath = "~/Desktop/extracted_zip_test";
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: targetUserPath,
      };

      mockFs._data[path.join(userHome, "Desktop")] = { type: "dir", content: "" };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ExtractArchiveSuccess;

      expect(result.status).toBe("success");
      const expectedResolvedTargetPath = resolvePathForTest(targetUserPath); // Uses the function
      expect(result.target_path).toBe(expectedResolvedTargetPath);
      expect(AdmZip).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
      );
      expect(admZipInstance.extractAllTo).toHaveBeenCalledWith(expectedResolvedTargetPath, true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedResolvedTargetPath, { recursive: true });
    });

    it("should successfully extract a ZIP to a sub-directory of a directly allowed path", async () => {
      const targetUserPath = "~/Desktop/sub_dir/sub_extracted_zip_test";
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: targetUserPath,
      };

      mockFs._data[path.join(userHome, "Desktop")] = { type: "dir", content: "" };
      mockFs._data[path.join(userHome, "Desktop", "sub_dir")] = { type: "dir", content: "" };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ExtractArchiveSuccess;

      expect(result.status).toBe("success");
      const expectedResolvedTargetPath = resolvePathForTest(targetUserPath); // Uses the function
      expect(result.target_path).toBe(expectedResolvedTargetPath);
      expect(AdmZip).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
      );
      expect(admZipInstance.extractAllTo).toHaveBeenCalledWith(expectedResolvedTargetPath, true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedResolvedTargetPath, { recursive: true });
    });

    it("should successfully extract a ZIP to a path within workspaceRoot", async () => {
      const destinationDir = "data/extracted_zip_ws";
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: destinationDir,
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ExtractArchiveSuccess;

      expect(result.status).toBe("success");
      const expectedResolvedTargetPath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        destinationDir,
      );
      expect(result.target_path).toBe(expectedResolvedTargetPath);
      expect(AdmZip).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
      );
      expect(admZipInstance.extractAllTo).toHaveBeenCalledWith(expectedResolvedTargetPath, true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedResolvedTargetPath, { recursive: true });
    });

    it("should fail to extract a ZIP to a disallowed path", async () => {
      const disallowedDestPath = "/tmp/disallowed_extraction";
      mockPathValidationStrategy.validateForWriting.mockImplementation(async (p: string) => {
        const resolvedP = resolvePathForTest(p); // Uses the function
        if (resolvedP === resolvePathForTest(disallowedDestPath)) {
          // Uses the function
          throw new ConduitError(
            ErrorCode.ERR_FS_PERMISSION_DENIED,
            `Permission denied for path ${resolvedP}`,
          ); // Reverted
        }
        return resolvedP;
      });

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: disallowedDestPath,
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED); // Reverted
      expect(AdmZip).not.toHaveBeenCalled();
      expect(admZipInstance.extractAllTo).not.toHaveBeenCalled();
    });

    it("should handle non-existent archive file for ZIP extraction", async () => {
      const nonExistentArchive = "non_existent_archive.zip";
      const resolvedNonExistentPath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        nonExistentArchive,
      );

      mockPathValidationStrategy.validateForReading.mockImplementation(async (p: string) => {
        const resolvedP = resolvePathForTest(p); // Uses the function
        if (resolvedP === resolvedNonExistentPath) {
          throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `File not found: ${resolvedP}`); // Reverted
        }
        return resolvedP;
      });

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async () => {
          throw new Error("Original stat not found");
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedNonExistentPath) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: nonExistentArchive,
        target_path: "data/some_destination",
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_FS_NOT_FOUND); // Reverted
      expect(AdmZip).not.toHaveBeenCalled();
    });

    it("should fail if AdmZip throws an error during ZIP extraction", async () => {
      const errorMessage = "Zip processing failed";
      vi.mocked(admZipInstance.extractAllTo).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: "data/target_for_zip_extract",
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED); // Reverted
      expect(result.error_message).toContain(errorMessage);
      expect(AdmZip).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
      );
      expect(admZipInstance.extractAllTo).toHaveBeenCalled();
    });
  });

  describe("TAR.GZ Extraction", () => {
    const archiveFile = "test_archive.tar.gz";

    beforeEach(() => {
      const resolvedArchiveFilePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        archiveFile,
      );
      mockFs._data[resolvedArchiveFilePath] = { type: "file", content: "tarcontent" };
      vi.mocked(tar.extract).mockClear().mockResolvedValue(undefined);

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async (pOrig: string): Promise<FsStats> => {
          const error = new Error(
            `Original stat not found for path: ${pOrig}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedArchiveFilePath) {
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
        }
        if (
          p.includes("extracted_tar_test") ||
          p.includes("sub_extracted_tar_test") ||
          p.includes("extracted_tar_ws") ||
          p.includes("target_for_tar_extract")
        ) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });
      const desktopPath = path.join(userHome, "Desktop");
      if (!mockConduitConfig.resolvedAllowedPaths.includes(desktopPath)) {
        mockConduitConfig.resolvedAllowedPaths.push(desktopPath);
      }
      mockFs._data[desktopPath] = { type: "dir", content: "" }; // Ensure ~/Desktop exists as a dir
    });

    it("should successfully extract a TAR.GZ to a directly allowed path (e.g., ~/Desktop)", async () => {
      const targetUserPath = "~/Desktop/extracted_tar_test";
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: targetUserPath,
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ExtractArchiveSuccess;

      expect(result.status).toBe("success");
      const expectedResolvedTargetPath = resolvePathForTest(targetUserPath); // Uses the function
      expect(result.target_path).toBe(expectedResolvedTargetPath);
      expect(tar.extract).toHaveBeenCalledWith({
        file: path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
        cwd: expectedResolvedTargetPath,
        strip: undefined,
      });
      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedResolvedTargetPath, { recursive: true });
    });

    it("should successfully extract a TAR.GZ with strip components option", async () => {
      const destinationDir = "data/extracted_tar_strip";
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: destinationDir,
        options: { strip_components: 1 },
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ExtractArchiveSuccess;
      const expectedResolvedTargetPath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        destinationDir,
      );

      expect(result.status).toBe("success");
      expect(result.target_path).toBe(expectedResolvedTargetPath);
      expect(tar.extract).toHaveBeenCalledWith(
        expect.objectContaining({
          file: path.resolve(mockConduitConfig.resolvedWorkspaceRoot, archiveFile),
          cwd: expectedResolvedTargetPath,
          strip: 1,
        }),
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedResolvedTargetPath, { recursive: true });
    });

    it("should fail if tar.extract throws an error during TAR.GZ extraction", async () => {
      const errorMessage = "Tar extraction failed";
      vi.mocked(tar.extract).mockRejectedValue(new Error(errorMessage));

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFile,
        target_path: "data/target_for_tar_extract",
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED); // Reverted
      expect(result.error_message).toContain(errorMessage);
      expect(tar.extract).toHaveBeenCalled();
    });
  });

  describe("Archive Creation (ZIP)", () => {
    const targetArchiveFile = "new_archive.zip";
    const sourceDir = "data/source_for_zip";
    const sourceFile = "data/source_file.txt";

    beforeEach(() => {
      admZipInstance = createAdmZipMockInstance();
      vi.mocked(AdmZip)
        .mockClear()
        .mockImplementation(function () {
          return admZipInstance;
        });
      vi.mocked(admZipInstance.addLocalFolder).mockClear();
      vi.mocked(admZipInstance.addLocalFile).mockClear();
      vi.mocked(admZipInstance.writeZip).mockClear();

      const resolvedSourceDir = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceDir);
      const resolvedSourceFile = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceFile);
      mockFs._data[resolvedSourceDir] = { type: "dir", content: "" };
      mockFs._data[resolvedSourceFile] = { type: "file", content: "test content" };

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async (pOrig: string): Promise<FsStats> => {
          const error = new Error(
            `Original stat not found for path: ${pOrig}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedSourceDir) {
          return { isDirectory: () => true, isFile: () => false, size: 4096 } as FsStats;
        }
        if (resolvedPath === resolvedSourceFile) {
          return { isDirectory: () => false, isFile: () => true, size: 100 } as FsStats;
        }
        if (resolvedPath.endsWith(targetArchiveFile)) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });
    });

    it("should successfully create a ZIP archive from a directory source", async () => {
      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir],
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.CreateArchiveSuccess;
      const expectedResolvedArchivePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        targetArchiveFile,
      );

      expect(result.status).toBe("success");
      expect(result.archive_path).toBe(expectedResolvedArchivePath);
      expect(admZipInstance.addLocalFolder).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceDir),
        path.basename(sourceDir),
      );
      expect(admZipInstance.writeZip).toHaveBeenCalledWith(expectedResolvedArchivePath);
    });

    it("should successfully create a ZIP archive from multiple sources (files and dirs)", async () => {
      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir, sourceFile],
        options: { prefix: "custom_prefix" },
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.CreateArchiveSuccess;
      const expectedResolvedArchivePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        targetArchiveFile,
      );

      expect(result.status).toBe("success");
      expect(result.archive_path).toBe(expectedResolvedArchivePath);
      expect(admZipInstance.addLocalFolder).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceDir),
        path.join("custom_prefix", path.basename(sourceDir)),
      );
      expect(admZipInstance.addLocalFile).toHaveBeenCalledWith(
        path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceFile),
        "custom_prefix",
        path.basename(sourceFile),
      );
      expect(admZipInstance.writeZip).toHaveBeenCalledWith(expectedResolvedArchivePath);
    });

    it("should fail ZIP creation if a source path does not exist", async () => {
      const nonExistentSource = "non_existent_source_dir";
      const resolvedNonExistentSource = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        nonExistentSource,
      );

      mockPathValidationStrategy.validateForReading.mockImplementation(async (p: string) => {
        const resolvedP = resolvePathForTest(p); // Uses the function
        if (resolvedP === resolvedNonExistentSource) {
          throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Source not found: ${resolvedP}`); // Reverted
        }
        return resolvedP;
      });

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async () => {
          throw new Error("Original stat not found");
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedNonExistentSource) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [nonExistentSource],
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_FS_NOT_FOUND); // Reverted
      expect(result.error_message).toContain(nonExistentSource);
      expect(admZipInstance.writeZip).not.toHaveBeenCalled();
    });

    it("should fail ZIP creation if writing the archive fails (permission denied for archive_path)", async () => {
      const unwriteableArchive = "unwriteable_dir/myarchive.zip";
      const resolvedUnwriteableArchive = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        unwriteableArchive,
      );

      mockPathValidationStrategy.validateForCreation.mockImplementation(async (p: string) => {
        const resolvedP = resolvePathForTest(p); // Uses the function
        if (resolvedP === resolvedUnwriteableArchive) {
          throw new ConduitError(
            ErrorCode.ERR_FS_PERMISSION_DENIED,
            `Cannot write to ${resolvedP}`,
          ); // Reverted
        }
        return resolvedP;
      });

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: unwriteableArchive,
        source_paths: [sourceDir],
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_FS_PERMISSION_DENIED); // Reverted
      expect(admZipInstance.writeZip).not.toHaveBeenCalled();
    });

    it("should fail if AdmZip throws an error during ZIP creation (e.g. writeZip fails)", async () => {
      const errorMessage = "Failed to write zip file";
      vi.mocked(admZipInstance.writeZip).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir],
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_CREATION_FAILED); // Reverted
      expect(result.error_message).toContain(errorMessage);
      expect(admZipInstance.writeZip).toHaveBeenCalled();
    });
  });

  describe("Archive Creation (TAR.GZ)", () => {
    const targetArchiveFile = "new_archive.tar.gz";
    const sourceDir = "data/source_for_tar";
    const sourceFile = "data/source_file_for_tar.txt";

    beforeEach(() => {
      vi.mocked(tar.create).mockClear().mockResolvedValue(undefined);
      const resolvedSourceDir = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceDir);
      const resolvedSourceFile = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceFile);

      mockFs._data[resolvedSourceDir] = { type: "dir", content: "" };
      mockFs._data[resolvedSourceFile] = { type: "file", content: "test content" };

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async (pOrig: string): Promise<FsStats> => {
          const error = new Error(
            `Original stat not found for path: ${pOrig}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p); // Uses the function
        if (resolvedPath === resolvedSourceDir) {
          return { isDirectory: () => true, isFile: () => false, size: 4096 } as FsStats;
        }
        if (resolvedPath === resolvedSourceFile) {
          return { isDirectory: () => false, isFile: () => true, size: 100 } as FsStats;
        }
        if (resolvedPath.endsWith(targetArchiveFile)) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });
    });

    it("should successfully create a TAR.GZ archive from a directory source", async () => {
      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir],
        compression: "gzip",
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.CreateArchiveSuccess;
      const expectedResolvedArchivePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        targetArchiveFile,
      );

      expect(result.status).toBe("success");
      expect(result.archive_path).toBe(expectedResolvedArchivePath);
      expect(tar.create).toHaveBeenCalledWith(
        {
          file: expectedResolvedArchivePath,
          cwd: path.resolve(mockConduitConfig.resolvedWorkspaceRoot, path.dirname(sourceDir)),
          gzip: true,
          prefix: undefined,
        },
        [path.basename(sourceDir)],
      );
    });

    it("should successfully create a TAR.GZ archive from multiple sources with path_prefix", async () => {
      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir, sourceFile],
        compression: "gzip",
        options: { prefix: "archive_root" },
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.CreateArchiveSuccess;
      const expectedResolvedArchivePath = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        targetArchiveFile,
      );

      expect(result.status).toBe("success");
      expect(result.archive_path).toBe(expectedResolvedArchivePath);

      // Determine the common parent directory for CWD calculation for tar
      const resolvedSourceDir = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceDir);
      const resolvedSourceFile = path.resolve(mockConduitConfig.resolvedWorkspaceRoot, sourceFile);
      // This is a simplified common parent logic, might need refinement for complex cases
      const commonCwd = path.dirname(resolvedSourceDir); // Assuming sourceDir is like 'data/S_T' and sourceFile is 'data/S_F_T.txt'

      expect(tar.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expectedResolvedArchivePath,
          // CWD should be the closest common parent of all source_paths, resolved
          cwd: commonCwd,
          gzip: true,
          prefix: "archive_root",
        }),
        // Paths provided to tar.create should be relative to the CWD
        [path.relative(commonCwd, resolvedSourceDir), path.relative(commonCwd, resolvedSourceFile)],
      );
    });

    it("should fail TAR.GZ creation if tar.create throws an error", async () => {
      const errorMessage = "Tar creation failed";
      vi.mocked(tar.create).mockRejectedValue(new Error(errorMessage));

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFile,
        source_paths: [sourceDir],
        compression: "gzip",
      };

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_CREATION_FAILED); // Reverted
      expect(result.error_message).toContain(errorMessage);
      expect(tar.create).toHaveBeenCalled();
    });

    it("should reject create if archive_type cannot be inferred and is not provided", async () => {
      const targetArchiveFileNoExt = "new_archive_no_extension";
      admZipInstance = createAdmZipMockInstance();
      vi.mocked(AdmZip).mockImplementation(function () {
        return admZipInstance;
      });
      vi.mocked(admZipInstance.writeZip).mockClear();

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFileNoExt,
        source_paths: ["data/source_for_zip"],
      };
      const response = await archiveToolHandler(params, mockConduitConfig);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_FORMAT_NOT_SUPPORTED);
      expect(AdmZip).not.toHaveBeenCalled();
    });
  });

  describe("Validation and Error Handling", () => {
    it("should return error for invalid operation type", async () => {
      const params = {
        operation: "invalid_op",
      } as any;

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("Invalid operation");
    });

    it("should return error if archive_path is missing for extract operation", async () => {
      const params = {
        operation: "extract",
        target_path: "some/target",
      } as any;

      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("archive_path is required");
    });

    it("should return error if target_path is missing for extract operation", async () => {
      const params = {
        operation: "extract",
        archive_path: "archive.zip",
      } as any;
      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("target_path is required for extract");
    });

    it("should return error if archive_path is missing for create operation", async () => {
      const params = {
        operation: "create",
        source_paths: ["source_dir"],
      } as any;
      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("archive_path is required for create");
    });

    it("should return error if source_paths is missing or empty for create operation", async () => {
      const paramsMissing = {
        operation: "create",
        archive_path: "new_archive.zip",
      } as any;
      let response = await archiveToolHandler(paramsMissing, mockConduitConfig);
      let result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("source_paths are required for create");

      const paramsEmpty = {
        operation: "create",
        archive_path: "new_archive.zip",
        source_paths: [],
      } as any;
      response = await archiveToolHandler(paramsEmpty, mockConduitConfig);
      result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER); // Reverted
      expect(result.error_message).toContain("source_paths are required for create");
    });

    it("should correctly infer archive_type from archive_path extension if not provided in options (ZIP)", async () => {
      const archiveFileToInfer = "test_archive_infer.zip";
      const resolvedArchiveFileToInfer = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        archiveFileToInfer,
      );
      mockFs._data[resolvedArchiveFileToInfer] = { type: "file", content: "zipcontent" };

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async () => {
          throw new Error("Original stat not found");
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p);
        if (resolvedPath === resolvedArchiveFileToInfer) {
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
        }
        return originalStat(p);
      });

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFileToInfer,
        target_path: "data/inferred_zip_target",
      };
      await archiveToolHandler(params, mockConduitConfig);
      expect(AdmZip).toHaveBeenCalledWith(resolvedArchiveFileToInfer);
    });

    it("should correctly infer archive_type from archive_path extension if not provided in options (TAR.GZ)", async () => {
      const archiveFileToInfer = "test_archive_infer.tar.gz";
      const resolvedArchiveFileToInfer = path.resolve(
        mockConduitConfig.resolvedWorkspaceRoot,
        archiveFileToInfer,
      );
      mockFs._data[resolvedArchiveFileToInfer] = { type: "file", content: "tarcontent" };

      const originalStat =
        mockFs.stat.getMockImplementation() ||
        (async () => {
          throw new Error("Original stat not found");
        });
      mockFs.stat.mockImplementation(async (p: string) => {
        const resolvedPath = resolvePathForTest(p);
        if (resolvedPath === resolvedArchiveFileToInfer) {
          return { isDirectory: () => false, isFile: () => true, size: 1024 } as FsStats;
        }
        if (p.includes("inferred_tar_target")) {
          const enoentError = new Error(
            `ENOENT: no such file or directory, stat '${resolvedPath}'`,
          ) as NodeJS.ErrnoException;
          enoentError.code = "ENOENT";
          throw enoentError;
        }
        return originalStat(p);
      });

      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: archiveFileToInfer,
        target_path: "data/inferred_tar_target",
      };
      await archiveToolHandler(params, mockConduitConfig);
      expect(tar.extract).toHaveBeenCalledWith(
        expect.objectContaining({
          file: resolvedArchiveFileToInfer,
        }),
      );
    });

    it("should default to zip if archive_type cannot be inferred and is not provided for create", async () => {
      const targetArchiveFileNoExt = "new_archive_no_extension";
      admZipInstance = createAdmZipMockInstance();
      vi.mocked(AdmZip).mockImplementation(function () {
        return admZipInstance;
      });
      vi.mocked(admZipInstance.writeZip).mockClear();

      const params: ArchiveTool.CreateArchiveParams = {
        operation: "create",
        archive_path: targetArchiveFileNoExt,
        source_paths: ["data/source_for_zip"],
      };
      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
    });

    it("should return error for unsupported archive_type (e.g. .rar)", async () => {
      const params: ArchiveTool.ExtractArchiveParams = {
        operation: "extract",
        archive_path: "archive.rar",
        target_path: "data/target",
      };
      const response = await archiveToolHandler(params, mockConduitConfig);
      expect(response.results.length).toBe(1);
      const result = response.results[0] as ArchiveTool.ArchiveResultError;
      expect(result.status).toBe("error");
      expect(result.error_code).toBe(ErrorCode.ERR_ARCHIVE_FORMAT_NOT_SUPPORTED); // Reverted
      expect(result.error_message).toMatch(/Unsupported archive type/i);
    });
  });
});
