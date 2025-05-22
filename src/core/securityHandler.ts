import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises'; // Using fs.promises for lstat, readlink
import { ConduitError, ErrorCode, conduitConfig, logger, fileSystemOps } from '@/internal';

/**
 * Checks if a given resolved path is within the list of allowed path prefixes.
 */
export function isPathAllowed(resolvedPath: string, allowedPaths: string[]): boolean {
  if (!allowedPaths || allowedPaths.length === 0) {
    return false; // No paths are allowed if the list is empty or undefined
  }
  for (const allowedPrefix of allowedPaths) {
    // Ensure both paths are consistently formatted (e.g., trailing slashes) for comparison if necessary,
    // but startsWith should handle it if allowedPrefix is a directory prefix.
    // Make sure comparison is case-sensitive or insensitive based on OS norms if critical, though absolute paths usually are specific.
    if (resolvedPath.startsWith(allowedPrefix)) {
      if (allowedPrefix.length === resolvedPath.length) return true; // Exact match
      if (resolvedPath[allowedPrefix.length] === path.sep) return true; // Subpath match
    }
  }
  return false;
}

/**
 * Resolves a given file path, including tilde (~) expansion and symbolic link resolution,
 * and optionally checks if it exists and is within allowed paths.
 *
 * @param originalPath The initial path string from user input.
 * @param options Options for validation:
 *   - isExistenceRequired: If true, throws ERR_FS_NOT_FOUND if path doesn't exist.
 *   - checkAllowed: If true (default), checks if the final real path is within conduitConfig.resolvedAllowedPaths.
 *   - forCreation: If true (default false), validates parent directory for creation operations.
 * @returns The fully resolved, absolute path.
 * @throws ConduitError for access denied, path not found, or too many symlinks.
 */
export async function validateAndResolvePath(
  originalPath: string,
  options: { isExistenceRequired?: boolean; checkAllowed?: boolean; forCreation?: boolean } = {}
): Promise<string> {
  const { isExistenceRequired = false, checkAllowed = true, forCreation = false } = options;

  // Input validation
  if (!originalPath || typeof originalPath !== 'string' || originalPath.trim() === '') {
    throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
  }

  let currentPath = originalPath;

  // 1. Tilde expansion
  if (currentPath.startsWith('~')) {
    if (conduitConfig.allowTildeExpansion !== true) {
      throw new ConduitError(
        ErrorCode.INVALID_PARAMETER,
        'Tilde (~) expansion is not allowed by server configuration.'
      );
    }
    currentPath = path.join(os.homedir(), currentPath.substring(1));
  }

  // 2. Resolve to absolute path (preliminary)
  if (!path.isAbsolute(currentPath)) {
    currentPath = path.resolve(conduitConfig.workspaceRoot, currentPath);
  } else {
    currentPath = path.resolve(currentPath); // Normalizes an already absolute path
  }

  // Store the target absolute path for creation operations
  const targetAbsolutePath = currentPath;

  // 3. Handle creation vs. existing path validation
  if (forCreation) {
    // For creation operations, validate the parent directory
    const parentDir = path.dirname(targetAbsolutePath);

    // Parent directory must exist and be resolved via realpath
    let realParentPath: string;
    try {
      realParentPath = await fs.realpath(parentDir);
    } catch (e: unknown) {
      const nodeError = e as { code?: string };
      if (nodeError.code === 'ENOENT') {
        logger.warn(`[securityHandler] Parent directory not found for creation: ${parentDir}`);
        throw new ConduitError(
          ErrorCode.ERR_FS_DIR_NOT_FOUND,
          `Parent directory not found for creation: ${originalPath} (parent: ${parentDir})`
        );
      } else if (nodeError.code === 'ELOOP') {
        logger.error(
          `[securityHandler] Too many symbolic links in parent for ${parentDir}: ${(e as Error).message}`
        );
        throw new ConduitError(
          ErrorCode.ERR_FS_INVALID_PATH,
          `Too many symbolic links encountered in parent directory: ${originalPath}.`
        );
      } else {
        logger.error(
          `[securityHandler] Error resolving parent directory ${parentDir}: ${(e as Error).message}`
        );
        throw new ConduitError(
          ErrorCode.ERR_FS_INVALID_PATH,
          `Failed to resolve parent directory for creation: ${originalPath}. ${(e as Error).message}`
        );
      }
    }

    // Check if parent directory is allowed
    if (checkAllowed && !isPathAllowed(realParentPath, conduitConfig.resolvedAllowedPaths)) {
      logger.warn(
        `[securityHandler] Parent directory access denied for creation: ${originalPath} (parent: ${realParentPath})`
      );
      throw new ConduitError(
        ErrorCode.ERR_FS_PERMISSION_DENIED,
        `Parent directory access denied for creation: ${originalPath}`
      );
    }

    // Return the target absolute path (not the parent)
    return targetAbsolutePath;
  } else {
    // For existing path validation (original behavior)
    const effectiveIsExistenceRequired = isExistenceRequired;
    let realPath = currentPath;

    try {
      // Symlink resolution and canonicalization to a real path
      realPath = await fs.realpath(currentPath);
    } catch (e: unknown) {
      const nodeError = e as { code?: string };
      if (nodeError.code === 'ENOENT') {
        if (effectiveIsExistenceRequired) {
          logger.warn(`[securityHandler] Path not found (realpath check): ${currentPath}`);
          throw new ConduitError(
            ErrorCode.ERR_FS_NOT_FOUND,
            `Path not found: ${originalPath} (resolved to ${currentPath})`
          );
        }
        // If existence is not required, use the resolved path for allowance check
        realPath = currentPath;
      } else if (nodeError.code === 'ELOOP') {
        logger.error(
          `[securityHandler] Too many symbolic links for ${currentPath}: ${(e as Error).message}`
        );
        throw new ConduitError(
          ErrorCode.ERR_FS_INVALID_PATH,
          `Too many symbolic links encountered while resolving path: ${originalPath}.`
        );
      } else {
        logger.error(
          `[securityHandler] Error during fs.realpath for ${currentPath}: ${(e as Error).message}`
        );
        throw new ConduitError(
          ErrorCode.ERR_FS_PATH_RESOLUTION_FAILED,
          `Failed to resolve real path for: ${originalPath}. ${(e as Error).message}`
        );
      }
    }

    // Check if allowed (if checkAllowed is true)
    if (checkAllowed) {
      const pathToVerify = (await fs.stat(realPath).catch(() => null)) ? realPath : currentPath;

      if (!isPathAllowed(pathToVerify, conduitConfig.resolvedAllowedPaths)) {
        logger.warn(
          `[securityHandler] Access denied for path: ${originalPath} (resolved to ${pathToVerify})`
        );
        throw new ConduitError(
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Access to path is denied: ${originalPath}`
        );
      }
    }

    // Final existence check if required
    if (effectiveIsExistenceRequired && !(await fileSystemOps.pathExists(realPath))) {
      logger.warn(`[securityHandler] Path not found (final check): ${realPath}`);
      throw new ConduitError(
        ErrorCode.ERR_FS_NOT_FOUND,
        `Path not found: ${originalPath} (resolved to ${realPath})`
      );
    }

    return realPath;
  }
}
