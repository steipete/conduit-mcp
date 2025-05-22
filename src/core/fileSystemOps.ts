import fs from 'fs/promises';
import type { Stats } from 'fs';
import path from 'path';
import { constants as fsConstants } from 'fs';
import { conduitConfig, ConduitError, ErrorCode, createMCPErrorStatus, logger, EntryInfo, formatToISO8601UTC, getMimeType } from '@/internal';
import * as fsExtra from 'fs-extra';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { glob } from 'glob';
import checkDiskSpace from 'check-disk-space';

/**
 * Checks if a path exists.
 * @param filePath Path to check.
 * @returns True if path exists, false otherwise.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Gets fs.Stats for a path. Throws ConduitError if path not found or other access issues.
 */
export async function getStats(filePath: string): Promise<Stats> {
  try {
    return await fs.stat(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Path not found: ${filePath}`);
    }
    throw new ConduitError(ErrorCode.OPERATION_FAILED, `Failed to get stats for path: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Gets fs.Stats for a path using lstat (does not follow symlinks).
 * Throws ConduitError if path not found or other access issues.
 */
export async function getLstats(filePath: string): Promise<Stats> {
  try {
    return await fs.lstat(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Path not found: ${filePath}`);
    }
    throw new ConduitError(ErrorCode.OPERATION_FAILED, `Failed to get lstats for path: ${filePath}. Error: ${error.message}`);
  }
}


/**
 * Reads a file's content as a UTF-8 string.
 * @param filePath Path to the file.
 * @param maxLength Optional max length to read.
 * @returns File content as string.
 * @throws ConduitError on failure (e.g., not found, access denied, exceeds limit).
 */
export async function readFileAsString(filePath: string, maxLength: number = conduitConfig.maxFileReadBytes): Promise<string> {
  try {
    const stats = await getStats(filePath);
    if (stats.isDirectory()) {
      throw new ConduitError(ErrorCode.ERR_FS_PATH_IS_DIR, `Expected a file but found a directory at ${filePath}`);
    }
    if (stats.size > maxLength) {
      throw new ConduitError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, `File size ${stats.size} bytes exceeds maximum allowed read limit of ${maxLength} bytes for ${filePath}.`);
    }
    return await fs.readFile(filePath, { encoding: 'utf8' });
  } catch (error: any) {
    if (error instanceof ConduitError || (error && typeof error.errorCode === 'string' && Object.values(ErrorCode).includes(error.errorCode as ErrorCode))) throw error;
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `File not found: ${filePath}`);
    }
    logger.error(`Error reading file ${filePath} as string: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_READ_FAILED, `Failed to read file: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Reads a file's content as a Buffer.
 * @param filePath Path to the file.
 * @param maxLength Optional max length to read.
 * @returns File content as Buffer.
 * @throws ConduitError on failure.
 */
export async function readFileAsBuffer(filePath: string, maxLength: number = conduitConfig.maxFileReadBytes): Promise<Buffer> {
  try {
    const stats = await getStats(filePath);
    if (stats.isDirectory()) {
      throw new ConduitError(ErrorCode.ERR_FS_PATH_IS_DIR, `Expected a file but found a directory at ${filePath}`);
    }
    if (stats.size > maxLength) {
      throw new ConduitError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, `File size ${stats.size} bytes exceeds maximum allowed read limit of ${maxLength} bytes for ${filePath}.`);
    }
    return await fs.readFile(filePath);
  } catch (error: any) {
    if (error instanceof ConduitError || (error && typeof error.errorCode === 'string' && Object.values(ErrorCode).includes(error.errorCode as ErrorCode))) throw error;
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `File not found: ${filePath}`);
    }
    logger.error(`Error reading file ${filePath} as buffer: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_READ_FAILED, `Failed to read file: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Writes content to a file.
 * @param filePath Path to the file.
 * @param content Content to write (string or Buffer).
 * @param encoding For string content, the input encoding (text or base64).
 * @param mode Write mode (overwrite or append).
 * @returns Number of bytes written.
 */
export async function writeFile(filePath: string, content: string | Buffer, encoding: 'text' | 'base64' = 'text', mode: 'overwrite' | 'append' = 'overwrite'): Promise<number> {
  try {
    let bufferContent: Buffer;
    if (typeof content === 'string') {
      bufferContent = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    } else {
      bufferContent = content;
    }

    if (bufferContent.length > conduitConfig.maxFileReadBytes) { // Using maxFileReadBytes as a proxy for max write size
        throw new ConduitError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, `Content size ${bufferContent.length} bytes exceeds maximum allowed write limit of ${conduitConfig.maxFileReadBytes} bytes for ${filePath}.`);
    }

    if (mode === 'append') {
      await fs.appendFile(filePath, bufferContent);
    } else {
      await fs.writeFile(filePath, bufferContent);
    }
    return bufferContent.length;
  } catch (error: any) {
    if (error instanceof ConduitError || (error && typeof error.errorCode === 'string' && Object.values(ErrorCode).includes(error.errorCode as ErrorCode))) {
      throw error;
    }
    logger.error(`Error writing file ${filePath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_WRITE_FAILED, `Failed to write file: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Creates a directory.
 * @param dirPath Path to the directory.
 * @param recursive If true, create parent directories if they don't exist.
 */
export async function createDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive });
  } catch (error: any) {
    if (error.code === 'EEXIST') { // Idempotent: directory already exists
      logger.debug(`Directory already exists (idempotent success): ${dirPath}`);
      return;
    }
    logger.error(`Error creating directory ${dirPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_DIR_CREATE_FAILED, `Failed to create directory: ${dirPath}. Error: ${error.message}`);
  }
}

/**
 * Deletes a file or directory.
 * @param itemPath Path to the file or directory.
 * @param recursive Must be true to delete a non-empty directory.
 */
export async function deletePath(itemPath: string, recursive: boolean = false): Promise<void> {
  try {
    const stats = await getLstats(itemPath); // Use lstat to avoid following symlinks before deletion
    if (stats.isDirectory()) {
      await fs.rm(itemPath, { recursive, force: recursive }); // force helps with some permission issues on Windows if recursive
    } else {
      await fs.unlink(itemPath);
    }
  } catch (error: any) {
    if (error && typeof error.errorCode === 'string' && error.errorCode === ErrorCode.ERR_FS_NOT_FOUND) {
        logger.debug(`Path not found for deletion (considered success): ${itemPath}`);
        return;
    } else if (error && typeof error.errorCode === 'string') { // Other ConduitError-like errors
        throw error;
    }

    // Fallback for raw ENOENT (less likely now due to getLstats)
    if (error.code === 'ENOENT') { 
        logger.debug(`Path not found for deletion (considered success, raw ENOENT): ${itemPath}`);
        return;
    }
    
    logger.error(`Error deleting path ${itemPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_DELETE_FAILED, `Failed to delete path: ${itemPath}. Error: ${error.message}`);
}
}

/**
 * Lists entries in a directory.
 * @param dirPath Path to the directory.
 * @returns Array of entry names (strings).
 */
export async function listDirectory(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_DIR_NOT_FOUND, `Directory not found: ${dirPath}`);
    }
    if (error.code === 'ENOTDIR') {
        throw new ConduitError(ErrorCode.ERR_FS_PATH_IS_FILE, `Path is a file, not a directory: ${dirPath}`);
    }
    logger.error(`Error listing directory ${dirPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_DIR_LIST_FAILED, `Failed to list directory: ${dirPath}. Error: ${error.message}`);
  }
}

/**
 * Copies a file or directory.
 * @param sourcePath Source path.
 * @param destinationPath Destination path.
 */
export async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    const stats = await getStats(sourcePath);
    if (stats.isDirectory()) {
      // For copying directories, fs.cp with recursive: true will copy contents into destinationPath if it's a directory,
      // or create destinationPath as a directory. Overwriting of individual files within is controlled by `force`.
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: true }); // Added force: true
    } else {
      let finalDest = destinationPath;
      try {
        const destStats = await getStats(destinationPath);
        if (destStats.isDirectory()) {
          finalDest = path.join(destinationPath, path.basename(sourcePath));
        }
      } catch (destStatError: any) {
        // Ignore if destinationPath doesn't exist or isn't a directory, fs.cp will handle creating it.
      }
      // For copying files, fs.cp with force: true will overwrite if finalDest is an existing file.
      await fs.cp(sourcePath, finalDest, { recursive: false, force: true }); // Added force: true
    }
  } catch (error: any) {
    logger.debug(`copyPath caught error. typeof error: ${typeof error}, error: ${JSON.stringify(error)}, errorCode: ${error?.errorCode}, code: ${error?.code}, instanceof ConduitError: ${error instanceof ConduitError}`);
    // If it's a ConduitError or looks like one (has errorCode property)
    if (error && typeof error.errorCode === 'string') { 
      logger.debug(`copyPath re-throwing error with known errorCode: ${error.errorCode}`);
      throw error; // Re-throw ConduitErrors or errors that look like them
    }

    // This specific ENOENT check for sourcePath should ideally be caught by the getStats call at the beginning.
    // If it reaches here with ENOENT, it implies a race condition or an error from fs.cp itself with ENOENT.
    if (error.code === 'ENOENT') { 
      logger.warn(`ENOENT received during fs.cp operation for source ${sourcePath} to ${destinationPath}. This might indicate source disappeared post-stat or fs.cp internal issue.`);
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Source path not found or disappeared during copy: ${sourcePath}. Error: ${error.message}`);
    }
    logger.error(`Error copying path ${sourcePath} to ${destinationPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_COPY_FAILED, `Failed to copy: ${sourcePath} to ${destinationPath}. Error: ${error.message}`);
  }
}

/**
 * Moves/renames a file or directory.
 * @param sourcePath Source path.
 * @param destinationPath Destination path.
 */
export async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    const destDirname = path.dirname(destinationPath);
    let finalDestinationPath = destinationPath;

    // Check if the intended final destination (could be inside a directory or the path itself) exists
    let preliminaryFinalDest = destinationPath; 
    if (await pathExists(destinationPath)) {
        const destStats = await getStats(destinationPath);
        if (destStats.isDirectory()) {
            preliminaryFinalDest = path.join(destinationPath, path.basename(sourcePath));
        }
    } 
    // Now, `preliminaryFinalDest` is the actual path where the source would end up.
    finalDestinationPath = preliminaryFinalDest;

    // If this final target path exists and is a file, delete it to ensure overwrite behavior for fs.rename
    if (await pathExists(finalDestinationPath)) {
        const finalDestStats = await getStats(finalDestinationPath);
        if (finalDestStats.isFile()) {
            logger.debug(`Destination file ${finalDestinationPath} exists, deleting for overwrite before move.`);
            await fs.unlink(finalDestinationPath); // Delete existing file for overwrite
        } else if (finalDestStats.isDirectory()) {
            // This case implies moving a file/dir into an existing directory, which then contains an item of the same name.
            // If the source is a file and finalDestinationPath (after join) is an existing dir, fs.rename would likely fail or be OS-dependent.
            // If source is a dir and finalDestinationPath is an existing dir, it should replace it (common on POSIX, might need rmdir on Windows first).
            // For simplicity and safety, if finalDest is a dir (and source isn't being moved *into* it but *as* it), this is an issue.
            // However, the logic above joining path.basename(sourcePath) should prevent finalDestinationPath from being an existing directory
            // unless the source is a directory and the target is also a directory of the same name.
            // fs.rename might handle merging/replacing directory contents differently or fail.
            // To ensure clear overwrite of a directory, it would typically be deleted first.
            // For now, we are primarily concerned with overwriting *files* as per spec.
            // Overwriting directories with fs.rename is more complex (e.g. non-empty dirs).
            // The spec says "Overwrites existing FILES at the destination by default."
        }
    }

    // Ensure the parent directory of the final destination exists
    const finalDestParentDir = path.dirname(finalDestinationPath);
    if (finalDestParentDir !== finalDestinationPath && !(await pathExists(finalDestParentDir))) {
        logger.debug(`Parent directory ${finalDestParentDir} for destination ${finalDestinationPath} does not exist. Creating.`);
        await createDirectory(finalDestParentDir, true);
    }
    
    await fs.rename(sourcePath, finalDestinationPath);
  } catch (error: any) {
    // If it's a ConduitError or looks like one (has errorCode property)
    if (error && typeof error.errorCode === 'string') { 
      throw error; // Re-throw ConduitErrors or errors that look like them
    }
    if (error.code === 'ENOENT') {
      logger.error(`ENOENT during move operation for ${sourcePath} to ${destinationPath}: ${error.message}`);
      throw new ConduitError(ErrorCode.ERR_FS_MOVE_FAILED, `Move operation failed (ENOENT): ${sourcePath} to ${destinationPath}. Error: ${error.message}`);
    }
    logger.error(`Error moving path ${sourcePath} to ${destinationPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_MOVE_FAILED, `Failed to move/rename: ${sourcePath} to ${destinationPath}. Error: ${error.message}`);
  }
}

/**
 * Updates file timestamps (like touch command).
 * @param filePath Path to the file.
 */
export async function touchFile(filePath: string): Promise<void> {
  try {
    if (!(await pathExists(filePath))) {
      await writeFile(filePath, ''); // Create empty file if it doesn't exist
    } else {
      const now = new Date();
      await fs.utimes(filePath, now, now);
    }
  } catch (error: any) {
    logger.error(`Error touching file ${filePath}: ${error.message}`);
    throw new ConduitError(ErrorCode.OPERATION_FAILED, `Failed to touch file: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Populates an EntryInfo object from fs.Stats.
 * @param fullPath Absolute path to the entry.
 * @param statsParam fs.Stats object for the entry.
 * @param name Optional name override (defaults to basename of fullPath).
 * @returns Populated EntryInfo object.
 */
export async function createEntryInfo(fullPath: string, statsParam: Stats, name?: string): Promise<Omit<EntryInfo, 'children' | 'recursive_size_calculation_note'>> {
  try {
    const lstats = await fs.lstat(fullPath);
    let effectiveStats: Stats = lstats;
    let symlinkReadTarget: string | undefined = undefined;
    const isSymlink = lstats.isSymbolicLink();

    if (isSymlink) {
      try {
        const linkTarget = await fs.readlink(fullPath, { encoding: 'utf8' });
        symlinkReadTarget = linkTarget.toString();
        effectiveStats = await fs.stat(fullPath);
      } catch (e) {
        effectiveStats = lstats;
        if (!(e instanceof ConduitError) && (e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            logger.debug(`Symlink target stat/readlink failed for ${fullPath}: using lstat. Error: ${(e as Error).message}`);
        }
      }
    }

    return {
      name: name || path.basename(fullPath),
      path: fullPath,
      type: isSymlink ? 'symlink' : effectiveStats.isDirectory() ? 'directory' : effectiveStats.isFile() ? 'file' : 'other',
      size_bytes: effectiveStats.isFile() && !isSymlink ? effectiveStats.size : undefined,
      created_at: formatToISO8601UTC(effectiveStats.birthtime),
      modified_at: formatToISO8601UTC(effectiveStats.mtime),
      last_accessed_at: formatToISO8601UTC(effectiveStats.atime),
      is_readonly: !(effectiveStats.mode & fsConstants.S_IWUSR),
      mime_type: effectiveStats.isFile() && !isSymlink ? await getMimeType(fullPath) : undefined,
      symlink_target: symlinkReadTarget,
    };
  } catch (error: any) {
    logger.error(`[createEntryInfo] Caught error for path '${fullPath}'. Type: ${typeof error}, Is ConduitError: ${error instanceof ConduitError}, Code: ${error?.code}, Message: ${error?.message}, Stack: ${error?.stack}`);
    if (error instanceof ConduitError && error.errorCode === ErrorCode.ERR_FS_PERMISSION_DENIED) {
      throw error;
    }
    const errorMessage = String(error?.message || 'Unknown error during entry info creation');
    logger.error(`Failed to create entry info for ${fullPath}: ${errorMessage}`);
    throw new ConduitError(ErrorCode.OPERATION_FAILED, `Could not get entry info for ${fullPath}. Error: ${errorMessage}`);
  }
}

/**
 * Calculates the recursive size of a directory.
 * @param dirPath Path to the directory.
 * @param currentDepth Current recursion depth.
 * @param maxDepth Max recursion depth from config.
 * @param timeoutMs Timeout for the whole operation.
 * @param startTime Start time of the operation (for timeout tracking).
 * @returns Object with total size and a potential note if timed out or depth limited.
 */
export async function calculateRecursiveDirectorySize(
    dirPath: string,
    currentDepth: number,
    maxDepth: number,
    timeoutMs: number,
    startTime: number
): Promise<{ size: number; note?: string }> {
    let totalSize = 0;
    let note: string | undefined = undefined;

    if (currentDepth > maxDepth) {
        return { size: 0, note: 'Partial size: depth limit reached' };
    }

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (Date.now() - startTime > timeoutMs) {
                note = 'Calculation timed out due to server limit';
                break; // Stop processing if timeout is reached
            }

            const entryPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                try {
                    const stats = await fs.stat(entryPath);
                    totalSize += stats.size;
                } catch (statError) {
                    logger.warn(`Could not stat file ${entryPath} during recursive size calculation: ${statError}`);
                }
            } else if (entry.isDirectory()) {
                if (currentDepth + 1 <= maxDepth) {
                    const subDirInfo = await calculateRecursiveDirectorySize(entryPath, currentDepth + 1, maxDepth, timeoutMs, startTime);
                    totalSize += subDirInfo.size;
                    if (subDirInfo.note && !note) { // Propagate note if one occurs deeper
                        note = subDirInfo.note;
                    }
                    if (note === 'Calculation timed out due to server limit') break; // Stop if timeout from sub-calculation
                } else if (!note) {
                    note = 'Partial size: depth limit reached';
                }
            }
        }
    } catch (err) {
        logger.warn(`Error reading directory ${dirPath} for recursive size calculation: ${err}`);
        if(!note) note = 'Error during size calculation';
    }
    return { size: totalSize, note };
}

export async function getFilesystemStats(resolvedPath: string): Promise<{
    total_bytes: number;
    free_bytes: number;
    available_bytes: number; // Often same as free_bytes for non-root
    used_bytes: number;
}> {
    try {
        const ds = await checkDiskSpace(resolvedPath);
        return {
            total_bytes: ds.size,
            free_bytes: ds.free,
            available_bytes: ds.free, 
            used_bytes: ds.size - ds.free,
        };
    } catch (error: any) {
        logger.error(`Failed to get disk space info for path "${resolvedPath}": ${error.message}`);
        throw new ConduitError(
            ErrorCode.OPERATION_FAILED,
            `Could not retrieve disk space information for "${resolvedPath}". Underlying error: ${error.message}`
        );
    }
}

/**
 * Ensures that a directory exists. Creates it recursively if missing.
 * @param dirPath Directory path to ensure.
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code === 'EEXIST') return; // Already exists
    logger.error(`Error ensuring directory exists ${dirPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_DIR_CREATE_FAILED, `Failed to ensure directory exists: ${dirPath}. Error: ${error.message}`);
  }
} 