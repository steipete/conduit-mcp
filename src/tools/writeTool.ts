import { conduitConfig } from '@/core/configLoader';
import { validateAndResolvePath, validatePathForCreation } from '@/core/securityHandler';
import * as fsOps from '@/core/fileSystemOps';
import * as archiveOps from '@/operations/archiveOps';
import { WriteTool } from '@/types/tools';
import { ConduitError, ErrorCode, createMCPErrorStatus } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import { MCPErrorStatus } from '@/types/common';

async function handlePutAction(entry: WriteTool.PutEntry): Promise<WriteTool.WriteResultItem> {
  const resolvedPath = validatePathForCreation(entry.path);
  try {
    const bytesWritten = await fsOps.writeFile(resolvedPath, entry.content, entry.input_encoding || 'text', entry.write_mode || 'overwrite');
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
  const resolvedPath = validatePathForCreation(entry.path);
  try {
    await fsOps.createDirectory(resolvedPath, entry.recursive || false);
    return {
      status: 'success',
      action_performed: 'mkdir',
      path: resolvedPath,
      message: 'Directory created successfully.'
    };
  } catch (e: any) {
    logger.error(`Write.mkdir failed for ${entry.path}: ${e.message}`);
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
        const { skipped_sources } = await archiveOps.createArchive(params);
        return {
            status: 'success',
            action_performed: 'archive',
            path: params.archive_path,
            message: 'Archive created successfully.',
            skipped_sources
        } as WriteTool.WriteResultSuccess;
    } catch (error: any) {
        logger.error(`Write.archive failed for ${params.archive_path}: ${error.message}`);
        return (error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_ARCHIVE_CREATION_FAILED, error.message)) as MCPErrorStatus;
    }
}

async function handleUnarchiveAction(params: WriteTool.UnarchiveParams): Promise<WriteTool.ArchiveActionResponse> {
    try {
        const { extracted_files_count } = await archiveOps.extractArchive(params);
        return {
            status: 'success',
            action_performed: 'unarchive',
            path: params.archive_path,
            destination_path: params.destination_path,
            message: 'Archive extracted successfully.',
            extracted_files_count
        } as WriteTool.WriteResultSuccess;
    } catch (error: any) {
        logger.error(`Write.unarchive failed for ${params.archive_path} to ${params.destination_path}: ${error.message}`);
        return (error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_UNARCHIVE_FAILED, error.message)) as MCPErrorStatus;
    }
}

export async function handleWriteTool(params: WriteTool.Parameters): Promise<WriteTool.BatchResponse | WriteTool.ArchiveActionResponse> {
  if (!params || !params.action) {
    throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing 'action' parameter for write tool.");
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