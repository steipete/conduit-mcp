import * as fs from 'fs/promises';
import * as path from 'path';
import { WriteTool, ConduitServerConfig, ConduitError, ErrorCode, calculateChecksum, fileSystemOps, logger, MCPErrorStatus } from '@/internal';

// Define a specific error result type for putContent that can include bytes_written
interface PutContentOpErrorResult extends MCPErrorStatus { // Extends MCPErrorStatus
    // Fields that would come from WriteTool's internal BaseResult structure for a 'put' operation
    action_performed: 'put'; // Hardcoded to 'put' for this operation's errors
    path: string; 
    bytes_written?: number; // Optional: only present if write succeeded before error
}

function createErrorPutResultItem(
    targetPath: string,
    errorCode: ErrorCode,
    errorMessage: string,
    bytesWritten?: number,
): PutContentOpErrorResult {
    const errorResult: PutContentOpErrorResult = {
        status: 'error', // From MCPErrorStatus
        error_code: errorCode, // From MCPErrorStatus
        error_message: errorMessage, // From MCPErrorStatus
        action_performed: 'put', // From our definition matching BaseResult structure
        path: targetPath, // From our definition matching BaseResult structure
    };
    if (bytesWritten !== undefined) {
        errorResult.bytes_written = bytesWritten;
    }
    return errorResult;
}

export async function putContent(
    entry: WriteTool.PutEntry,
    config: ConduitServerConfig
): Promise<WriteTool.WriteResultItem> { // Return type is the general union
    const operationLogger = logger.child({ component: 'putContentOps' });
    operationLogger.info(`Processing putContent for target: ${entry.path}`);

    const effectiveWriteMode = entry.write_mode ?? 'overwrite';
    const targetPath = entry.path;
    let bufferToWrite: Buffer | undefined = undefined;
    let bytesSuccessfullyWritten: number | undefined = undefined;

    try {
        if (entry.content === undefined && entry.input_encoding !== 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, "Missing 'content' for the given input_encoding.");
        }
        // file_ref_to_decompress logic was removed

        if (entry.input_encoding !== 'text' && entry.input_encoding !== 'base64' && entry.input_encoding !== 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Unsupported input_encoding: ${entry.input_encoding}`);
        }

        let fileSystemOpsEncoding: 'text' | 'base64' = 'text';

        if (entry.input_encoding === 'text') {
            bufferToWrite = Buffer.from(entry.content as string, 'utf8');
            fileSystemOpsEncoding = 'text';
        } else if (entry.input_encoding === 'base64') {
            if (typeof entry.content !== 'string') {
                return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, "Content for base64 input_encoding must be a string.");
            }
            const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
            if (!base64Regex.test(entry.content)) {
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_INVALID_BASE64, "Invalid base64 content: Input string contains non-base64 characters or is not correctly padded.");
            }
            try {
                bufferToWrite = Buffer.from(entry.content, 'base64');
            } catch (e: any) {
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_INVALID_BASE64, `Invalid base64 content (Buffer.from error): ${e.message}`);
            }
        } else if (entry.input_encoding === 'base64_gzipped_file_ref' as any) {
            return createErrorPutResultItem(targetPath, ErrorCode.NOT_IMPLEMENTED, "Processing 'base64_gzipped_file_ref' input_encoding requires pre-fetch and decompression.");
        } else {
            // This case should ideally not be reached
             bufferToWrite = Buffer.alloc(0); // Default for TS, error already returned
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Internal error: Unhandled input_encoding: ${entry.input_encoding}`);
        }

        const parentDir = path.dirname(targetPath);
        await fileSystemOps.createDirectory(parentDir, true);

        // operationLogger.info(`About to write. Mode: ${effectiveWriteMode}, Path: ${targetPath}, Encoding: undefined, Buffer length: ${bufferToWrite?.length}`);

        if (effectiveWriteMode === 'overwrite') {
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'overwrite');
        } else if (effectiveWriteMode === 'append') {
            // operationLogger.info(`[APPEND PATH] Executing append logic now. Path: ${targetPath}, Buffer length: ${bufferToWrite?.length}`);
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'append');
            // operationLogger.info(`[APPEND PATH] writeFile for append completed for ${targetPath}`);
        } else if (effectiveWriteMode === 'error_if_exists') {
            const fileExists = await fileSystemOps.pathExists(targetPath);
            // operationLogger.info(`In error_if_exists: pathExists for ${targetPath} returned ${fileExists}`);
            if (fileExists) {
                // operationLogger.info(`[EIF_BLOCK] File exists, returning ERR_FS_ALREADY_EXISTS for ${targetPath}`);
                return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_ALREADY_EXISTS, `File already exists at ${targetPath} and write_mode is 'error_if_exists'.`);
            }
            // operationLogger.info(`[EIF_BLOCK] File does NOT exist (or bypass), proceeding to write for ${targetPath}`);
            await fileSystemOps.writeFile(targetPath, bufferToWrite, undefined, 'overwrite');
        } else {
            return createErrorPutResultItem(targetPath, ErrorCode.INVALID_PARAMETER, `Unknown write_mode: ${effectiveWriteMode}`);
        }
        
        bytesSuccessfullyWritten = bufferToWrite.length;

        const checksum = await calculateChecksum(bufferToWrite, entry.checksum_algorithm || config.defaultChecksumAlgorithm);

        return {
            path: targetPath,
            status: 'success',
            action_performed: 'put',
            bytes_written: bytesSuccessfullyWritten,
            checksum: checksum,
            checksum_algorithm_used: entry.checksum_algorithm || config.defaultChecksumAlgorithm,
        } as WriteTool.WriteResultSuccess;

    } catch (error: any) {
        // operationLogger.error(`[ERROR PATH] Error in putContent for ${targetPath}:`, error);
        if (error && error.isConduitError === true && typeof error.errorCode === 'string') {
            // operationLogger.info(`[ERROR PATH] Caught ConduitError. bytesSuccessfullyWritten: ${bytesSuccessfullyWritten}, error code: ${error.errorCode}, message: ${error.message}`);
            return createErrorPutResultItem(targetPath, error.errorCode as ErrorCode, error.message, bytesSuccessfullyWritten);
        }
        if (error.code === 'ENOENT') {
            // operationLogger.info(`[ERROR PATH] Caught ENOENT error. Message: ${error.message}`);
            return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_NOT_FOUND, `File or parent directory not found for ${targetPath}: ${error.message}`);
        }
        if (error.code === 'EACCES') {
            // operationLogger.info(`[ERROR PATH] Caught EACCES error. Message: ${error.message}`);
            return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_PERMISSION_DENIED, `Permission denied for ${targetPath}: ${error.message}`);
        }
        // operationLogger.info(`[ERROR PATH] Fallback error. error.code: ${error.code}, message: ${error.message}`);
        operationLogger.error(`Unhandled error in putContent for ${targetPath}. Original error:`, error); // Keep one generic error log
        return createErrorPutResultItem(targetPath, ErrorCode.ERR_FS_WRITE_FAILED, `Failed to write to ${targetPath}: ${error.message || 'Unknown error'}`);
    }
}
