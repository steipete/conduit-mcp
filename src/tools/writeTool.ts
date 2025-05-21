import { conduitConfig } from '@/core/configLoader';
import { validateAndResolvePath, validatePathForCreation } from '@/core/securityHandler';
import * as fsOps from '@/core/fileSystemOps';
import * as archiveOps from '@/operations/archiveOps';
import { makeDirectory } from '@/operations/mkdirOps';
import { WriteTool, ArchiveTool } from '@/types/tools';
import { ConduitError, ErrorCode, createMCPErrorStatus, MCPErrorStatus } from '@/utils/errorHandler';
import logger from '@/utils/logger';

async function handlePutAction(entry: WriteTool.PutEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedPath = validatePathForCreation(entry.path);
  try {
    const writeModeForFsOps = entry.write_mode === 'error_if_exists' ? 'overwrite' : entry.write_mode || 'overwrite';
    if (entry.write_mode === 'error_if_exists' && await fsOps.pathExists(resolvedPath)) {
        return {
            status: 'error',
            action_performed: 'put',
            path: resolvedPath,
            error_code: ErrorCode.ERR_FS_ALREADY_EXISTS,
            error_message: `File already exists at ${resolvedPath} and write_mode is 'error_if_exists'.`
        }
    }
    const bytesWritten = await fsOps.writeFile(resolvedPath, entry.content, entry.input_encoding || 'text', writeModeForFsOps);
    return {
      status: 'success',
      action_performed: 'put',
      path: resolvedPath,
      bytes_written: bytesWritten,
      message: `File ${entry.write_mode === 'append' ? 'appended' : 'written'} successfully.`
    };
  } catch (e: any) {
    logger.error(`Write.put failed for ${entry.path}: ${e.message}`);
    throw e; // Re-throw to be caught by the main batch handler
  }
}

async function handleMkdirAction(entry: WriteTool.MkdirEntry): Promise<WriteTool.WriteResultItem> {
  // Security validation for the path itself is handled by makeDirectory's use of resolve, 
  // and the underlying fs.mkdir will fail if segments are not creatable due to permissions.
  // The main security check (is entry.path within workspaceRoot) is done by makeDirectory.
  try {
    // Call the new makeDirectory function
    // It now takes config, so we need to pass conduitConfig (assuming it's loaded and available)
    return await makeDirectory(entry, conduitConfig);
  } catch (e: any) {
    logger.error(`Write.mkdir failed for ${entry.path}: ${e.message}`);
    // makeDirectory should return a WriteResultItem, so if it throws, it's unexpected.
    // However, to be safe and align with other handlers, we can re-throw or create an error item.
    // For consistency with the pattern in this file, let's re-throw, 
    // and the batch handler will catch it.
    throw e; 
  }
}

async function handleCopyAction(entry: WriteTool.CopyEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedSourcePath = await validateAndResolvePath(entry.source_path, {isExistenceRequired: true});
  // For destination, if it's a directory, it must exist and be allowed.
  // If it's a file path (new or existing), its parent must be allowed for creation.
  // fsOps.copyPath internally handles if dest is dir (copies into) or file (overwrites/creates)
  const resolvedDestPath = validatePathForCreation(entry.destination_path); 
  try {
    await fsOps.copyPath(resolvedSourcePath, resolvedDestPath);
    return {
      status: 'success',
      action_performed: 'copy',
      source_path: resolvedSourcePath,
      destination_path: resolvedDestPath, // Or the final path if copied into a dir
      message: 'Path copied successfully.'
    };
  } catch (e: any) {
    logger.error(`Write.copy failed for ${entry.source_path} to ${entry.destination_path}: ${e.message}`);
    throw e;
  }
}

async function handleMoveAction(entry: WriteTool.MoveEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedSourcePath = await validateAndResolvePath(entry.source_path, {isExistenceRequired: true});
  const resolvedDestPath = validatePathForCreation(entry.destination_path); // Validates dest parent is allowed
  try {
    await fsOps.movePath(resolvedSourcePath, resolvedDestPath);
    return {
      status: 'success',
      action_performed: 'move',
      source_path: resolvedSourcePath,
      destination_path: resolvedDestPath, // fsOps.movePath handles if dest is dir
      message: 'Path moved successfully.'
    };
  } catch (e: any) {
    logger.error(`Write.move failed for ${entry.source_path} to ${entry.destination_path}: ${e.message}`);
    throw e;
  }
}

async function handleDeleteAction(entry: WriteTool.DeleteEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedPath = await validateAndResolvePath(entry.path, {isExistenceRequired: false}); // Don't fail if not found, delete is idempotent for non-existence
  try {
    await fsOps.deletePath(resolvedPath, entry.recursive || false);
    return {
      status: 'success',
      action_performed: 'delete',
      path: resolvedPath,
      message: 'Path deleted successfully.'
    };
  } catch (e: any) {
    logger.error(`Write.delete failed for ${entry.path}: ${e.message}`);
    throw e;
  }
}

async function handleTouchAction(entry: WriteTool.TouchEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedPath = validatePathForCreation(entry.path);
  try {
    await fsOps.touchFile(resolvedPath);
    return {
      status: 'success',
      action_performed: 'touch',
      path: resolvedPath,
      message: 'File touched successfully.'
    };
  } catch (e: any) {
    logger.error(`Write.touch failed for ${entry.path}: ${e.message}`);
    throw e;
  }
}

async function handleBatchActions(params: WriteTool.BaseBatchParams): Promise<WriteTool.BatchResponse> {
  const results: WriteTool.WriteResultItem[] = [];
  if (!params.entries || params.entries.length === 0) {
    throw new ConduitError(ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH, `'entries' array cannot be missing or empty for action '${params.action}'.`);
  }

  for (const entry of params.entries) {
    let baseResultInfo: { path?: string, source_path?: string, destination_path?: string } = {};
    if ('path' in entry) baseResultInfo.path = entry.path;
    if ('source_path' in entry) baseResultInfo.source_path = entry.source_path;
    if ('destination_path' in entry) baseResultInfo.destination_path = entry.destination_path;

    try {
      let result: WriteTool.WriteResultItem;
      switch (params.action) {
        case 'put':
          result = await handlePutAction(entry as WriteTool.PutEntry);
          break;
        case 'mkdir':
          result = await handleMkdirAction(entry as WriteTool.MkdirEntry);
          break;
        case 'copy':
          result = await handleCopyAction(entry as WriteTool.CopyEntry);
          break;
        case 'move':
          result = await handleMoveAction(entry as WriteTool.MoveEntry);
          break;
        case 'delete':
          result = await handleDeleteAction(entry as WriteTool.DeleteEntry);
          break;
        case 'touch':
          result = await handleTouchAction(entry as WriteTool.TouchEntry);
          break;
        default:
          // Should be caught by main handler's switch, but good for safety
          throw new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION, `Unknown batch action: ${params.action}`);
      }
      results.push(result);
    } catch (error: any) {
        logger.error(`Write batch action '${params.action}' failed for entry ${JSON.stringify(baseResultInfo)}: ${error.message}`);
        results.push({
            action_performed: params.action,
            ...baseResultInfo, // Add original path info for context
            ...(error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, error.message))
        } as WriteTool.WriteResultItem); // Type assertion needed here due to complex baseResultInfo
    }
  }
  return results;
}

async function handleArchiveAction(params: WriteTool.ArchiveParams): Promise<WriteTool.ArchiveActionResponse> {
    try {
        // Pass conduitConfig to archiveOps functions
        const archiveResult = await archiveOps.createArchive(params as unknown as ArchiveTool.CreateArchiveParams, conduitConfig);

        if (archiveResult.status === 'success') {
            const successResult = archiveResult as ArchiveTool.CreateArchiveSuccess;
            return {
                status: 'success',
                action_performed: 'archive',
                path: successResult.archive_path,
                message: successResult.message || 'Archive created successfully.',
                // skipped_sources: successResult.skipped_sources, // CreateArchiveSuccess from ArchiveTool doesn't have skipped_sources directly, it might be part of a general message or logged.
                                                                // Let's assume for WriteTool.WriteResultSuccess, skipped_sources is optional.
            } as WriteTool.WriteResultSuccess;
        } else {
            const errorResult = archiveResult as ArchiveTool.ArchiveResultError;
            return {
                status: 'error',
                error_code: errorResult.error_code,
                error_message: errorResult.error_message,
                action_performed: 'archive', // From BaseResult part of WriteTool.WriteResultItem
                path: params.archive_path, // From BaseResult part of WriteTool.WriteResultItem
            } as WriteTool.WriteResultItem; // This will be MCPErrorStatus & BaseResult
        }
    } catch (error: any) {
        logger.error(`Write.archive failed for ${params.archive_path}: ${error.message}`);
        // Fallback for unexpected errors from archiveOps.createArchive itself (not returned error objects)
        return {
            status: 'error',
            error_code: ErrorCode.ERR_ARCHIVE_CREATION_FAILED,
            error_message: error.message || 'Failed to create archive due to an unexpected error.',
            action_performed: 'archive',
            path: params.archive_path,
        } as WriteTool.WriteResultItem;
    }
}

async function handleUnarchiveAction(params: WriteTool.UnarchiveParams): Promise<WriteTool.ArchiveActionResponse> {
    try {
        // Pass conduitConfig to archiveOps functions
        const unarchiveResult = await archiveOps.extractArchive(params as unknown as ArchiveTool.ExtractArchiveParams, conduitConfig);

        if (unarchiveResult.status === 'success') {
            const successResult = unarchiveResult as ArchiveTool.ExtractArchiveSuccess;
            return {
                status: 'success',
                action_performed: 'unarchive',
                path: successResult.archive_path,
                destination_path: successResult.target_path,
                message: successResult.message || 'Archive extracted successfully.',
                extracted_files_count: successResult.extracted_files_count,
            } as WriteTool.WriteResultSuccess;
        } else {
            const errorResult = unarchiveResult as ArchiveTool.ArchiveResultError;
            return {
                status: 'error',
                error_code: errorResult.error_code,
                error_message: errorResult.error_message,
                action_performed: 'unarchive',
                path: params.archive_path,
                destination_path: params.destination_path,
            } as WriteTool.WriteResultItem;
        }
    } catch (error: any) {
        logger.error(`Write.unarchive failed for ${params.archive_path} to ${params.destination_path}: ${error.message}`);
        return {
            status: 'error',
            error_code: ErrorCode.ERR_ARCHIVE_EXTRACTION_FAILED,
            error_message: error.message || 'Failed to extract archive due to an unexpected error.',
            action_performed: 'unarchive',
            path: params.archive_path,
            destination_path: params.destination_path,
        } as WriteTool.WriteResultItem;
    }
}

export async function handleWriteTool(params: WriteTool.Parameters): Promise<WriteTool.BatchResponse | WriteTool.ArchiveActionResponse> {
  if (!params || !params.action) {
    throw new ConduitError(ErrorCode.INVALID_PARAMETER, "Missing 'action' parameter for write tool.");
  }

  switch (params.action) {
    case 'put':
    case 'mkdir':
    case 'copy':
    case 'move':
    case 'delete':
    case 'touch':
      return handleBatchActions(params as WriteTool.BaseBatchParams);
    case 'archive':
      return handleArchiveAction(params as WriteTool.ArchiveParams);
    case 'unarchive':
      return handleUnarchiveAction(params as WriteTool.UnarchiveParams);
    default:
      // @ts-expect-error - params should be narrowed by the switch
      throw new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION, `Unknown action '${params.action}' for write tool.`);
  }
} 