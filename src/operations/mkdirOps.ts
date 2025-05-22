import * as path from 'path';
import {
  WriteTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  fileSystemOps,
  logger,
} from '@/internal';

function createErrorMkdirResultItem(
  path: string | undefined,
  errorCode: ErrorCode,
  errorMessage: string
): WriteTool.WriteResultItem {
  return {
    status: 'error',
    action_performed: 'mkdir',
    path: path || 'unknown_path',
    error_code: errorCode,
    error_message: errorMessage,
  };
}

export async function makeDirectory(
  entry: WriteTool.MkdirEntry,
  config: ConduitServerConfig
): Promise<WriteTool.WriteResultItem> {
  const operationLogger = logger.child({ component: 'mkdirOps' });
  operationLogger.info(`Processing mkdir for target: ${entry.path}`);

  if (!entry.path) {
    return createErrorMkdirResultItem(
      entry.path /*undefined*/,
      ErrorCode.INVALID_PARAMETER,
      'path is required for mkdir.'
    );
  }

  const absoluteTargetPath = path.resolve(config.workspaceRoot, entry.path);
  const recursive = entry.recursive ?? false;

  try {
    const pathExists = await fileSystemOps.pathExists(absoluteTargetPath);

    if (pathExists) {
      const stats = await fileSystemOps.getStats(absoluteTargetPath);
      if (stats.isDirectory()) {
        // Idempotent: Directory already exists
        operationLogger.debug(`Directory ${absoluteTargetPath} already exists.`);
        return {
          status: 'success',
          action_performed: 'mkdir',
          path: entry.path,
          message: 'Directory already exists.',
        } as WriteTool.WriteResultSuccess;
      } else {
        // Path exists but is a file
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.ERR_FS_PATH_IS_FILE,
          `Path exists but is a file, not a directory: ${entry.path}`
        );
      }
    }

    // Path does not exist, create it.
    // fileSystemOps.ensureDirectoryExists handles recursive creation if underlying fs-extra.ensureDir is used.
    // The 'recursive' flag from MkdirEntry is thus implicitly handled if ensureDirectoryExists is always recursive.
    // If strict non-recursive behavior is needed when entry.recursive is false, this needs adjustment.
    // For now, assuming ensureDirectoryExists is suitable.
    await fileSystemOps.ensureDirectoryExists(absoluteTargetPath);
    operationLogger.info(`Successfully created directory: ${absoluteTargetPath}`);

    return {
      status: 'success',
      action_performed: 'mkdir',
      path: entry.path,
      message: recursive
        ? 'Directory and any necessary parent directories created.'
        : 'Directory created.',
    } as WriteTool.WriteResultSuccess;
  } catch (error: unknown) {
    operationLogger.error(`Error in makeDirectory for ${entry.path}:`, error);
    if (error instanceof ConduitError) {
      // Handle specific ConduitErrors more granularly if needed
      if (error.errorCode === ErrorCode.ACCESS_DENIED) {
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Permission denied for path: ${entry.path}`
        );
      }
      // A component of the path prefix is not a directory, or other fs errors
      if (
        error.errorCode === ErrorCode.ERR_FS_NOT_FOUND ||
        (error.message &&
          (error.message.includes('ENOTDIR') || error.message.includes('Not a directory')))
      ) {
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.ERR_FS_PATH_IS_FILE,
          `A component of the path prefix is not a directory: ${entry.path}`
        );
      }
      return createErrorMkdirResultItem(entry.path, error.errorCode, error.message);
    }
    // Handle common fs errors specifically
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Permission denied for path: ${entry.path}`
        );
      }
      if (error.code === 'EEXIST') {
        // Should be caught by pathExists check, but as a safeguard
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Path already exists (unexpectedly): ${entry.path}`
        );
      }
      if (error.code === 'ENOTDIR') {
        return createErrorMkdirResultItem(
          entry.path,
          ErrorCode.ERR_FS_PATH_IS_FILE,
          `A component of the path prefix is not a directory: ${entry.path}`
        );
      }
    }
    // Generic fallback
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createErrorMkdirResultItem(
      entry.path,
      ErrorCode.OPERATION_FAILED,
      `Failed to create directory ${entry.path}: ${errorMessage}`
    );
  }
}
