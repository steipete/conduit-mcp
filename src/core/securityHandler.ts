import fs from 'fs/promises';
import path from 'path';
import { configLoader, ConduitError, ErrorCode } from '@/internal';
import logger from '@/utils/logger';

/**
 * Resolves a given user path to its absolute, real path, checking for symlinks.
 * @param userPath The path provided by the user.
 * @returns The absolute, real path.
 * @throws ConduitError if path resolution fails or symlink resolution fails.
 */
async function resolveToRealPath(userPath: string): Promise<string> {
  try {
    let resolvedPath = path.resolve(userPath);
    // Check for symlinks iteratively to handle nested symlinks.
    // Max iterations to prevent infinite loops with circular symlinks (though fs.realpath should handle this).
    for (let i = 0; i < 10; i++) { 
      const stats = await fs.lstat(resolvedPath);
      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(resolvedPath);
        resolvedPath = path.resolve(path.dirname(resolvedPath), linkTarget);
      } else {
        // Not a symlink, or fs.realpath will handle it from here
        break;
      }
    }
    // Final resolution with fs.realpath to get the canonical path
    return await fs.realpath(resolvedPath);
  } catch (err: any) {
    logger.debug(`Path resolution or realpath failed for ${userPath}: ${err.message}`);
    if (err.code === 'ENOENT') {
      // If the error is ENOENT, it means some part of the path doesn't exist.
      // We might still want to proceed with the initial absolute resolution for validation if the operation
      // is one that creates files/dirs (e.g. write, mkdir). The checkAccess function will handle this.
      // For now, we throw an error indicating resolution failure, as fs.realpath requires path existence.
      // The caller (validateAndResolvePath) can decide if a non-existent path is permissible for certain ops.
      throw new ConduitError(ErrorCode.ERR_FS_PATH_RESOLUTION_FAILED, `Failed to resolve path to its real form: ${userPath}. Path or component may not exist.`);
    }
    throw new ConduitError(ErrorCode.ERR_FS_PATH_RESOLUTION_FAILED, `Failed to resolve path to its real form: ${userPath}. Error: ${err.message}`);
  }
}

/**
 * Checks if a given absolute, real path is within any of the configured allowed directories.
 * @param realPath The absolute, real path to check.
 * @returns True if the path is within allowed directories, false otherwise.
 */
function isPathWithinAllowedDirs(realPath: string): boolean {
  if (configLoader.conduitConfig.allowedPaths.length === 0) {
    logger.warn('No allowed paths configured. Denying all filesystem access.');
    return false;
  }
  return configLoader.conduitConfig.allowedPaths.some(allowedDir => {
    const relative = path.relative(allowedDir, realPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

/**
 * Validates a user-provided path against allowed directories and resolves symlinks.
 * Throws an error if access is denied.
 * @param userPath The path provided by the user.
 * @param Ctx Additional context, e.g. if the path is expected to exist or not.
 *            `isExistenceRequired`: if true, will throw ERR_FS_NOT_FOUND if path doesn't resolve to an existing entity.
 *                                   if false, resolution will try its best, and then permission check is based on this resolved path.
 *                                   Useful for write operations where the file might not exist yet.
 * @returns The validated, absolute, real path if access is permitted and path exists (if required).
 *          Or the absolute path (not necessarily real path if not existent) if access is permitted and existence is not required.
 * @throws ConduitError if path is outside allowed scope or resolution fails when existence is required.
 */
export async function validateAndResolvePath(userPath: string, { isExistenceRequired = true }: { isExistenceRequired?: boolean } = {}): Promise<string> {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
  }

  let resolvedPathForCheck: string;
  let realPath: string | undefined = undefined;

  try {
    realPath = await resolveToRealPath(userPath);
    resolvedPathForCheck = realPath;
  } catch (error: any) {
    if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_PATH_RESOLUTION_FAILED) {
      if (isExistenceRequired) {
        // If existence is required and resolveToRealPath failed (e.g. ENOENT), rethrow.
        throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Path not found or could not be resolved: ${userPath}`);
      }
      // If not required to exist, try to get an absolute path for permission check, even if not fully real.
      // This is for cases like writing to a new file in an allowed directory.
      resolvedPathForCheck = path.resolve(userPath);
      logger.debug(`Path ${userPath} does not exist, but existence not required. Validating access for its resolved form: ${resolvedPathForCheck}`);
    } else {
      // Some other error during resolveToRealPath
      throw error;
    }
  }

  if (!isPathWithinAllowedDirs(resolvedPathForCheck)) {
    logger.warn(`Access denied for path: ${userPath} (resolved to: ${resolvedPathForCheck}). Not within allowed paths: ${configLoader.conduitConfig.allowedPaths.join(', ')}`);
    throw new ConduitError(ErrorCode.ERR_FS_PERMISSION_DENIED, `Access to path '${userPath}' is denied. It is outside the configured allowed directories.`);
  }
  
  logger.debug(`Path validation successful for: ${userPath} (resolved to: ${resolvedPathForCheck})`);
  // If existence was required, realPath must be defined here from the successful try block.
  // If not required, return the checked path (which might be just resolved, not real if new).
  return realPath || resolvedPathForCheck; 
}

/**
 * A simpler validation function that ensures a path, once resolved to its absolute form
 * (without necessarily requiring it to exist or fully resolving symlinks if not existing),
 * falls within the allowed directories. This is useful for operations that might create
 * the target, like `write.put` or `mkdir`, where the final segment might not exist yet.
 *
 * @param userPath The path provided by the user.
 * @returns The absolute path if validation passes.
 * @throws ConduitError if the path is outside the allowed scope.
 */
export function validatePathForCreation(userPath: string): string {
    if (typeof userPath !== 'string' || userPath.trim() === '') {
        throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
    }

    const absolutePath = path.resolve(userPath);

    if (!isPathWithinAllowedDirs(absolutePath)) {
        logger.warn(`Access denied for creation path: ${userPath} (resolved to: ${absolutePath}). Not within allowed paths: ${configLoader.conduitConfig.allowedPaths.join(', ')}`);
        throw new ConduitError(ErrorCode.ERR_FS_PERMISSION_DENIED, `Access to path '${userPath}' for creation is denied. It is outside the configured allowed directories.`);
    }
    
    logger.debug(`Path validation for creation successful for: ${userPath} (resolved to: ${absolutePath})`);
    return absolutePath;
} 