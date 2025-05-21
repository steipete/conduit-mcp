import * as path from 'path';
import { ConduitServerConfig, EntryInfo, ErrorCode, ListTool, logger, fileSystemOps, ConduitError } from '@/internal';

const operationLogger = logger.child({ component: 'listOps' });

async function listDirectoryEntriesRecursive(
    currentPath: string,
    basePath: string, // The original path requested by the user, for relative path calculations in EntryInfo if needed
    currentDepth: number,
    params: ListTool.EntriesParams,
    config: ConduitServerConfig
): Promise<EntryInfo[]> {
    const entries: EntryInfo[] = [];
    if (currentDepth > (params.recursive_depth ?? 0) && params.recursive_depth !== -1) { // -1 means unlimited within server max
        return entries;
    }
    // Respect server's max depth
    const maxAllowedDepth = config.maxRecursiveDepth === -1 ? Infinity : config.maxRecursiveDepth;
    if (currentDepth > maxAllowedDepth) {
        // This case should ideally be prevented by the initial depth check against config.maxRecursiveDepth
        // but serves as a safeguard.
        operationLogger.warn(`Recursive listing for ${currentPath} exceeded server max depth ${maxAllowedDepth}.`);
        // TODO: How to signal this to the parent? Maybe a special marker or note?
        // For now, just stop recursing for this branch. The top-level might need a general note.
        return entries;
    }

    let dirContents: string[];
    try {
        dirContents = await fileSystemOps.listDirectory(currentPath);
    } catch (error: any) {
        operationLogger.error(`Error listing directory ${currentPath}: ${error.message}`);
        // If the current path itself is inaccessible, we can't list its children.
        // This error should ideally be caught for the parent EntryInfo if this is a recursive call.
        // For the top-level call, listEntries will handle it.
        throw error; // Re-throw to be handled by the caller, or for the specific entry.
    }

    for (const entryName of dirContents) {
        const entryAbsolutePath = path.join(currentPath, entryName);
        try {
            const stats = await fileSystemOps.getLstats(entryAbsolutePath); // Use lstat to avoid following symlinks for basic info
            
            // Create base EntryInfo (without children or recursive size yet)
            const entryInfoBase = await fileSystemOps.createEntryInfo(entryAbsolutePath, stats, entryName);
            let entry: EntryInfo = { ...entryInfoBase };

            if (stats.isDirectory()) {
                let recursiveSize: number | undefined = undefined;
                let sizeNote: string | undefined = undefined;

                if (params.calculate_recursive_size) {
                    const sizeResult = await fileSystemOps.calculateRecursiveDirectorySize(
                        entryAbsolutePath,
                        0, // depth for size calculation starts from 0 for the directory itself
                        params.recursive_depth === -1 ? maxAllowedDepth : Math.min(params.recursive_depth ?? 0, maxAllowedDepth) - currentDepth, // Adjust depth for size calculation
                        config.recursiveSizeTimeoutMs,
                        Date.now()
                    );
                    recursiveSize = sizeResult.size;
                    sizeNote = sizeResult.note;
                }
                entry.size_bytes = recursiveSize ?? entry.size_bytes; // Use recursive if calculated, else OS size
                if (sizeNote) {
                    entry.recursive_size_calculation_note = sizeNote;
                }

                // Handle children if recursive depth allows
                const effectiveRecursiveDepth = params.recursive_depth === -1 ? maxAllowedDepth : (params.recursive_depth ?? 0);
                if (currentDepth < effectiveRecursiveDepth) {
                    entry.children = await listDirectoryEntriesRecursive(
                        entryAbsolutePath,
                        basePath,
                        currentDepth + 1,
                        params,
                        config
                    );
                }
            }
            entries.push(entry);
        } catch (statError: any) {
            operationLogger.warn(`Could not stat or process entry ${entryAbsolutePath}: ${statError.message}. Skipping this entry.`);
            // Optionally, create an error entry or log, but spec implies skipping non-readable items.
            // For now, we just skip.
        }
    }
    return entries;
}


export async function listEntries(
    params: ListTool.EntriesParams,
    config: ConduitServerConfig
): Promise<EntryInfo[] | ConduitError> { // Return ConduitError to be handled by tool handler
    operationLogger.info(`Processing listEntries for path: ${params.path}, depth: ${params.recursive_depth}, calc_size: ${params.calculate_recursive_size}`);

    const absoluteBasePath = path.resolve(config.workspaceRoot, params.path);

    // Validate base path
    if (!await fileSystemOps.pathExists(absoluteBasePath)) {
        return new ConduitError(ErrorCode.ERR_FS_NOT_FOUND, `Base path not found: ${params.path}`);
    }
    const baseStats = await fileSystemOps.getStats(absoluteBasePath);
    if (!baseStats.isDirectory()) {
        return new ConduitError(ErrorCode.ERR_FS_IS_FILE, `Base path is a file, not a directory: ${params.path}`);
    }

    // Cap recursive_depth by server's maxRecursiveDepth
    let requestedDepth = params.recursive_depth ?? 0;
    if (config.maxRecursiveDepth !== -1 && (requestedDepth === -1 || requestedDepth > config.maxRecursiveDepth)) {
        operationLogger.info(`Requested recursive_depth ${requestedDepth} capped to server max ${config.maxRecursiveDepth} for path ${params.path}`);
        requestedDepth = config.maxRecursiveDepth;
    }
    const effectiveParams = { ...params, recursive_depth: requestedDepth };

    // If non-recursive (depth 0) and path is a directory, list its contents.
    // If path is a file (already checked it's a dir), listEntriesRecursive handles entries.
    try {
        // If depth is 0, we list the contents of the directory.
        // If depth > 0, listDirectoryEntriesRecursive will be called on children.
        // The initial call to listDirectoryEntriesRecursive will handle the items *inside* absoluteBasePath.
        // If we need to return the base path itself as an EntryInfo, that's a different structure.
        // The spec: "Returns: For operation: "entries": An array of EntryInfo objects." - implying contents.

        if (requestedDepth === 0) { // Non-recursive, list immediate children
            const dirContentsNames = await fileSystemOps.listDirectory(absoluteBasePath);
            const topLevelEntries: EntryInfo[] = [];
            for (const name of dirContentsNames) {
                const entryPath = path.join(absoluteBasePath, name);
                try {
                    const stats = await fileSystemOps.getLstats(entryPath);
                    const entryInfoBase = await fileSystemOps.createEntryInfo(entryPath, stats, name);
                    let entry: EntryInfo = { ...entryInfoBase };

                    if (stats.isDirectory() && params.calculate_recursive_size) {
                         // For depth 0, recursive size means size of the directory itself (its direct files)
                        const sizeResult = await fileSystemOps.calculateRecursiveDirectorySize(
                            entryPath, 
                            0, // Depth for this dir is 0
                            0, // Max depth for its contents is 0
                            config.recursiveSizeTimeoutMs,
                            Date.now()
                        );
                        entry.size_bytes = sizeResult.size;
                        if (sizeResult.note) entry.recursive_size_calculation_note = sizeResult.note;
                    }
                    topLevelEntries.push(entry);
                } catch (statError: any) {
                    operationLogger.warn(`Could not stat or process entry ${entryPath} in non-recursive list: ${statError.message}. Skipping.`);
                }
            }
            return topLevelEntries;

        } else { // Recursive listing (requestedDepth > 0 or -1 for unlimited up to server max)
            return await listDirectoryEntriesRecursive(absoluteBasePath, absoluteBasePath, 0, effectiveParams, config);
        }

    } catch (error: any) {
        operationLogger.error(`Failed to list entries for ${params.path}: ${error.message}`);
        if (error instanceof ConduitError) return error;
        return new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to list entries for path ${params.path}: ${error.message || 'Unknown error'}`);
    }
} 