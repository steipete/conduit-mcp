import { ReadTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, readFileAsBuffer, getStats, getMimeType, logger } from '@/internal';
import * as diff from 'diff'; // Using the 'diff' library

const operationLogger = logger.child({ component: 'diffOps' });

interface BaseResultForError {
    // No specific fields needed here for diff errors beyond MCPErrorStatus
}

function createErrorDiffResultItem(
    // source1: string, // Removed
    // source2: string, // Removed
    errorCode: ErrorCode,
    errorMessage: string
): ReadTool.DiffResultItem { // This should align with ReadTool.DiffResult which is DiffResultSuccess | MCPErrorStatus
    const errorResult: MCPErrorStatus = { // No longer needs BaseResultForError fields
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
    };
    // The cast might be problematic if DiffResultItem is more specific than MCPErrorStatus in some way
    // However, DiffResult in tools.ts is DiffResultSuccess | MCPErrorStatus, so this should be fine.
    return errorResult as ReadTool.DiffResultItem;
}

export async function getDiff(
    params: ReadTool.DiffParams,
    config: ConduitServerConfig
): Promise<ReadTool.DiffResultItem> {
    operationLogger.info(`Performing diff for sources: ${params.sources[0]} and ${params.sources[1]}`);
    const [source1Path, source2Path] = params.sources;

    try {
        // 1. Validate sources (exist, are files, are text files)
        for (const filePath of [source1Path, source2Path]) {
            const stats = await getStats(filePath);
            if (!stats || stats.isDirectory()) {
                return createErrorDiffResultItem(ErrorCode.ERR_FS_NOT_FILE, `Source is not a file or does not exist: ${filePath}`);
            }
            const mimeType = await getMimeType(filePath);
            // Allow diffing any file that's not explicitly binary, or if mime type is unknown assume text for diff.
            // More restrictive check:
            if (mimeType && !mimeType.startsWith('text/') && !mimeType.includes('json') && !mimeType.includes('xml') && !mimeType.includes('script')) {
                 return createErrorDiffResultItem(ErrorCode.ERR_UNSUPPORTED_CONTENT_TYPE, `Source is not a text-based file: ${filePath} (MIME: ${mimeType})`);
            }
        }

        // 2. Read file contents
        const content1 = await readFileAsBuffer(source1Path, config.maxFileReadBytes);
        const content2 = await readFileAsBuffer(source2Path, config.maxFileReadBytes);

        const strContent1 = content1.toString('utf8');
        const strContent2 = content2.toString('utf8');

        // 3. Perform diff (using unified diff format)
        const diffOutput = diff.createTwoFilesPatch(
            source1Path, 
            source2Path, 
            strContent1, 
            strContent2,
            '', // oldHeader (optional)
            '', // newHeader (optional)
            { context: 3 } // Number of context lines, hardcoded to 3
        );

        return {
            sources_compared: [source1Path, source2Path],
            status: 'success',
            diff_format_used: 'unified', // Changed from 'text' to 'unified'
            diff_content: diffOutput,
        } as ReadTool.DiffResultSuccess; // Ensures it matches the success type

    } catch (error: any) {
        operationLogger.error(`Error in getDiff for ${source1Path} vs ${source2Path}:`, error);
        if (error instanceof ConduitError) {
            return createErrorDiffResultItem(error.errorCode, error.message);
        }
         if (error.code === 'ENOENT') {
            // Error message from readFileAsBuffer or getStats should be specific enough
            return createErrorDiffResultItem(ErrorCode.ERR_FS_NOT_FOUND, error.message || `File not found. One or both of ${source1Path}, ${source2Path} could not be accessed.`);
        }
        return createErrorDiffResultItem(ErrorCode.ERR_INTERNAL_SERVER_ERROR, error.message || 'An unexpected error occurred during diff operation.');
    }
} 