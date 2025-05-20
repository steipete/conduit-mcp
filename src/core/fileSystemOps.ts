import fs from 'fs/promises';
import type { Stats } from 'fs';
import path from 'path';
import { constants as fsConstants } from 'fs';
import { conduitConfig } from './configLoader';
import { ConduitError, ErrorCode, createMCPErrorStatus } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import { EntryInfo } from '@/types/common';
import { formatToISO8601UTC } from '@/utils/dateTime';
import { getMimeType } from './mimeService';

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
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to get stats for path: ${filePath}. Error: ${error.message}`);
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
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to get lstats for path: ${filePath}. Error: ${error.message}`);
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
    if (stats.size > maxLength) {
      throw new ConduitError(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, `File size ${stats.size} bytes exceeds maximum allowed read limit of ${maxLength} bytes for ${filePath}.`);
    }
    return await fs.readFile(filePath, { encoding: 'utf8' });
  } catch (error: any) {
    if (error instanceof ConduitError) throw error;
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
    if (stats.size > maxLength) {
      throw new ConduitError(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, `File size ${stats.size} bytes exceeds maximum allowed read limit of ${maxLength} bytes for ${filePath}.`);
    }
    return await fs.readFile(filePath);
  } catch (error: any) {
    if (error instanceof ConduitError) throw error;
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
        throw new ConduitError(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, `Content size ${bufferContent.length} bytes exceeds maximum allowed write limit of ${conduitConfig.maxFileReadBytes} bytes for ${filePath}.`);
    }

    if (mode === 'append') {
      await fs.appendFile(filePath, bufferContent);
    } else {
      await fs.writeFile(filePath, bufferContent);
    }
    return bufferContent.length;
  } catch (error: any) {
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
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to create directory: ${dirPath}. Error: ${error.message}`);
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
    if (error.code === 'ENOENT') { // Path doesn't exist, consider it a success for delete
      logger.debug(`Path not found for deletion (considered success): ${itemPath}`);
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
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Directory not found: ${dirPath}`);
    }
    if (error.code === 'ENOTDIR') {
        throw new ConduitError(ErrorCode.ERR_FS_IS_FILE, `Path is a file, not a directory: ${dirPath}`);
    }
    logger.error(`Error listing directory ${dirPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to list directory: ${dirPath}. Error: ${error.message}`);
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
      await fs.cp(sourcePath, destinationPath, { recursive: true });
    } else {
       // If destination is a directory, copy source file inside it
      let finalDest = destinationPath;
      try {
        const destStats = await getStats(destinationPath);
        if (destStats.isDirectory()) {
          finalDest = path.join(destinationPath, path.basename(sourcePath));
        }
      } catch (destStatError: any) {
        // Destination doesn't exist or is not a dir, fs.cp will handle it or error appropriately.
      }
      await fs.cp(sourcePath, finalDest, { recursive: false }); // recursive false for files, true would also work.
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Source path not found for copy: ${sourcePath}`);
    }
    logger.error(`Error copying path ${sourcePath} to ${destinationPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to copy: ${sourcePath} to ${destinationPath}. Error: ${error.message}`);
  }
}

/**
 * Moves/renames a file or directory.
 * @param sourcePath Source path.
 * @param destinationPath Destination path.
 */
export async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    // Ensure destination directory exists if moving into a directory
    const destBasename = path.basename(destinationPath);
    const destDirname = path.dirname(destinationPath);

    let finalDestinationPath = destinationPath;

    if (await pathExists(destinationPath)){
        const destStats = await getStats(destinationPath);
        if(destStats.isDirectory()){
            finalDestinationPath = path.join(destinationPath, path.basename(sourcePath));
        }
    } else {
        // If destination path does not exist, check if its parent directory exists.
        // fs.rename will fail if the full new path structure doesn't exist partially.
        if(!(await pathExists(destDirname))){
             await createDirectory(destDirname, true); // Create parent if it doesn't exist
        }
    }
    
    await fs.rename(sourcePath, finalDestinationPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Source path not found for move: ${sourcePath}`);
    }
    logger.error(`Error moving path ${sourcePath} to ${destinationPath}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to move/rename: ${sourcePath} to ${destinationPath}. Error: ${error.message}`);
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
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to touch file: ${filePath}. Error: ${error.message}`);
  }
}

/**
 * Populates an EntryInfo object from fs.Stats.
 * @param fullPath Absolute path to the entry.
 * @param stats fs.Stats object for the entry.
 * @param name Optional name override (defaults to basename of fullPath).
 * @returns Populated EntryInfo object.
 */
export async function createEntryInfo(fullPath: string, stats: Stats, name?: string): Promise<Omit<EntryInfo, 'children' | 'recursive_size_calculation_note'>> {
  const entryType = stats.isDirectory() ? 'directory' : 'file';
  let mime: string | undefined = undefined;
  if (entryType === 'file' && stats.size > 0) {
      mime = await getMimeType(fullPath);
  }

  return {
      name: name || path.basename(fullPath),
      path: fullPath,
      type: entryType,
      size_bytes: stats.size,
      mime_type: mime,
      created_at_iso: formatToISO8601UTC(stats.birthtime),
      modified_at_iso: formatToISO8601UTC(stats.mtime),
      permissions_octal: `0${(stats.mode & 0o777).toString(8)}`,
      // Basic rwx string, not handling setuid/setgid/sticky bits for simplicity here
      permissions_string: [
          (stats.mode & 0o400 ? 'r' : '-'), (stats.mode & 0o200 ? 'w' : '-'), (stats.mode & 0o100 ? 'x' : '-'),
          (stats.mode & 0o040 ? 'r' : '-'), (stats.mode & 0o020 ? 'w' : '-'), (stats.mode & 0o010 ? 'x' : '-'),
          (stats.mode & 0o004 ? 'r' : '-'), (stats.mode & 0o002 ? 'w' : '-'), (stats.mode & 0o001 ? 'x' : '-'),
      ].join(''),
  };
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