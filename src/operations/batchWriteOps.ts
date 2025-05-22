import {
  WriteTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  fileSystemOps,
  logger,
  validateAndResolvePath,
  putContent,
  makeDirectory,
} from '@/internal';

const operationLogger = logger.child({ component: 'batchWriteOps' });

/**
 * Helper function to create error result items for write operations
 */
function createErrorWriteResultItem(
  action: WriteTool.WriteAction,
  path?: string,
  errorCode?: ErrorCode,
  errorMessage?: string,
  sourcePath?: string,
  destinationPath?: string
): WriteTool.WriteResultItem {
  return {
    status: 'error',
    action_performed: action,
    path: path,
    source_path: sourcePath,
    destination_path: destinationPath,
    error_code: errorCode || ErrorCode.OPERATION_FAILED,
    error_message: errorMessage || 'Unknown error occurred',
  };
}

/**
 * Handles batch put operations with path validation
 */
export async function handleBatchPut(
  params: WriteTool.PutParams,
  config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch put operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'put',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for put operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate path for creation
      const resolvedPath = await validateAndResolvePath(entry.path, {
        forCreation: true,
        checkAllowed: true,
      });

      // Create new entry with resolved path
      const resolvedEntry = { ...entry, path: resolvedPath };
      const result = await putContent(resolvedEntry, config);
      results.push(result);
    } catch (error) {
      operationLogger.warn(`Path validation failed for put entry: ${entry.path}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Path validation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.ERR_FS_INVALID_PATH;

      results.push(createErrorWriteResultItem('put', entry.path, errorCode, errorMessage));
    }
  }

  return { tool_name: 'write', results };
}

/**
 * Handles batch mkdir operations with path validation
 */
export async function handleBatchMkdir(
  params: WriteTool.MkdirParams,
  config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch mkdir operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'mkdir',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for mkdir operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate path for creation
      const resolvedPath = await validateAndResolvePath(entry.path, {
        forCreation: true,
        checkAllowed: true,
      });

      // Create new entry with resolved path
      const resolvedEntry = { ...entry, path: resolvedPath };
      const result = await makeDirectory(resolvedEntry, config);
      results.push(result);
    } catch (error) {
      operationLogger.warn(`Path validation failed for mkdir entry: ${entry.path}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Path validation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.ERR_FS_INVALID_PATH;

      results.push(createErrorWriteResultItem('mkdir', entry.path, errorCode, errorMessage));
    }
  }

  return { tool_name: 'write', results };
}

/**
 * Handles batch copy operations with path validation
 */
export async function handleBatchCopy(
  params: WriteTool.CopyParams,
  _config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch copy operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'copy',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for copy operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate source path (must exist)
      const resolvedSourcePath = await validateAndResolvePath(entry.source_path, {
        isExistenceRequired: true,
        checkAllowed: true,
      });

      // Validate destination path (for creation)
      const resolvedDestinationPath = await validateAndResolvePath(entry.destination_path, {
        forCreation: true,
        checkAllowed: true,
      });

      // Perform copy operation
      await fileSystemOps.copyPath(resolvedSourcePath, resolvedDestinationPath);

      results.push({
        status: 'success',
        action_performed: 'copy',
        source_path: entry.source_path,
        destination_path: entry.destination_path,
        message: 'Copy operation completed successfully.',
      } as WriteTool.WriteResultSuccess);
    } catch (error) {
      operationLogger.warn(
        `Copy operation failed for entry: ${entry.source_path} -> ${entry.destination_path}`,
        error
      );
      const errorMessage = error instanceof Error ? error.message : 'Copy operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      results.push(
        createErrorWriteResultItem(
          'copy',
          undefined,
          errorCode,
          errorMessage,
          entry.source_path,
          entry.destination_path
        )
      );
    }
  }

  return { tool_name: 'write', results };
}

/**
 * Handles batch move operations with path validation
 */
export async function handleBatchMove(
  params: WriteTool.MoveParams,
  _config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch move operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'move',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for move operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate source path (must exist)
      const resolvedSourcePath = await validateAndResolvePath(entry.source_path, {
        isExistenceRequired: true,
        checkAllowed: true,
      });

      // Validate destination path (for creation)
      const resolvedDestinationPath = await validateAndResolvePath(entry.destination_path, {
        forCreation: true,
        checkAllowed: true,
      });

      // Perform move operation
      await fileSystemOps.movePath(resolvedSourcePath, resolvedDestinationPath);

      results.push({
        status: 'success',
        action_performed: 'move',
        source_path: entry.source_path,
        destination_path: entry.destination_path,
        message: 'Move operation completed successfully.',
      } as WriteTool.WriteResultSuccess);
    } catch (error) {
      operationLogger.warn(
        `Move operation failed for entry: ${entry.source_path} -> ${entry.destination_path}`,
        error
      );
      const errorMessage = error instanceof Error ? error.message : 'Move operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      results.push(
        createErrorWriteResultItem(
          'move',
          undefined,
          errorCode,
          errorMessage,
          entry.source_path,
          entry.destination_path
        )
      );
    }
  }

  return { tool_name: 'write', results };
}

/**
 * Handles batch delete operations with path validation
 */
export async function handleBatchDelete(
  params: WriteTool.DeleteParams,
  _config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch delete operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'delete',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for delete operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate path (must exist)
      const resolvedPath = await validateAndResolvePath(entry.path, {
        isExistenceRequired: true,
        checkAllowed: true,
      });

      // Perform delete operation
      const recursive = entry.recursive ?? false;
      await fileSystemOps.deletePath(resolvedPath, recursive);

      results.push({
        status: 'success',
        action_performed: 'delete',
        path: entry.path,
        message: recursive
          ? 'Path and contents deleted successfully.'
          : 'Path deleted successfully.',
      } as WriteTool.WriteResultSuccess);
    } catch (error) {
      operationLogger.warn(`Delete operation failed for entry: ${entry.path}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Delete operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      results.push(createErrorWriteResultItem('delete', entry.path, errorCode, errorMessage));
    }
  }

  return { tool_name: 'write', results };
}

/**
 * Handles batch touch operations with path validation
 */
export async function handleBatchTouch(
  params: WriteTool.TouchParams,
  _config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling batch touch operation with ${params.entries.length} entries`);

  if (!params.entries || params.entries.length === 0) {
    return {
      tool_name: 'write',
      results: [
        createErrorWriteResultItem(
          'touch',
          undefined,
          ErrorCode.INVALID_PARAMETER,
          "'entries' array is missing or empty for touch operation."
        ),
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = [];

  for (const entry of params.entries) {
    try {
      // Validate path for creation
      const resolvedPath = await validateAndResolvePath(entry.path, {
        forCreation: true,
        checkAllowed: true,
      });

      // Perform touch operation
      await fileSystemOps.touchFile(resolvedPath);

      results.push({
        status: 'success',
        action_performed: 'touch',
        path: entry.path,
        message: 'Touch operation completed successfully.',
      } as WriteTool.WriteResultSuccess);
    } catch (error) {
      operationLogger.warn(`Touch operation failed for entry: ${entry.path}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Touch operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      results.push(createErrorWriteResultItem('touch', entry.path, errorCode, errorMessage));
    }
  }

  return { tool_name: 'write', results };
}
