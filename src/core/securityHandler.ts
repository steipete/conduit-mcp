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
 * @param ursprünglicherPfad The initial path string from user input.
 * @param options Options for validation:
 *   - isExistenceRequired: If true, throws ERR_FS_NOT_FOUND if path doesn't exist.
 *   - checkAllowed: If true (default), checks if the final real path is within conduitConfig.resolvedAllowedPaths.
 * @returns The fully resolved, absolute, real path.
 * @throws ConduitError for access denied, path not found, or too many symlinks.
 */
export async function validateAndResolvePath(
  originalPath: string,
  options: { isExistenceRequired?: boolean; checkAllowed?: boolean } = {}
): Promise<string> {
  const { isExistenceRequired = false, checkAllowed = true } = options;
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
  // Note: path.resolve can handle a lot, but symlinks need specific handling later.
  // We use workspaceRoot as the base for resolving relative paths if originalPath is not absolute.
  // If originalPath IS absolute, path.resolve(config.workspaceRoot, originalPath) might behave unexpectedly if originalPath is like /foo.
  // path.resolve will process segments from right to left. If an absolute path is encountered (like originalPath), it stops processing further left.
  // If originalPath is relative, it prepends current working dir. For server context, better to use workspaceRoot explicitly.
  if (!path.isAbsolute(currentPath)) {
    currentPath = path.resolve(conduitConfig.workspaceRoot, currentPath);
  } else {
    currentPath = path.resolve(currentPath); // Normalizes an already absolute path (e.g. removes trailing slashes)
  }

  // 3. Symlink resolution and canonicalization to a real path
  let realPath = currentPath;
  try {
    // Before checking existence or symlinks, normalize to catch `.` `..` etc.
    realPath = await fs.realpath(currentPath);
  } catch (e: unknown) {
    // fs.realpath throws ENOENT if any part of the path doesn't exist.
    const nodeError = e as { code?: string };
    if (nodeError.code === 'ENOENT') {
      if (isExistenceRequired) {
        logger.warn(`[securityHandler] Path not found (realpath check): ${currentPath}`);
        throw new ConduitError(
          ErrorCode.ERR_FS_NOT_FOUND,
          `Path not found: ${originalPath} (resolved to ${currentPath})`
        );
      }
      // If existence is not required, we use the path.resolve() version and proceed to allowance check if enabled.
      // This covers cases like writing to a new file in an allowed directory.
      // However, the allowance check should ideally be on a path that *could* exist.
      // For creating new files, parent directory must be allowed. fs.realpath fails here.
      // If realpath fails due to non-existence, and existence is NOT required (e.g. writeFile target):
      // We must still check the *intended* absolute path against allowed paths.
      // realPath here is the path.resolve() version. We continue with this for the checkAllowed logic.
      // If we are *creating* something, the realpath up to the parent should exist and be allowed.
      // This simple `realPath = currentPath` after ENOENT from `fs.realpath` is okay if `checkAllowed` uses `currentPath`.
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
    // If realpath succeeded, realPath is now the canonical, absolute path with symlinks resolved.
  }

  // 4. Check if allowed (if checkAllowed is true)
  if (checkAllowed) {
    // If realpath failed due to ENOENT and existence wasn't required, we check the path.resolved `currentPath`.
    // Otherwise, we check the `realPath` obtained from `fs.realpath()`.
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

  // 5. Final existence check if required (and not already thrown by fs.realpath)
  // This is somewhat redundant if fs.realpath succeeded, as that implies existence.
  // But if fs.realpath threw ENOENT and isExistenceRequired was false, we might reach here.
  // However, current logic means if isExistenceRequired is true and realpath threw ENOENT, we've already thrown.
  // This check is more for the case where realpath didn't run (e.g. future modification) or to be absolutely sure.
  if (isExistenceRequired && !(await fileSystemOps.pathExists(realPath))) {
    logger.warn(`[securityHandler] Path not found (final check): ${realPath}`);
    throw new ConduitError(
      ErrorCode.ERR_FS_NOT_FOUND,
      `Path not found: ${originalPath} (resolved to ${realPath})`
    );
  }

  return realPath; // Return the canonical, absolute, real path
}
