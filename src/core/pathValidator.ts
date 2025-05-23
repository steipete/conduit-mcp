import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ConduitError, ErrorCode, conduitConfig, logger } from '@/internal';

/**
 * Core path resolution utilities
 */
export class PathResolver {
  /**
   * Expands tilde (~) in paths to the user's home directory
   */
  static expandTilde(inputPath: string): string {
    if (!inputPath.startsWith('~')) {
      return inputPath;
    }
    
    if (!conduitConfig.allowTildeExpansion) {
      throw new ConduitError(
        ErrorCode.INVALID_PARAMETER,
        'Tilde (~) expansion is not allowed by server configuration.'
      );
    }
    
    return path.join(os.homedir(), inputPath.substring(1));
  }

  /**
   * Converts a path to absolute form, resolving relative paths against workspace root
   */
  static toAbsolute(inputPath: string): string {
    const expandedPath = this.expandTilde(inputPath);
    
    if (path.isAbsolute(expandedPath)) {
      return path.resolve(expandedPath);
    }
    
    return path.resolve(conduitConfig.workspaceRoot, expandedPath);
  }

  /**
   * Resolves symbolic links to get the real path
   */
  static async resolveSymlinks(absolutePath: string): Promise<string> {
    try {
      return await fs.realpath(absolutePath);
    } catch (error: unknown) {
      const nodeError = error as { code?: string };
      if (nodeError.code === 'ENOENT') {
        // Path doesn't exist - return the absolute path
        return absolutePath;
      } else if (nodeError.code === 'ELOOP') {
        throw new ConduitError(
          ErrorCode.ERR_FS_INVALID_PATH,
          `Too many symbolic links encountered while resolving path: ${absolutePath}`
        );
      } else {
        throw new ConduitError(
          ErrorCode.ERR_FS_PATH_RESOLUTION_FAILED,
          `Failed to resolve real path for: ${absolutePath}. ${(error as Error).message}`
        );
      }
    }
  }
}

/**
 * Path permission checking utilities
 */
export class PathPermissionChecker {
  /**
   * Checks if a resolved path is within any of the allowed path prefixes
   */
  static isPathAllowed(resolvedPath: string, allowedPaths: string[]): boolean {
    if (!allowedPaths || allowedPaths.length === 0) {
      return false;
    }
    
    for (const allowedPrefix of allowedPaths) {
      if (resolvedPath.startsWith(allowedPrefix)) {
        if (allowedPrefix.length === resolvedPath.length) return true; // Exact match
        if (resolvedPath[allowedPrefix.length] === path.sep) return true; // Subpath match
      }
    }
    
    return false;
  }

  /**
   * Finds the first allowed ancestor directory for a given path
   */
  static findAllowedAncestor(targetPath: string, allowedPaths: string[]): string | null {
    let currentPath = targetPath;
    
    while (currentPath !== path.dirname(currentPath)) {
      if (this.isPathAllowed(currentPath, allowedPaths)) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }
    
    // Check root directory
    if (this.isPathAllowed(currentPath, allowedPaths)) {
      return currentPath;
    }
    
    return null;
  }
}

/**
 * Path existence utilities
 */
export class PathExistenceChecker {
  /**
   * Checks if a path exists
   */
  static async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures a path exists, throwing an error if required and doesn't exist
   */
  static async ensureExists(path: string, originalPath: string, required: boolean): Promise<void> {
    if (required && !(await this.exists(path))) {
      throw new ConduitError(
        ErrorCode.ERR_FS_NOT_FOUND,
        `Path not found: ${originalPath} (resolved to ${path})`
      );
    }
  }
}

/**
 * High-level path validation strategies
 */
export class PathValidationStrategy {
  /**
   * Validates a path for reading operations (must exist and be allowed)
   */
  static async validateForReading(originalPath: string): Promise<string> {
    // Input validation
    if (!originalPath || typeof originalPath !== 'string' || originalPath.trim() === '') {
      throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
    }

    // Resolve path
    const absolutePath = PathResolver.toAbsolute(originalPath);
    const resolvedPath = await PathResolver.resolveSymlinks(absolutePath);

    // Check permissions
    if (!PathPermissionChecker.isPathAllowed(resolvedPath, conduitConfig.resolvedAllowedPaths)) {
      logger.warn(`[pathValidator] Access denied for reading: ${originalPath} (resolved to ${resolvedPath})`);
      throw new ConduitError(
        ErrorCode.ERR_FS_PERMISSION_DENIED,
        `Access to path is denied: ${originalPath}`
      );
    }

    // Ensure exists
    await PathExistenceChecker.ensureExists(resolvedPath, originalPath, true);

    return resolvedPath;
  }

  /**
   * Validates a path for writing operations (may not exist, but must be allowed or have allowed parent)
   */
  static async validateForWriting(originalPath: string): Promise<string> {
    // Input validation
    if (!originalPath || typeof originalPath !== 'string' || originalPath.trim() === '') {
      throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
    }

    // Resolve path
    const absolutePath = PathResolver.toAbsolute(originalPath);

    // First, check if the target path itself (or any ancestor) is allowed
    const allowedAncestor = PathPermissionChecker.findAllowedAncestor(
      absolutePath, 
      conduitConfig.resolvedAllowedPaths
    );

    if (allowedAncestor) {
      // Target or an ancestor is allowed - this covers the archive extraction case
      return absolutePath;
    }

    // If no allowed ancestor found, deny access
    logger.warn(`[pathValidator] No allowed ancestor found for writing: ${originalPath} (resolved to ${absolutePath})`);
    throw new ConduitError(
      ErrorCode.ERR_FS_PERMISSION_DENIED,
      `Access to path is denied: ${originalPath}`
    );
  }

  /**
   * Validates a path for creation operations (parent must exist and be allowed)
   */
  static async validateForCreation(originalPath: string): Promise<string> {
    // Input validation
    if (!originalPath || typeof originalPath !== 'string' || originalPath.trim() === '') {
      throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
    }

    // Resolve path
    const absolutePath = PathResolver.toAbsolute(originalPath);

    // First, check if the target path itself is allowed (covers extraction to allowed dirs)
    if (PathPermissionChecker.isPathAllowed(absolutePath, conduitConfig.resolvedAllowedPaths)) {
      return absolutePath;
    }

    // Check parent directory
    const parentDir = path.dirname(absolutePath);
    
    // Handle root directory case
    if (parentDir === absolutePath) {
      logger.warn(`[pathValidator] Root directory access denied for creation: ${originalPath}`);
      throw new ConduitError(
        ErrorCode.ERR_FS_PERMISSION_DENIED,
        `Access to root directory is denied: ${originalPath}`
      );
    }

    // Parent directory must exist and be allowed
    let realParentPath: string;
    try {
      realParentPath = await PathResolver.resolveSymlinks(parentDir);
    } catch (error) {
      if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_INVALID_PATH) {
        // Re-throw symlink resolution errors
        throw error;
      }
      // Parent doesn't exist
      logger.warn(`[pathValidator] Parent directory not found for creation: ${parentDir}`);
      throw new ConduitError(
        ErrorCode.ERR_FS_DIR_NOT_FOUND,
        `Parent directory not found for creation: ${originalPath} (parent: ${parentDir})`
      );
    }

    // Ensure parent exists
    if (!(await PathExistenceChecker.exists(realParentPath))) {
      logger.warn(`[pathValidator] Parent directory not found for creation: ${realParentPath}`);
      throw new ConduitError(
        ErrorCode.ERR_FS_DIR_NOT_FOUND,
        `Parent directory not found for creation: ${originalPath} (parent: ${parentDir})`
      );
    }

    // Check if parent is allowed
    if (!PathPermissionChecker.isPathAllowed(realParentPath, conduitConfig.resolvedAllowedPaths)) {
      logger.warn(`[pathValidator] Parent directory access denied for creation: ${originalPath} (parent: ${realParentPath})`);
      throw new ConduitError(
        ErrorCode.ERR_FS_PERMISSION_DENIED,
        `Parent directory access denied for creation: ${originalPath}`
      );
    }

    return absolutePath;
  }

  /**
   * Validates a path without checking permissions (for internal use with checkAllowed: false)
   */
  static async validateWithoutPermissions(originalPath: string, mustExist: boolean = false): Promise<string> {
    // Input validation
    if (!originalPath || typeof originalPath !== 'string' || originalPath.trim() === '') {
      throw new ConduitError(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.');
    }

    // Resolve path
    const absolutePath = PathResolver.toAbsolute(originalPath);
    const resolvedPath = await PathResolver.resolveSymlinks(absolutePath);

    // Check existence if required
    if (mustExist) {
      await PathExistenceChecker.ensureExists(resolvedPath, originalPath, true);
    }

    return resolvedPath;
  }
}

/**
 * Main validation function for backward compatibility
 * @deprecated Use PathValidationStrategy methods directly for clearer intent
 */
export async function validateAndResolvePath(
  originalPath: string,
  options: { 
    isExistenceRequired?: boolean; 
    checkAllowed?: boolean; 
    forCreation?: boolean;
    operationType?: 'read' | 'write' | 'create';
  } = {}
): Promise<string> {
  const { 
    isExistenceRequired = false, 
    checkAllowed = true, 
    forCreation = false,
    operationType
  } = options;

  // Use new strategy-based approach if operationType is specified
  if (operationType) {
    switch (operationType) {
      case 'read':
        return PathValidationStrategy.validateForReading(originalPath);
      case 'write':
        return PathValidationStrategy.validateForWriting(originalPath);
      case 'create':
        return PathValidationStrategy.validateForCreation(originalPath);
    }
  }

  // Legacy behavior for backward compatibility
  if (!checkAllowed) {
    return PathValidationStrategy.validateWithoutPermissions(originalPath, isExistenceRequired);
  }

  if (forCreation) {
    return PathValidationStrategy.validateForCreation(originalPath);
  }

  if (isExistenceRequired) {
    return PathValidationStrategy.validateForReading(originalPath);
  }

  return PathValidationStrategy.validateForWriting(originalPath);
}

// Export the legacy function for backward compatibility
export { isPathAllowed } from './securityHandler'; 