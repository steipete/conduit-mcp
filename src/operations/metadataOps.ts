import { 
    ReadTool, 
    ConduitServerConfig, 
    ConduitError, 
    ErrorCode, 
    MCPErrorStatus, 
    formatToISO8601UTC, 
    getMimeType, 
    fileSystemOps, // Namespace for fileSystemOps functions
    webFetcher,     // Namespace for webFetcher functions
    logger,
    validateAndResolvePath, // Added validateAndResolvePath
} from '@/internal';
// import logger from '@/utils/logger'; // Direct import
import * as path from 'path';

// const operationLogger = logger.child({ component: 'metadataOps' });

interface BaseResultForError {
    source: string;
    source_type: 'file' | 'url';
    http_status_code?: number;
}

// This function might be centralized if used by getContentOps as well
function createErrorMetadataResultItem(
    source: string,
    source_type: 'file' | 'url',
    errorCode: ErrorCode,
    errorMessage: string,
    http_status_code?: number
): ReadTool.MetadataResultItem {
    const errorResult: MCPErrorStatus & BaseResultForError = {
        source,
        source_type,
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
    };
    if (http_status_code !== undefined) {
        errorResult.http_status_code = http_status_code;
    }
    // Cast to MetadataResultItem, which includes the BaseResult fields via MCPErrorStatus union
    return errorResult as ReadTool.MetadataResultItem;
}


export async function getMetadata(
    source: string,
    params: ReadTool.MetadataParams, // These are the params for the metadata operation specifically
    config: ConduitServerConfig
): Promise<ReadTool.MetadataResultItem> {
    const operationLogger = logger.child({ component: 'metadataOps' });
    operationLogger.debug(`Getting metadata for source: ${source} with params: ${JSON.stringify(params)}`);
    try {
        const isUrl = source.startsWith('http://') || source.startsWith('https://');
        if (isUrl) {
            return await getMetadataFromUrl(source, params, config);
        } else {
            return await getMetadataFromFile(source, params, config);
        }
    } catch (error) {
        operationLogger.error(`Error in getMetadata for source ${source}:`, error);
        const sourceType = source.startsWith('http') ? 'url' : 'file';
        if (error instanceof ConduitError) {
            return createErrorMetadataResultItem(source, sourceType, error.errorCode, error.message, (error as any).httpStatus);
        }
        return createErrorMetadataResultItem(source, sourceType, ErrorCode.ERR_INTERNAL_SERVER_ERROR, error instanceof Error ? error.message : 'An unexpected error occurred during metadata retrieval.');
    }
}

async function getMetadataFromFile(
    filePath: string,
    params: ReadTool.MetadataParams,
    config: ConduitServerConfig
): Promise<ReadTool.MetadataResultItem> {
    const operationLogger = logger.child({ operation: 'getMetadataFromFile', path: filePath });
    operationLogger.info('Getting metadata from file');
    try {
        const resolvedPath = await validateAndResolvePath(filePath, { isExistenceRequired: true });
        const stats = await fileSystemOps.getLstats(resolvedPath);
        if (!stats) {
            return createErrorMetadataResultItem(filePath, 'file', ErrorCode.ERR_FS_NOT_FOUND, `File not found or not accessible: ${filePath}`);
        }
        const entryInfo = await fileSystemOps.createEntryInfo(resolvedPath, stats, path.basename(resolvedPath));

        const metadata: ReadTool.Metadata = {
            name: entryInfo.name,
            entry_type: entryInfo.type,
            size_bytes: entryInfo.size_bytes,
            mime_type: entryInfo.mime_type,
            created_at_iso: entryInfo.created_at_iso,
            modified_at_iso: entryInfo.modified_at_iso,
            permissions_octal: entryInfo.permissions_octal,
            permissions_string: entryInfo.permissions_string,
        };

        return {
            status: 'success',
            source: filePath,
            source_type: 'file',
            metadata: metadata,
        };
    } catch (error: any) {
        operationLogger.error(`Error getting metadata for file ${filePath}: ${error.message}`);
        if (error instanceof ConduitError) {
            if (error.errorCode === ErrorCode.ACCESS_DENIED || error.errorCode === ErrorCode.ERR_FS_PERMISSION_DENIED) {
                return createErrorMetadataResultItem(filePath, 'file', ErrorCode.ERR_FS_PERMISSION_DENIED, `Permission denied to access metadata for: ${filePath}`);
            }
            return createErrorMetadataResultItem(filePath, 'file', error.errorCode, error.message);
        }
        return createErrorMetadataResultItem(filePath, 'file', ErrorCode.OPERATION_FAILED, `Failed to get metadata for file: ${filePath}. ${error.message}`);
    }
}

async function getMetadataFromUrl(
    urlString: string,
    params: ReadTool.MetadataParams,
    config: ConduitServerConfig
): Promise<ReadTool.MetadataResultItem> {
    const operationLogger = logger.child({ component: 'metadataOps' });
    operationLogger.info(`Fetching metadata for URL: ${urlString}`);
    try {
        const fetched = await webFetcher.fetchUrlContent(urlString, true, undefined);

        const metadata: ReadTool.Metadata = {
            name: urlString.substring(urlString.lastIndexOf('/') + 1) || urlString,
            entry_type: 'url',
            size_bytes: fetched.headers['content-length'] ? parseInt(fetched.headers['content-length'] as string, 10) : undefined,
            mime_type: fetched.mimeType,
            modified_at_iso: fetched.headers['last-modified'] ? formatToISO8601UTC(new Date(fetched.headers['last-modified'] as string)) : undefined,
            http_headers: Object.entries(fetched.headers).reduce((acc, [key, value]) => {
                if (value === undefined || value === null) {
                    acc[key.toLowerCase()] = undefined;
                } else if (Array.isArray(value)) {
                    acc[key.toLowerCase()] = value.map(String);
                } else {
                    acc[key.toLowerCase()] = String(value);
                }
                return acc;
            }, {} as Record<string, string | string[] | undefined>),
        };
        
        return {
            source: urlString,
            source_type: 'url',
            status: 'success',
            http_status_code: fetched.httpStatus,
            metadata,
            final_url: fetched.finalUrl !== urlString ? fetched.finalUrl : undefined,
        };

    } catch (error: any) {
        operationLogger.error(`Error fetching metadata for URL ${urlString}:`, error);
        const httpStatus = error instanceof ConduitError ? (error as any).httpStatus : undefined;
        if (error instanceof ConduitError) {
            return createErrorMetadataResultItem(urlString, 'url', error.errorCode, error.message, httpStatus);
        }
        // General catch-all if not a ConduitError (e.g. network issue not caught by fetchUrlContent's ConduitError wrapping)
        return createErrorMetadataResultItem(urlString, 'url', ErrorCode.ERR_HTTP_REQUEST_FAILED, `Failed to get metadata for URL: ${urlString}. ${error.message}`, httpStatus);
    }
} 