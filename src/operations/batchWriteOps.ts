import * as path from 'path';
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
      let resolvedPath: string;

      // For PUT operations, we need to handle cases where parent directories don't exist yet
      // Try the normal validation first, but fall back to path-only validation if parent doesn't exist
      try {
        resolvedPath = await validateAndResolvePath(entry.path, {
          forCreation: true,
          checkAllowed: true,
        });
      } catch (error) {
        if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_DIR_NOT_FOUND) {
          // Parent directory doesn't exist, but that's OK for PUT since we create it
          // Just validate that the path is within allowed bounds
          resolvedPath = await validateAndResolvePath(entry.path, {
            forCreation: false,
            checkAllowed: true,
          });
        } else {
          throw error;
        }
      }

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
      let resolvedPath: string;

      if (entry.recursive) {
        // For recursive mkdir, validate that at least some parent in the chain is allowed
        // We'll find the highest existing parent directory and validate that
        let currentPath = entry.path;
        let foundExistingParent = false;

        while (currentPath !== path.dirname(currentPath)) {
          const parentPath = path.dirname(currentPath);
          try {
            await validateAndResolvePath(parentPath, {
              isExistenceRequired: true,
              checkAllowed: true,
            });
            // Found an existing parent that's allowed
            foundExistingParent = true;
            break;
          } catch {
            // Parent doesn't exist or isn't allowed, try the next level up
            currentPath = parentPath;
          }
        }

        if (!foundExistingParent) {
          // No valid parent found, validate without forCreation to check basic path allowance
          resolvedPath = await validateAndResolvePath(entry.path, {
            forCreation: false,
            checkAllowed: true,
          });
        } else {
          // Just resolve the path without strict parent validation
          resolvedPath = path.resolve(config.workspaceRoot, entry.path);
        }
      } else {
        // For non-recursive mkdir, parent must exist
        resolvedPath = await validateAndResolvePath(entry.path, {
          forCreation: true,
          checkAllowed: true,
        });
      }

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

      // Check source stats
      const sourceStats = await fileSystemOps.getStats(resolvedSourcePath);

      // Check if destination exists
      const destinationExists = await fileSystemOps.pathExists(resolvedDestinationPath);
      const overwrite = entry.overwrite ?? true; // Default to true for backward compatibility

      if (destinationExists && !overwrite) {
        // Issue #1: When overwrite is false and destination exists, return error
        results.push(
          createErrorWriteResultItem(
            'copy',
            undefined,
            ErrorCode.ERR_FS_DESTINATION_EXISTS,
            `Destination path ${entry.destination_path} already exists and overwrite is false.`,
            entry.source_path,
            entry.destination_path
          )
        );
        continue;
      }

      if (destinationExists) {
        const destStats = await fileSystemOps.getStats(resolvedDestinationPath);

        // Issue #2: When copying a file onto an existing directory path without trailing slash
        if (
          sourceStats.isFile() &&
          destStats.isDirectory() &&
          !entry.destination_path.endsWith('/')
        ) {
          results.push(
            createErrorWriteResultItem(
              'copy',
              undefined,
              ErrorCode.ERR_FS_COPY_TARGET_IS_DIR,
              `Cannot copy file ${entry.source_path} onto directory ${entry.destination_path}. To copy into a directory, ensure the destination path ends with a slash or is explicitly identified as a directory target.`,
              entry.source_path,
              entry.destination_path
            )
          );
          continue;
        }
      }

      // Perform copy operation
      try {
        await fileSystemOps.copyPath(resolvedSourcePath, resolvedDestinationPath);
      } catch (error) {
        if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_COPY_FAILED) {
          // Clean up the error message for directory-to-file conflicts
          const errorMessage = error.message;
          if (
            errorMessage.includes('cannot overwrite non-directory') &&
            errorMessage.includes('with directory')
          ) {
            // Extract the clean part from the parenthetical comment
            const match = errorMessage.match(
              /\(cannot overwrite non-directory (.+) with directory (.+)\)/
            );
            if (match) {
              const [, destPath, srcPath] = match;
              throw new ConduitError(
                ErrorCode.ERR_FS_COPY_FAILED,
                `Failed to copy path: Cannot overwrite non-directory ${destPath} with directory ${srcPath}`
              );
            }
          }
        }
        throw error;
      }

      // Determine the actual destination path for the response
      let actualDestinationPath = entry.destination_path;
      if (destinationExists) {
        const destStats = await fileSystemOps.getStats(resolvedDestinationPath);
        if (destStats.isDirectory() && entry.destination_path.endsWith('/')) {
          // When copying into a directory, show the actual final path
          actualDestinationPath = path.join(
            entry.destination_path,
            path.basename(entry.source_path)
          );
        }
      }

      results.push({
        status: 'success',
        action_performed: 'copy',
        source_path: entry.source_path,
        destination_path: actualDestinationPath,
        message: 'Path copied successfully.',
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

      // Check source stats
      const sourceStats = await fileSystemOps.getStats(resolvedSourcePath);

      // Check if destination exists
      const destinationExists = await fileSystemOps.pathExists(resolvedDestinationPath);
      const overwrite = entry.overwrite ?? true; // Default to true for backward compatibility

      if (destinationExists && !overwrite) {
        // Issue #1: When overwrite is false and destination exists, return error
        results.push(
          createErrorWriteResultItem(
            'move',
            undefined,
            ErrorCode.ERR_FS_DESTINATION_EXISTS,
            `Destination path ${entry.destination_path} already exists and overwrite is false.`,
            entry.source_path,
            entry.destination_path
          )
        );
        continue;
      }

      if (destinationExists) {
        const destStats = await fileSystemOps.getStats(resolvedDestinationPath);

        // Issue #2: When moving a directory onto an existing file path
        if (sourceStats.isDirectory() && destStats.isFile()) {
          results.push(
            createErrorWriteResultItem(
              'move',
              undefined,
              ErrorCode.ERR_FS_MOVE_FAILED,
              `Failed to move path: Cannot overwrite non-directory ${entry.destination_path} with directory ${entry.source_path}`,
              entry.source_path,
              entry.destination_path
            )
          );
          continue;
        }

        // Issue #3: When moving a file onto an existing directory path without trailing slash
        if (
          sourceStats.isFile() &&
          destStats.isDirectory() &&
          !entry.destination_path.endsWith('/')
        ) {
          results.push(
            createErrorWriteResultItem(
              'move',
              undefined,
              ErrorCode.ERR_FS_MOVE_TARGET_IS_DIR,
              `Cannot move file ${entry.source_path} onto directory ${entry.destination_path}. To move into a directory, ensure the destination path ends with a slash.`,
              entry.source_path,
              entry.destination_path
            )
          );
          continue;
        }
      }

      // Perform move operation
      await fileSystemOps.movePath(resolvedSourcePath, resolvedDestinationPath);

      // Determine the actual destination path for the response
      let actualDestinationPath = entry.destination_path;
      if (destinationExists) {
        const destStats = await fileSystemOps.getStats(resolvedDestinationPath);
        if (destStats.isDirectory() && entry.destination_path.endsWith('/')) {
          // When moving into a directory, show the actual final path
          actualDestinationPath = path.join(
            entry.destination_path,
            path.basename(entry.source_path)
          );
        }
      }

      results.push({
        status: 'success',
        action_performed: 'move',
        source_path: entry.source_path,
        destination_path: actualDestinationPath,
        message: 'Path moved successfully.',
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
  config: ConduitServerConfig
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
      let errorMessage = error instanceof Error ? error.message : 'Delete operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      // Provide more specific error message for deletion permission denied
      if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_PERMISSION_DENIED) {
        const allowedPathsStr = config.allowedPaths.join(', ');
        errorMessage = `Access to path ${entry.path} for deletion is denied. It is not within the allowed paths defined by CONDUIT_ALLOWED_PATHS (currently: ${allowedPathsStr}). You might need to adjust CONDUIT_ALLOWED_PATHS environment variable or the server configuration.`;
      }

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
  config: ConduitServerConfig
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
      let errorMessage = error instanceof Error ? error.message : 'Touch operation failed';
      const errorCode =
        error instanceof ConduitError ? error.errorCode : ErrorCode.OPERATION_FAILED;

      // Provide more specific error message for touch permission denied
      if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_PERMISSION_DENIED) {
        const allowedPathsStr = config.allowedPaths.join(', ');
        errorMessage = `Access to path ${entry.path} for creation is denied. It is not within the allowed paths defined by CONDUIT_ALLOWED_PATHS (currently: ${allowedPathsStr}). You might need to adjust CONDUIT_ALLOWED_PATHS environment variable or the server configuration.`;
      }

      results.push(createErrorWriteResultItem('touch', entry.path, errorCode, errorMessage));
    }
  }

  return { tool_name: 'write', results };
}
