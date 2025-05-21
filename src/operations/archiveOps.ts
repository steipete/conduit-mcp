import * as tar from 'tar';
import * as fs from 'fs-extra';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ArchiveTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, logger } from '@/internal';
import { calculateChecksum } from '@/utils/checksum';

const createErrorArchiveResultItem = (
  operation: 'create' | 'extract',
  message: string,
  errorCode: ErrorCode,
  details?: string,
): ArchiveTool.ArchiveResultError => ({
  status: 'error',
  error_code: errorCode,
  error_message: details ? `${message} (Details: ${details})` : message,
  operation,
});

export const createArchive = async (
  params: ArchiveTool.CreateArchiveParams,
  config: ConduitServerConfig,
): Promise<ArchiveTool.ArchiveResultItem> => {
  const { archive_path, source_paths, compression, metadata, options } = params;
  const { workspaceRoot } = config;

  const absoluteArchivePath = path.resolve(workspaceRoot, archive_path);
  const relativeSourcePathsForTar = source_paths.map((p: string) => {
    const absPath = path.resolve(workspaceRoot, p);
    const relPath = path.relative(workspaceRoot, absPath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
        throw new ConduitError(ErrorCode.INVALID_PARAMETER, `Source path ${p} is outside the workspace root or invalid.`);
    }
    return relPath;
  });

  if (await fs.pathExists(absoluteArchivePath) && !(options?.overwrite)) {
    return createErrorArchiveResultItem(
      'create',
      `Archive already exists at ${archive_path} and overwrite is false.`,
      ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
      `File ${absoluteArchivePath} exists.`,
    );
  }

  if (!params.archive_path) {
    return createErrorArchiveResultItem('create', 'archive_path is required for archive creation.', ErrorCode.INVALID_PARAMETER);
  }
  if (!source_paths || source_paths.length === 0) {
    return createErrorArchiveResultItem('create', 'source_paths cannot be empty for archive creation.', ErrorCode.ERR_ARCHIVE_NO_SOURCES);
  }

  const inferredFormat = archive_path.endsWith('.zip') ? 'zip' : 'tar.gz'; // Or just 'tar' if .gz is separate

  try {
    await fs.ensureDir(path.dirname(absoluteArchivePath));

    if (inferredFormat === 'zip') {
      const zip = new AdmZip();
      for (const sourcePath of source_paths) {
        const absoluteSourcePath = path.resolve(workspaceRoot, sourcePath);
        const stats = await fs.stat(absoluteSourcePath);
        
        const entryZipPath = options?.prefix ? path.join(options.prefix, path.basename(sourcePath)) : path.basename(sourcePath);
        if (stats.isDirectory()) {
          zip.addLocalFolder(absoluteSourcePath, entryZipPath);
        } else {
          const dirInZip = options?.prefix ? options.prefix : '';
          const fileNameInZip = path.basename(sourcePath);
          const finalEntryPath = path.join(dirInZip, fileNameInZip);
          zip.addLocalFile(absoluteSourcePath, dirInZip, fileNameInZip);
        }
      }
      zip.writeZip(absoluteArchivePath);
    } else { // Assuming tar.gz or tar
      const tarOptions: tar.CreateOptions & tar.FileOptions = {
        gzip: compression === 'gzip' || archive_path.endsWith('.gz'), // prefer .gz in name
        file: absoluteArchivePath,
        cwd: workspaceRoot,
        portable: options?.portable ?? true,
        prefix: options?.prefix,
      };
      
      if (options?.filter_paths && options.filter_paths.length > 0) {
        tarOptions.filter = (entryPath: string, stat: fs.Stats) => { 
          return options.filter_paths!.some((filterPath: string) => {
            return entryPath.startsWith(filterPath);
          });
        };
      }
      await tar.create(tarOptions, relativeSourcePathsForTar);
    }

    const stats = await fs.stat(absoluteArchivePath);
    const checksum = await calculateChecksum(absoluteArchivePath, 'sha256');

    const successResult: ArchiveTool.CreateArchiveSuccess = {
      status: 'success',
      operation: 'create',
      archive_path,
      format_used: inferredFormat,
      size_bytes: stats.size,
      entries_processed: source_paths.length, // This is count of top-level sources, not all files
      checksum_sha256: checksum,
      compression_used: inferredFormat === 'zip' ? 'zip' : (compression === 'gzip' || archive_path.endsWith('.gz') ? 'gzip' : 'none'),
      metadata: params.metadata,
    };
    return successResult;
  } catch (error: any) {
    logger.error(`Error creating archive ${archive_path}:`, error);
    return createErrorArchiveResultItem(
      'create',
      `Failed to create archive: ${error.message}`,
      ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
      error.stack,
    );
  }
};

export const extractArchive = async (
  params: ArchiveTool.ExtractArchiveParams,
  config: ConduitServerConfig,
): Promise<ArchiveTool.ArchiveResultItem> => {
  const { archive_path, target_path, options } = params;
  const { workspaceRoot } = config;

  const absoluteArchivePath = path.resolve(workspaceRoot, archive_path);
  const absoluteTargetPath = path.resolve(workspaceRoot, target_path);

  if (!(await fs.pathExists(absoluteArchivePath))) {
    return createErrorArchiveResultItem(
      'extract',
      `Archive not found at ${archive_path}.`,
      ErrorCode.ERR_ARCHIVE_NOT_FOUND,
      `File ${absoluteArchivePath} does not exist.`,
    );
  }

  try {
    await fs.ensureDir(absoluteTargetPath);

    // Determine the archive format from extension, ignore params.format
    const inferredFormat = archive_path.endsWith('.zip') ? 'zip' 
                        : (archive_path.endsWith('.tar.gz') || archive_path.endsWith('.tgz')) ? 'tar.gz' 
                        : archive_path.endsWith('.tar') ? 'tar' 
                        : 'unknown';

    if (inferredFormat === 'zip') {
      // Extract zip archive
      const zip = new AdmZip(absoluteArchivePath);
      
      if (options?.filter_paths && options.filter_paths.length > 0) {
        // Extract only specific files/folders
        const entries = zip.getEntries();
        for (const entry of entries) {
          const isIncluded = options.filter_paths.some(filterPath => 
            entry.entryName.startsWith(filterPath));
          
          if (isIncluded) {
            // When filtering, extract the entry to the base target_path.
            // adm-zip will use the entryName to create subdirectories if maintainEntryPath is true.
            zip.extractEntryTo(entry, absoluteTargetPath, /*maintainEntryPath*/true, /*overwrite*/options?.overwrite ?? true);
          }
        }
      } else {
        // Extract all files
        zip.extractAllTo(absoluteTargetPath, options?.overwrite ?? true);
      }
    } else if (inferredFormat === 'tar.gz' || inferredFormat === 'tar') {
      // Extract tar.gz or tar archive
      const tarOptions: tar.ExtractOptions & tar.FileOptions = {
        file: absoluteArchivePath,
        cwd: absoluteTargetPath,
        strip: options?.strip_components ?? 0,
      };
      if (options?.filter_paths && options.filter_paths.length > 0) {
        tarOptions.filter = (entryPath: string, stat: tar.FileStat) => { 
          const normalizedEntryPath = entryPath.startsWith('./') ? entryPath.substring(2) : entryPath;
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
    const successResult: ArchiveTool.ExtractArchiveSuccess = {
      status: 'success',
      operation: 'extract',
      archive_path,
      target_path,
      format_used: inferredFormat,
      entries_extracted: -1, // Placeholder, actual counting is complex and not implemented
      options_applied: params.options,
    };
    return successResult;
  } catch (error: any) {
    logger.error(`Error extracting archive ${archive_path} to ${target_path}:`, error);
    return createErrorArchiveResultItem(
      'extract',
      `Failed to extract archive: ${error.message}`,
      ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED,
      error.stack,
    );
  }
};

export const archiveToolHandler = async (
  params: ArchiveTool.Params,
  config: ConduitServerConfig,
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
      default:
        const exhaustiveCheck: never = params;
        logger.error('Unhandled archive operation:', exhaustiveCheck);
        resultItem = createErrorArchiveResultItem(
          (params as any).operation || 'unknown_operation_type', // Provide a fallback string
          'Invalid or unsupported archive operation.',
          ErrorCode.UNSUPPORTED_OPERATION,
          `Operation type '${(params as any).operation}' is not supported by archiveToolHandler.`,
        );
        break;
    }
  } catch (error: any) {
    logger.error('Unexpected error in archiveToolHandler:', error);
    const operation = (params as any)?.operation || 'unknown';
    resultItem = createErrorArchiveResultItem(
      operation as 'create' | 'extract',
      `An unexpected error occurred: ${error.message || 'Unknown error'}`,
      ErrorCode.INTERNAL_ERROR,
      error.stack,
    );
  }

  return {
    tool_name: 'ArchiveTool',
    results: [resultItem],
  };
};