import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import {
  logger,
  ArchiveTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  PathValidationStrategy,
  validateAndResolvePath // Keep for backward compatibility where needed
} from '@/internal';
import { calculateChecksum } from '@/utils/checksum';

const createErrorArchiveResultItem = (
  operation: 'create' | 'extract',
  message: string,
  errorCode: ErrorCode,
  details?: string
): ArchiveTool.ArchiveResultError => ({
  status: 'error',
  error_code: errorCode,
  error_message: details ? `${message} (Details: ${details})` : message,
  operation,
});

export const createArchive = async (
  params: ArchiveTool.CreateArchiveParams,
  _config: ConduitServerConfig
): Promise<ArchiveTool.ArchiveResultItem> => {
  const { archive_path, source_paths, compression, options } = params;

  let absoluteArchivePath: string;
  let resolvedSourcePaths: string[] = [];
  let relativeSourcePathsForTar: string[] = [];

  try {
    // Validate archive path
    absoluteArchivePath = await validateAndResolvePath(archive_path, {
      forCreation: true,
      checkAllowed: true,
    });

    // Validate each source path
    for (const sourcePath of source_paths) {
      const resolvedSourcePath = await validateAndResolvePath(sourcePath, {
        isExistenceRequired: true,
        checkAllowed: true,
      });
      resolvedSourcePaths.push(resolvedSourcePath);

      // Create relative path for tar operations - use basename to preserve directory structure
      const relPath = path.basename(resolvedSourcePath);
      relativeSourcePathsForTar.push(relPath);
    }
  } catch (error: unknown) {
    if (error instanceof ConduitError) {
      return createErrorArchiveResultItem('create', error.message, error.errorCode, error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorArchiveResultItem(
      'create',
      `Path validation failed: ${errorMessage}`,
      ErrorCode.INVALID_PARAMETER
    );
  }

  if ((await fsExtra.pathExists(absoluteArchivePath)) && !options?.overwrite) {
    return createErrorArchiveResultItem(
      'create',
      `Archive already exists at ${archive_path} and overwrite is false.`,
      ErrorCode.RESOURCE_ALREADY_EXISTS,
      `File ${absoluteArchivePath} exists.`
    );
  }

  if (!params.archive_path) {
    return createErrorArchiveResultItem(
      'create',
      'archive_path is required for archive creation.',
      ErrorCode.INVALID_PARAMETER
    );
  }
  if (!source_paths || source_paths.length === 0) {
    return createErrorArchiveResultItem(
      'create',
      'source_paths cannot be empty for archive creation.',
      ErrorCode.ERR_ARCHIVE_NO_SOURCES
    );
  }

  const inferredFormat = archive_path.endsWith('.zip') ? 'zip' : 'tar.gz'; // Or just 'tar' if .gz is separate

  try {
    await fsExtra.ensureDir(path.dirname(absoluteArchivePath));

    if (inferredFormat === 'zip') {
      const zip = new AdmZip();
      for (let i = 0; i < source_paths.length; i++) {
        const absoluteSourcePath = resolvedSourcePaths[i];
        const stats = await fsExtra.stat(absoluteSourcePath);

        if (stats.isDirectory()) {
          const dirBaseName = path.basename(source_paths[i]);
          const entryZipPath = options?.prefix
            ? path.join(options.prefix, dirBaseName)
            : dirBaseName;
          zip.addLocalFolder(absoluteSourcePath, entryZipPath);
        } else {
          const dirInZip = options?.prefix ? options.prefix : '';
          const fileNameInZip = path.basename(source_paths[i]);
          zip.addLocalFile(absoluteSourcePath, dirInZip, fileNameInZip);
        }
      }
      zip.writeZip(absoluteArchivePath);
    } else {
      // Assuming tar.gz or tar
      // Use the parent directory of the first source as the cwd to preserve relative structure
      const firstSourceParent = path.dirname(resolvedSourcePaths[0]);
      const tarOptions: Record<string, unknown> = {
        gzip: compression === 'gzip' || archive_path.endsWith('.gz'), // prefer .gz in name
        file: absoluteArchivePath,
        cwd: firstSourceParent,
        portable: options?.portable ?? true,
        prefix: options?.prefix,
      };

      if (options?.filter_paths && options.filter_paths.length > 0) {
        tarOptions.filter = (entryPath: string) => {
          return options.filter_paths!.some((filterPath: string) => {
            return entryPath.startsWith(filterPath);
          });
        };
      }
      await tar.create(tarOptions, relativeSourcePathsForTar);
    }

    const stats = await fsExtra.stat(absoluteArchivePath);
    const checksum = await calculateChecksum(absoluteArchivePath, 'sha256');

    const successResult: ArchiveTool.CreateArchiveSuccess = {
      status: 'success',
      operation: 'create',
      archive_path,
      format_used: inferredFormat,
      size_bytes: stats.size,
      entries_processed: source_paths.length, // This is count of top-level sources, not all files
      checksum_sha256: checksum,
      compression_used:
        inferredFormat === 'zip'
          ? 'zip'
          : compression === 'gzip' || archive_path.endsWith('.gz')
            ? 'gzip'
            : 'none',
      metadata: params.metadata,
      options_applied: params.options,
      message: `Archive created successfully at ${archive_path}.`,
    };
    return successResult;
  } catch (error: unknown) {
    logger.error(`Error creating archive ${archive_path}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    return createErrorArchiveResultItem(
      'create',
      `Failed to create archive: ${errorMessage}`,
      ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
      errorStack
    );
  }
};

export const extractArchive = async (
  params:
    | ArchiveTool.ExtractArchiveParams
    | (Omit<ArchiveTool.ExtractArchiveParams, 'target_path'> & { destination_path: string }),
  _config: ConduitServerConfig
): Promise<ArchiveTool.ArchiveResultItem> => {
  const { archive_path, options } = params;
  // Support both target_path and destination_path for compatibility
  const target_path =
    'target_path' in params
      ? params.target_path
      : (params as ArchiveTool.ExtractArchiveParams & { destination_path?: string })
          .destination_path;

  let absoluteArchivePath: string;
  let absoluteTargetPath: string;

  try {
    // Validate archive path
    absoluteArchivePath = await validateAndResolvePath(archive_path, {
      isExistenceRequired: true,
      checkAllowed: true,
    });

    // Validate destination path
    absoluteTargetPath = await validateAndResolvePath(target_path || '.', {
      forCreation: true,
      checkAllowed: true,
    });
  } catch (error: unknown) {
    if (error instanceof ConduitError) {
      return createErrorArchiveResultItem('extract', error.message, error.errorCode, error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorArchiveResultItem(
      'extract',
      `Path validation failed: ${errorMessage}`,
      ErrorCode.INVALID_PARAMETER
    );
  }

  try {
    await fsExtra.ensureDir(absoluteTargetPath);

    // Determine the archive format from extension, ignore params.format
    const inferredFormat = archive_path.endsWith('.zip')
      ? 'zip'
      : archive_path.endsWith('.tar.gz') || archive_path.endsWith('.tgz')
        ? 'tar.gz'
        : archive_path.endsWith('.tar')
          ? 'tar'
          : 'unknown';

    if (inferredFormat === 'zip') {
      // Extract zip archive
      const zip = new AdmZip(absoluteArchivePath);

      if (options?.filter_paths && options.filter_paths.length > 0) {
        // Extract only specific files/folders
        const entries = zip.getEntries();
        for (const entry of entries) {
          const isIncluded = options.filter_paths.some((filterPath) =>
            entry.entryName.startsWith(filterPath)
          );

          if (isIncluded) {
            // When filtering, extract the entry to the base target_path.
            // adm-zip will use the entryName to create subdirectories if maintainEntryPath is true.
            zip.extractEntryTo(
              entry,
              absoluteTargetPath,
              /*maintainEntryPath*/ true,
              /*overwrite*/ options?.overwrite ?? true
            );
          }
        }
      } else {
        // Extract all files
        if ((options?.overwrite ?? true) === false) {
          // Check for existing files first if overwrite is false
          const entries = zip.getEntries();
          for (const entry of entries) {
            const entryPath = path.join(absoluteTargetPath, entry.entryName);
            if (await fsExtra.pathExists(entryPath)) {
              throw new Error(`adm-zip: Cannot overwrite file: ${entryPath}`);
            }
          }
        }
        zip.extractAllTo(absoluteTargetPath, options?.overwrite ?? true);
      }
    } else if (inferredFormat === 'tar.gz' || inferredFormat === 'tar') {
      // Extract tar.gz or tar archive
      const tarOptions: Record<string, unknown> = {
        file: absoluteArchivePath,
        cwd: absoluteTargetPath,
        strip: options?.strip_components ?? 0,
      };
      if (options?.filter_paths && options.filter_paths.length > 0) {
        tarOptions.filter = (entryPath: string) => {
          const normalizedEntryPath = entryPath.startsWith('./')
            ? entryPath.substring(2)
            : entryPath;
          return options.filter_paths!.some((filterPath: string) => {
            return normalizedEntryPath.startsWith(filterPath);
          });
        };
      }
      await tar.extract(tarOptions);
    } else {
      return createErrorArchiveResultItem(
        'extract',
        `Unsupported archive format inferred for ${archive_path}. Supported: .zip, .tar, .tar.gz, .tgz`,
        ErrorCode.ERR_ARCHIVE_FORMAT_NOT_SUPPORTED
      );
    }

    // For simplicity, not calculating extracted_files_count precisely here without walking the target_path.
    // This could be added if essential.
    const successResult: ArchiveTool.ExtractArchiveSuccess & { destination_path?: string } = {
      status: 'success',
      operation: 'extract',
      archive_path,
      target_path: target_path || '.',
      destination_path: target_path || '.', // Add for compatibility with scenarios
      format_used: inferredFormat,
      entries_extracted: -1, // Placeholder, actual counting is complex and not implemented
      options_applied: params.options,
      message: `Archive extracted successfully to ${target_path}.`,
    };
    return successResult;
  } catch (error: unknown) {
    logger.error(`Error extracting archive ${archive_path} to ${target_path}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorArchiveResultItem(
      'extract',
      `Failed to extract archive: ${errorMessage}`,
      ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED
    );
  }
};

export const archiveToolHandler = async (
  params: ArchiveTool.Params, // Archive tool parameters
  config: ConduitServerConfig,
  toolName: string = 'ArchiveTool'
): Promise<ArchiveTool.Response> => {
  let resultItem: ArchiveTool.ArchiveResultItem;
  try {
    switch (params.operation) {
      case 'create':
        resultItem = await createArchive(params, config);
        break;
      case 'extract':
        resultItem = await extractArchive(params, config);
        break;
      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = params;
        void _exhaustiveCheck;
        // This code should be unreachable, but handle it gracefully
        resultItem = createErrorArchiveResultItem(
          'create', // Provide a fallback operation
          'Invalid or unsupported archive operation.',
          ErrorCode.UNSUPPORTED_OPERATION,
          `Unexpected operation type in archiveToolHandler.`
        );
        break;
      }
    }
  } catch (error: unknown) {
    logger.error('Unexpected error in archiveToolHandler:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Determine operation from params for error reporting
    const operation = 'operation' in params ? params.operation : 'create';
    resultItem = createErrorArchiveResultItem(
      operation,
      `An unexpected error occurred: ${errorMessage || 'Unknown error'}`,
      ErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.stack : undefined
    );
  }

  return {
    tool_name: toolName as 'ArchiveTool',
    results: [resultItem],
  };
};
