import * as fs from 'fs/promises';
import * as path from 'path';
import { WriteTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, fileSystemOps, logger } from '@/internal';

const operationLogger = logger.child({ component: 'mkdirOps' });

function createErrorMkdirResultItem(
    entryPath: string,
    errorCode: ErrorCode,
    errorMessage: string
): WriteTool.WriteResultItem {
    const errorResult: MCPErrorStatus & { path?: string; action_performed: WriteTool.WriteAction } = {
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
        path: entryPath,
        action_performed: 'mkdir',
    };
    return errorResult as WriteTool.WriteResultItem;
}

export async function makeDirectory(
    entry: WriteTool.MkdirEntry,
    config: ConduitServerConfig
): Promise<WriteTool.WriteResultItem> {
    operationLogger.info(`Processing mkdir for target: ${entry.path}`);

    if (!entry.path) {
        return createErrorMkdirResultItem(entry.path /*undefined*/, ErrorCode.ERR_INVALID_PARAMETER, 'path is required for mkdir.');
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
                return createErrorMkdirResultItem(entry.path, ErrorCode.ERR_FS_IS_FILE, `Path exists but is a file, not a directory: ${entry.path}`);
            }
        }

        // Path does not exist, create it
        await fs.mkdir(absoluteTargetPath, { recursive });
        operationLogger.info(`Successfully created directory: ${absoluteTargetPath}`);

        return {
            status: 'success',
            action_performed: 'mkdir',
            path: entry.path,
            message: recursive ? 'Directory and any necessary parent directories created.' : 'Directory created.',
        } as WriteTool.WriteResultSuccess;

    } catch (error: any) {
        operationLogger.error(`Error in makeDirectory for ${entry.path}:`, error);
        if (error instanceof ConduitError) {
            return createErrorMkdirResultItem(entry.path, error.errorCode, error.message);
        }
        // Handle common fs errors specifically
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return createErrorMkdirResultItem(entry.path, ErrorCode.ERR_FS_ACCESS_DENIED, `Permission denied for path: ${entry.path}`);
        }
        if (error.code === 'EEXIST') { // Should be caught by pathExists check, but as a safeguard
            return createErrorMkdirResultItem(entry.path, ErrorCode.ERR_FS_ALREADY_EXISTS, `Path already exists (unexpectedly): ${entry.path}`);
        }
        if (error.code === 'ENOTDIR') {
            return createErrorMkdirResultItem(entry.path, ErrorCode.ERR_FS_BAD_PATH_INPUT, `A component of the path prefix is not a directory: ${entry.path}`);
        }
        // Generic fallback
        return createErrorMkdirResultItem(entry.path, ErrorCode.ERR_FS_OPERATION_FAILED, `Failed to create directory ${entry.path}: ${error.message || 'Unknown error'}`);
    }
} 