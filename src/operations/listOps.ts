import * as path from 'path';
import {
  ListTool,
  EntryInfo,
  ConduitError,
  ErrorCode,
  fileSystemOps,
  validateAndResolvePath,
  logger,
  conduitConfig, // To access maxRecursiveDepth and recursiveDirSizeTimeoutMs
} from '@/internal';

const operationLogger = logger.child({ component: 'listOps' });

async function listDirectoryRecursive(
  currentPath: string,
  basePath: string, // The initial path from the request, for relative calculations if any
  currentDepth: number,
  params: ListTool.EntriesParams
  // config: ConduitServerConfig // Using global conduitConfig
): Promise<EntryInfo[]> {
  const entries: EntryInfo[] = [];
  const effectiveMaxDepth = Math.min(params.recursive_depth ?? 0, conduitConfig.maxRecursiveDepth);

  if (currentDepth > effectiveMaxDepth) {
    return entries; // Depth limit reached
  }

  let dirents: string[];
  try {
    // fileSystemOps.listDirectory is expected to return just names.
    // We need to validate currentPath before listing.
    // validateAndResolvePath should have been called on the initial basePath.
    // For recursive calls, currentPath is constructed and should be safe if parent was.
    dirents = await fileSystemOps.listDirectory(currentPath);
  } catch (error: unknown) {
    // Log and skip this directory if it's not readable, but don't fail the whole operation.
    // Parent operation should still return successfully with what it could list.
    // However, if the *initial* path fails, that's an error handled by handleListEntries.
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    operationLogger.warn(
      `Error listing directory ${currentPath}: ${errorMessage}. Skipping this directory.`
    );
    return entries; // Return empty for this problematic path
  }

  for (const name of dirents) {
    const entryPath = path.join(currentPath, name);
    let stats;
    try {
      // Use lstat to get info about symlinks themselves if not following them for basic type.
      // fileSystemOps.createEntryInfo handles symlink resolution internally for its target info.
      stats = await fileSystemOps.getLstats(entryPath);
    } catch (statError: unknown) {
      const errorMessage = statError instanceof Error ? statError.message : 'Unknown error';
      operationLogger.warn(`Could not stat ${entryPath}: ${errorMessage}. Skipping entry.`);
      continue;
    }

    // Create basic EntryInfo. fileSystemOps.createEntryInfo will handle symlink details.
    const entryInfoPartial = await fileSystemOps.createEntryInfo(entryPath, stats, name);
    const entry: EntryInfo = {
      ...entryInfoPartial,
      // children and recursive_size_calculation_note will be added below
    };

    if (entry.type === 'directory') {
      if (params.calculate_recursive_size) {
        try {
          const sizeInfo = await fileSystemOps.calculateRecursiveDirectorySize(
            entryPath,
            0, // Start depth 0 for this specific directory's recursive size calculation
            conduitConfig.maxRecursiveDepth, // Max depth for size calculation
            conduitConfig.recursiveSizeTimeoutMs,
            Date.now()
          );
          entry.size_bytes = sizeInfo.size;
          if (sizeInfo.note) {
            entry.recursive_size_calculation_note = sizeInfo.note;
          }
        } catch (sizeError: unknown) {
          const errorMessage = sizeError instanceof Error ? sizeError.message : 'Unknown error';
          operationLogger.warn(
            `Error calculating recursive size for ${entryPath}: ${errorMessage}`
          );
          entry.recursive_size_calculation_note = 'Error during size calculation';
        }
      }
      // Recursive call for children if depth allows
      if (currentDepth < effectiveMaxDepth) {
        entry.children = await listDirectoryRecursive(
          entryPath,
          basePath,
          currentDepth + 1,
          params
          // config
        );
      }
    }
    // If not a directory, createEntryInfo already got file size if applicable.
    // For files, size_bytes is already set by createEntryInfo if it's a file.
    // For symlinks, createEntryInfo sets size_bytes based on the target if it's a file.

    entries.push(entry);
  }
  return entries;
}

export async function handleListEntries(
  params: ListTool.EntriesParams
  // config: ConduitServerConfig // using global conduitConfig
): Promise<EntryInfo[]> {
  operationLogger.info(
    `Handling list.entries for path: ${params.path}, depth: ${params.recursive_depth}, calc_size: ${params.calculate_recursive_size}`
  );

  const resolvedBasePath = await validateAndResolvePath(params.path, {
    isExistenceRequired: true,
    checkAllowed: true,
  });
  const baseStats = await fileSystemOps.getStats(resolvedBasePath); // Get stats for the base path itself

  if (!baseStats.isDirectory()) {
    throw new ConduitError(
      ErrorCode.ERR_FS_PATH_IS_FILE,
      `Provided path is a file, not a directory: ${resolvedBasePath}`
    );
  }

  // If not recursive (depth 0) and not calculating recursive size for the top-level dir,
  // we can use a slightly simpler path for the main directory info, but still need children.
  // The recursive function handles depth 0 correctly by listing immediate children.

  // The root of the listing is the directory itself. We represent its children.
  // The spec implies the response is an array of EntryInfo for items *within* path,
  // not the path itself as a single EntryInfo wrapping children, unless recursive_depth is 0 and path is a file (which is an error).
  // If recursive_depth is 0, listDirectoryRecursive lists immediate children.
  // If recursive_depth > 0, it lists children and their children up to depth.

  const results = await listDirectoryRecursive(
    resolvedBasePath,
    resolvedBasePath, // Base path for reference
    0, // Initial depth
    params
    // config
  );

  operationLogger.debug(
    `list.entries for ${params.path} found ${results.length} top-level entries.`
  );
  return results;
}
