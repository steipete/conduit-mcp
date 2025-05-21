import * as fs from 'fs/promises';
import * as path from 'path';
import { WriteTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, calculateChecksum, logger, fileSystemOps } from '@/internal';

const operationLogger = logger.child({ component: 'putContentOps' });

function createErrorPutResultItem(
    entryPath: string,
    errorCode: ErrorCode,
    errorMessage: string
): WriteTool.WriteResultItem {
    const errorResult: MCPErrorStatus & { path?: string; action_performed: WriteTool.WriteAction } = {
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
        path: entryPath,
        action_performed: 'put',
    };
    return errorResult as WriteTool.WriteResultItem;
}

export async function putContent(
    entry: WriteTool.PutEntry,
    config: ConduitServerConfig
): Promise<WriteTool.WriteResultItem> {
    operationLogger.info(`Processing putContent for target: ${entry.path}`);

    const effectiveWriteMode = entry.write_mode ?? 'overwrite';

    try {
        const targetDir = path.dirname(entry.path);
        if (!(await fileSystemOps.pathExists(targetDir))) {
            operationLogger.info(`Target directory ${targetDir} does not exist. Creating it.`);
            await fs.mkdir(targetDir, { recursive: true });
        }

        let contentBuffer: Buffer;
        if (entry.input_encoding === 'base64') {
            try {
                contentBuffer = Buffer.from(entry.content, 'base64');
            } catch (e: any) {
                return createErrorPutResultItem(entry.path, ErrorCode.ERR_INVALID_BASE64, `Invalid base64 content: ${e.message}`);
            }
        } else { // Default to 'text' (utf8)
            contentBuffer = Buffer.from(entry.content, 'utf8');
        }

        const fileExists = await fileSystemOps.pathExists(entry.path);

        if (fileExists) {
            const stats = await fileSystemOps.getStats(entry.path);
            if (stats.isDirectory()) {
                return createErrorPutResultItem(entry.path, ErrorCode.ERR_FS_IS_DIRECTORY, `Target path exists and is a directory: ${entry.path}`);
            }
            if (effectiveWriteMode !== 'overwrite' && effectiveWriteMode !== 'append') {
                return createErrorPutResultItem(entry.path, ErrorCode.ERR_FS_ALREADY_EXISTS, `File exists and write_mode is not 'overwrite' or 'append': ${entry.path}`);
            }
        }

        const writeOptions: { flag?: string } = {};
        if (effectiveWriteMode === 'append') {
            writeOptions.flag = 'a';
        } else {
            writeOptions.flag = 'w';
        }

        await fs.writeFile(entry.path, contentBuffer, writeOptions);

        const successResult: WriteTool.WriteResultSuccess = {
            status: 'success',
            action_performed: 'put',
            path: entry.path,
            bytes_written: contentBuffer.length,
            message: fileExists ? (effectiveWriteMode === 'append' ? 'Content appended to file.' : 'File overwritten.') : 'File created.',
        };
        return successResult;

    } catch (error: any) {
        operationLogger.error(`Error in putContent for ${entry.path}:`, error);
        if (error instanceof ConduitError) {
            return createErrorPutResultItem(entry.path, error.errorCode, error.message);
        }
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return createErrorPutResultItem(entry.path, ErrorCode.ERR_FS_ACCESS_DENIED, `Permission denied for path: ${entry.path}`);
        }
        if (error.code === 'EISDIR') {
             return createErrorPutResultItem(entry.path, ErrorCode.ERR_FS_IS_DIRECTORY, `Target path is a directory (during write attempt): ${entry.path}`);
        }
        return createErrorPutResultItem(entry.path, ErrorCode.ERR_FS_WRITE_FAILED, `Failed to write to file ${entry.path}: ${error.message || 'Unknown error'}`);
    }
} 