import * as fs from 'fs/promises';
import * as path from 'path';
import { WriteTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, calculateChecksum, fileSystemOps, logger } from '@/internal';

function createErrorPutResultItem(
    targetPath: string,
    errorCode: ErrorCode,
    errorMessage: string,
): WriteTool.WriteResultItem {
    return {
        path: targetPath,
        status: 'error',
        action_performed: 'put',
        error_code: errorCode,
        error_message: errorMessage,
    } as WriteTool.WriteResultItem;
}

export async function putContent(
    entry: WriteTool.PutEntry,
    config: ConduitServerConfig
): Promise<WriteTool.WriteResultItem> {
    const operationLogger = logger.child({ component: 'putContentOps' });
    operationLogger.info(`Processing putContent for target: ${entry.path}`);

    const effectiveWriteMode = entry.write_mode ?? 'overwrite';
    const targetPath = entry.path;

    try {
        if (entry.content === undefined && entry.input_encoding !== 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, "Missing 'content' for the given input_encoding.");
        }
        // file_ref_to_decompress logic was removed

        if (entry.input_encoding !== 'text' && entry.input_encoding !== 'base64' && entry.input_encoding !== 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Unsupported input_encoding: ${entry.input_encoding}`);
        }

        let bufferToWrite: Buffer;
        let fileSystemOpsEncoding: 'text' | 'base64' = 'text';

        if (entry.input_encoding === 'text') {
            bufferToWrite = Buffer.from(entry.content as string, 'utf8');
            fileSystemOpsEncoding = 'text';
        } else if (entry.input_encoding === 'base64') {
            if (typeof entry.content !== 'string') {
                return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, "Content for base64 input_encoding must be a string.");
            }
            // Strict Base64 validation
            const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
            if (!base64Regex.test(entry.content)) {
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_INVALID_BASE64, "Invalid base64 content: Input string contains non-base64 characters or is not correctly padded.");
            }
            try {
                bufferToWrite = Buffer.from(entry.content, 'base64');
            } catch (e: any) { // Should be less likely to hit now, but keep as a fallback
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_INVALID_BASE64, `Invalid base64 content (Buffer.from error): ${e.message}`);
            }
        } else if (entry.input_encoding === 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.NOT_IMPLEMENTED, "Processing 'base64_gzipped_file_ref' input_encoding requires pre-fetch and decompression.");
        } else {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Internal error: Unhandled input_encoding: ${entry.input_encoding}`);
        }

        const parentDir = path.dirname(targetPath);
        await fileSystemOps.createDirectory(parentDir, true);

        if (effectiveWriteMode === 'overwrite') {
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'overwrite');
        } else if (effectiveWriteMode === 'append') {
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'append');
        } else if (effectiveWriteMode === 'error_if_exists') {
            if (await fileSystemOps.pathExists(targetPath)) {
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_ALREADY_EXISTS, `File already exists at ${targetPath} and write_mode is 'error_if_exists'.`);
            }
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'overwrite');
        } else {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Unknown write_mode: ${effectiveWriteMode}`);
        }

        const checksum = await calculateChecksum(bufferToWrite, entry.checksum_algorithm || config.defaultChecksumAlgorithm);

        return {
            path: targetPath,
            status: 'success',
            action_performed: 'put',
            bytes_written: bufferToWrite.length,
            checksum: checksum,
            checksum_algorithm_used: entry.checksum_algorithm || config.defaultChecksumAlgorithm,
        } as WriteTool.WriteResultSuccess;

    } catch (error: any) {
        operationLogger.error(`Error in putContent for ${targetPath}:`, error);
        if (error instanceof ConduitError) {
            return createErrorPutResultItem(targetPath, error.errorCode, error.message);
        }
        if (error.code === 'ENOENT') {
            return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_NOT_FOUND, `File or parent directory not found for ${targetPath}: ${error.message}`);
        }
        if (error.code === 'EACCES') {
            return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_PERMISSION_DENIED, `Permission denied for ${targetPath}: ${error.message}`);
        }
        return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_WRITE_FAILED, `Failed to write to ${targetPath}: ${error.message || 'Unknown error'}`);
    }
}
