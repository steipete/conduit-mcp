import {
  ReadTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  MCPErrorStatus,
  formatToISO8601UTC,
  fileSystemOps, // Namespace for fileSystemOps functions
  webFetcher, // Namespace for webFetcher functions
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
  operationLogger.debug(
    `Getting metadata for source: ${source} with params: ${JSON.stringify(params)}`
  );
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
      return createErrorMetadataResultItem(
        source,
        sourceType,
        error.errorCode,
        error.message,
        error instanceof ConduitError && 'httpStatus' in error
          ? (error as ConduitError & { httpStatus: number }).httpStatus
          : undefined
      );
    }
    return createErrorMetadataResultItem(
      source,
      sourceType,
      ErrorCode.ERR_INTERNAL_SERVER_ERROR,
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred during metadata retrieval.'
    );
  }
}

async function getMetadataFromFile(
  filePath: string,
  _params: ReadTool.MetadataParams,
  _config: ConduitServerConfig
): Promise<ReadTool.MetadataResultItem> {
  const operationLogger = logger.child({ operation: 'getMetadataFromFile', path: filePath });
  operationLogger.info('Getting metadata from file');

  let resolvedValidatedPath: string;
  try {
    // Validate and resolve the path first
    resolvedValidatedPath = await validateAndResolvePath(filePath, {
      isExistenceRequired: true, // Existence is required for reading metadata
      checkAllowed: true, // Ensure it's an allowed path
    });
    operationLogger.debug(`Path validated and resolved: ${filePath} -> ${resolvedValidatedPath}`);
  } catch (validationError) {
    // If validation fails, return that error
    operationLogger.warn(`Path validation failed for ${filePath}:`, validationError);
    if (validationError instanceof ConduitError) {
      return createErrorMetadataResultItem(
        filePath,
        'file',
        validationError.errorCode,
        validationError.message
      );
    }
    return createErrorMetadataResultItem(
      filePath,
      'file',
      ErrorCode.ERR_FS_INVALID_PATH, // Generic fallback if not ConduitError
      validationError instanceof Error ? validationError.message : 'Path validation failed'
    );
  }

  try {
    const stats = await fileSystemOps.getLstats(resolvedValidatedPath);
    if (!stats) {
      return createErrorMetadataResultItem(
        resolvedValidatedPath,
        'file',
        ErrorCode.ERR_FS_NOT_FOUND,
        `File not found or not accessible: ${resolvedValidatedPath}`
      );
    }
    const entryInfo = await fileSystemOps.createEntryInfo(
      resolvedValidatedPath,
      stats,
      path.basename(resolvedValidatedPath)
    );

    const metadata: ReadTool.Metadata = {
      name: entryInfo.name,
      entry_type: entryInfo.type,
      size_bytes: entryInfo.size_bytes,
      mime_type: entryInfo.mime_type,
      created_at: entryInfo.created_at,
      modified_at: entryInfo.modified_at,
      permissions_octal: entryInfo.permissions_octal,
      permissions_string: entryInfo.permissions_string,
    };

    return {
      status: 'success',
      source: resolvedValidatedPath,
      source_type: 'file',
      metadata: metadata,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    operationLogger.error(
      `Error getting metadata for file ${resolvedValidatedPath}: ${errorMessage}`
    );
    if (error instanceof ConduitError) {
      if (
        error.errorCode === ErrorCode.ACCESS_DENIED ||
        error.errorCode === ErrorCode.ERR_FS_PERMISSION_DENIED
      ) {
        return createErrorMetadataResultItem(
          resolvedValidatedPath,
          'file',
          ErrorCode.ERR_FS_PERMISSION_DENIED,
          `Permission denied to access metadata for: ${resolvedValidatedPath}`
        );
      }
      return createErrorMetadataResultItem(
        resolvedValidatedPath,
        'file',
        error.errorCode,
        error.message
      );
    }
    return createErrorMetadataResultItem(
      resolvedValidatedPath,
      'file',
      ErrorCode.OPERATION_FAILED,
      `Failed to get metadata for file: ${resolvedValidatedPath}. ${errorMessage}`
    );
  }
}

async function getMetadataFromUrl(
  urlString: string,
  _params: ReadTool.MetadataParams,
  _config: ConduitServerConfig
): Promise<ReadTool.MetadataResultItem> {
  const operationLogger = logger.child({ component: 'metadataOps' });
  operationLogger.info(`Fetching metadata for URL: ${urlString}`);
  try {
    const fetched = await webFetcher.fetchUrlContent(urlString, true, undefined);

    const metadata: ReadTool.Metadata = {
      name: urlString.substring(urlString.lastIndexOf('/') + 1) || urlString,
      entry_type: 'url',
      size_bytes: fetched.headers['content-length']
        ? parseInt(fetched.headers['content-length'] as string, 10)
        : undefined,
      mime_type: fetched.mimeType,
      modified_at: fetched.headers['last-modified']
        ? formatToISO8601UTC(new Date(fetched.headers['last-modified'] as string))
        : undefined,
      http_headers: Object.entries(fetched.headers).reduce(
        (acc, [key, value]) => {
          if (value === undefined || value === null) {
            acc[key.toLowerCase()] = undefined;
          } else if (Array.isArray(value)) {
            acc[key.toLowerCase()] = value.map(String);
          } else {
            acc[key.toLowerCase()] = String(value);
          }
          return acc;
        },
        {} as Record<string, string | string[] | undefined>
      ),
    };

    return {
      source: urlString,
      source_type: 'url',
      status: 'success',
      http_status_code: fetched.httpStatus,
      metadata,
      final_url: fetched.finalUrl !== urlString ? fetched.finalUrl : undefined,
    };
  } catch (error: unknown) {
    operationLogger.error(`Error fetching metadata for URL ${urlString}:`, error);
    const httpStatus =
      error instanceof ConduitError && 'httpStatus' in error
        ? (error as ConduitError & { httpStatus: number }).httpStatus
        : undefined;
    if (error instanceof ConduitError) {
      return createErrorMetadataResultItem(
        urlString,
        'url',
        error.errorCode,
        error.message,
        httpStatus
      );
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // General catch-all if not a ConduitError (e.g. network issue not caught by fetchUrlContent's ConduitError wrapping)
    return createErrorMetadataResultItem(
      urlString,
      'url',
      ErrorCode.ERR_HTTP_REQUEST_FAILED,
      `Failed to get metadata for URL: ${urlString}. ${errorMessage}`,
      httpStatus
    );
  }
}
