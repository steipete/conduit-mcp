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
  const absoluteSourcePaths = source_paths.map((p: string) => path.resolve(workspaceRoot, p));

  if (await fs.pathExists(absoluteArchivePath) && !options?.overwrite) {
    return createErrorArchiveResultItem(
      'create',
      `Archive already exists at ${archive_path} and overwrite is false.`,
      ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
      `File ${absoluteArchivePath} exists.`,
    );
  }

  if (!params.archive_path) {
    return createErrorArchiveResultItem('create', 'archive_path is required for archive creation.', ErrorCode.ERR_INVALID_PARAMETER);
  }

  // Default format is zip as per spec
  const archiveFormat = params.format || 'zip';
  const recursiveSourceListing = params.recursive_source_listing !== undefined ? params.recursive_source_listing : true;

  const resolvedArchiveParentDir = path.dirname(path.resolve(config.workspaceRoot, params.archive_path));

  try {
    await fs.ensureDir(path.dirname(absoluteArchivePath));

    if (archiveFormat === 'zip') {
      // Create zip archive using adm-zip
      const zip = new AdmZip();
      
      for (const sourcePath of absoluteSourcePaths) {
        const relativePath = path.relative(workspaceRoot, sourcePath);
        const sourceStats = await fs.stat(sourcePath);
        
        if (sourceStats.isDirectory()) {
          // Add directory and its contents
          const files = await fs.readdir(sourcePath, { withFileTypes: true });
          for (const file of files) {
            const fullPath = path.join(sourcePath, file.name);
            const entryPath = path.join(relativePath, file.name);
            
            if (file.isDirectory() && recursiveSourceListing) {
              zip.addLocalFolder(fullPath, entryPath);
            } else if (file.isFile()) {
              if (options?.filter_paths && options.filter_paths.length > 0) {
                // Apply filter if configured
                const isIncluded = options.filter_paths.some(filterPath => {
                  const absoluteFilterPath = path.resolve(workspaceRoot, filterPath);
                  return fullPath === absoluteFilterPath || fullPath.startsWith(absoluteFilterPath);
                });
                
                if (isIncluded) {
                  zip.addLocalFile(fullPath, path.dirname(entryPath));
                }
              } else {
                zip.addLocalFile(fullPath, path.dirname(entryPath));
              }
            }
          }
        } else {
          // Add individual file
          zip.addLocalFile(sourcePath, options?.prefix ? options.prefix : '');
        }
      }
      
      // Write the zip file
      zip.writeZip(absoluteArchivePath);
    } else if (archiveFormat === 'tar.gz') {
      // Use tar.js for tar.gz format
      const tarOptions: tar.CreateOptions & { sync?: boolean } = {
        gzip: compression === 'gzip',
        file: absoluteArchivePath,
        cwd: workspaceRoot,
        portable: options?.portable ?? true,
        prefix: options?.prefix,
      };
      
      if (options?.filter_paths && options.filter_paths.length > 0) {
        tarOptions.filter = (entryPath: string, stat: fs.Stats) => {
          return options.filter_paths!.some((filterPath: string) => {
            const absoluteFilterPath = path.resolve(workspaceRoot, filterPath);
            const absoluteEntryPath = path.resolve(workspaceRoot, entryPath);
            if (stat.isDirectory()) {
              return absoluteEntryPath.startsWith(absoluteFilterPath);
            }
            return absoluteEntryPath === absoluteFilterPath || path.dirname(absoluteEntryPath).startsWith(absoluteFilterPath);
          });
        };
      }

      await tar.create(tarOptions as any, absoluteSourcePaths.map((p: string) => path.relative(workspaceRoot, p)));
    } else {
      return createErrorArchiveResultItem(
        'create',
        `Unsupported archive format: ${archiveFormat}`,
        ErrorCode.ERR_INVALID_PARAMETER
      );
    }

    const stats = await fs.stat(absoluteArchivePath);
    const checksum = await calculateChecksum(absoluteArchivePath, 'sha256');

    const successResult: ArchiveTool.CreateArchiveSuccess = {
      status: 'success',
      operation: 'create',
      archive_path,
      size_bytes: stats.size,
      checksum_sha256: checksum,
      source_paths_count: source_paths.length,
      compression,
      metadata,
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

    // Determine the archive format
    const archiveFormat = params.format || (archive_path.endsWith('.zip') ? 'zip' : 'tar.gz');

    if (archiveFormat === 'zip') {
      // Extract zip archive
      const zip = new AdmZip(absoluteArchivePath);
      
      if (options?.filter_paths && options.filter_paths.length > 0) {
        // Extract only specific files/folders
        const entries = zip.getEntries();
        for (const entry of entries) {
          const isIncluded = options.filter_paths.some(filterPath => 
            entry.entryName.startsWith(filterPath));
          
          if (isIncluded) {
            if (entry.isDirectory) {
              await fs.ensureDir(path.join(absoluteTargetPath, entry.entryName));
            } else {
              zip.extractEntryTo(entry, absoluteTargetPath, false, true);
            }
          }
        }
      } else {
        // Extract all files
        zip.extractAllTo(absoluteTargetPath, true);
      }
    } else if (archiveFormat === 'tar.gz') {
      // Extract tar.gz archive
      const tarOptions: tar.ExtractOptions & { sync?: boolean } = {
        file: absoluteArchivePath,
        cwd: absoluteTargetPath,
        strip: options?.strip_components,
        filter: options?.filter_paths && options.filter_paths.length > 0
          ? (entryPath: string) => options.filter_paths!.some((p: string) => entryPath.startsWith(p))
          : undefined,
        newer: options?.keep_newer_files,
        preserveOwner: options?.preserve_owner ?? false,
      };

      await tar.extract(tarOptions as any);
    } else {
      return createErrorArchiveResultItem(
        'extract',
        `Unsupported archive format: ${archiveFormat}`,
        ErrorCode.ERR_INVALID_PARAMETER
      );
    }

    const extractedFiles = await fs.readdir(absoluteTargetPath);

    const successResult: ArchiveTool.ExtractArchiveSuccess = {
      status: 'success',
      operation: 'extract',
      archive_path,
      target_path,
      extracted_files_count: extractedFiles.length,
      options,
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
          (params as any).operation as any,
          'Invalid or unsupported archive operation.',
          ErrorCode.ERR_INVALID_PARAMS,
          `Operation ${(params as any).operation} is not supported.`,
        );
        break;
    }
  } catch (error: any) {
    logger.error('Unexpected error in archiveToolHandler:', error);
    const operation = (params as any)?.operation || 'unknown';
    resultItem = createErrorArchiveResultItem(
      operation as 'create' | 'extract',
      `An unexpected error occurred: ${error.message || 'Unknown error'}`,
      ErrorCode.ERR_INTERNAL_SERVER_ERROR,
      error.stack,
    );
  }

  return {
    tool_name: 'ArchiveTool',
    results: [resultItem],
  };
};