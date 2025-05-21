import { MCPError, MCPErrorStatus } from '@/types/common';

// Appendix A: Error Codes from the specification
export enum ErrorCode {
  // General MCP/Request Errors
  ERR_MCP_INVALID_REQUEST = 'ERR_MCP_INVALID_REQUEST',
  ERR_UNKNOWN_TOOL = 'ERR_UNKNOWN_TOOL',
  ERR_UNKNOWN_OPERATION_ACTION = 'ERR_UNKNOWN_OPERATION_ACTION',
  ERR_INVALID_PARAMETER = 'ERR_INVALID_PARAMETER',
  ERR_MISSING_ENTRIES_FOR_BATCH = 'ERR_MISSING_ENTRIES_FOR_BATCH',

  // Configuration & Initialization Errors
  ERR_CONFIG_INVALID = 'ERR_CONFIG_INVALID',
  ERR_FS_BAD_ALLOWED_PATH = 'ERR_FS_BAD_ALLOWED_PATH',

  // Filesystem Errors
  ERR_FS_ACCESS_DENIED = 'ERR_FS_ACCESS_DENIED',
  ERR_FS_PATH_RESOLUTION_FAILED = 'ERR_FS_PATH_RESOLUTION_FAILED',
  ERR_FS_NOT_FOUND = 'ERR_FS_NOT_FOUND',
  ERR_FS_IS_FILE = 'ERR_FS_IS_FILE',
  ERR_FS_IS_DIRECTORY = 'ERR_FS_IS_DIRECTORY',
  ERR_FS_ALREADY_EXISTS = 'ERR_FS_ALREADY_EXISTS',
  ERR_FS_READ_FAILED = 'ERR_FS_READ_FAILED',
  ERR_FS_WRITE_FAILED = 'ERR_FS_WRITE_FAILED',
  ERR_FS_DELETE_FAILED = 'ERR_FS_DELETE_FAILED',
  ERR_FS_OPERATION_FAILED = 'ERR_FS_OPERATION_FAILED',
  ERR_FS_BAD_PATH_INPUT = 'ERR_FS_BAD_PATH_INPUT',

  // URL/HTTP Errors
  ERR_HTTP_INVALID_URL = 'ERR_HTTP_INVALID_URL',
  ERR_HTTP_REQUEST_FAILED = 'ERR_HTTP_REQUEST_FAILED',
  ERR_HTTP_TIMEOUT = 'ERR_HTTP_TIMEOUT',
  ERR_HTTP_STATUS_ERROR = 'ERR_HTTP_STATUS_ERROR',
  ERR_HTTP_RANGE_NOT_SATISFIABLE = 'ERR_HTTP_RANGE_NOT_SATISFIABLE',

  // Content Processing & Formatting Errors
  ERR_INVALID_BASE64 = 'ERR_INVALID_BASE64',
  ERR_MARKDOWN_CONVERSION_FAILED = 'ERR_MARKDOWN_CONVERSION_FAILED',
  ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED = 'ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED',
  ERR_IMAGE_PROCESSING_FAILED = 'ERR_IMAGE_PROCESSING_FAILED',
  ERR_UNSUPPORTED_IMAGE_TYPE = 'ERR_UNSUPPORTED_IMAGE_TYPE',
  ERR_CHECKSUM_FAILED = 'ERR_CHECKSUM_FAILED',
  ERR_UNSUPPORTED_CHECKSUM_ALGORITHM = 'ERR_UNSUPPORTED_CHECKSUM_ALGORITHM',
  ERR_DIFF_FAILED = 'ERR_DIFF_FAILED',
  ERR_CANNOT_REPRESENT_BINARY_AS_TEXT = 'ERR_CANNOT_REPRESENT_BINARY_AS_TEXT',

  // Archive Errors
  ERR_ARCHIVE_CREATION_FAILED = 'ERR_ARCHIVE_CREATION_FAILED',
  ERR_ARCHIVE_EXTRACTION_FAILED = 'ERR_ARCHIVE_EXTRACTION_FAILED',
  ERR_ARCHIVE_READ_FAILED = 'ERR_ARCHIVE_READ_FAILED',
  ERR_UNARCHIVE_FAILED = 'ERR_UNARCHIVE_FAILED',
  ERR_UNSUPPORTED_ARCHIVE_FORMAT = 'ERR_UNSUPPORTED_ARCHIVE_FORMAT',
  ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT = 'ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT',
  ERR_ARCHIVE_PATH_INVALID = 'ERR_ARCHIVE_PATH_INVALID',
  ERR_ARCHIVE_NOT_FOUND = 'ERR_ARCHIVE_NOT_FOUND',
  ERR_INVALID_PARAMS = 'ERR_INVALID_PARAMS',

  // Limit/Constraint Errors
  ERR_RESOURCE_LIMIT_EXCEEDED = 'ERR_RESOURCE_LIMIT_EXCEEDED',
  ERR_RECURSIVE_OPERATION_TOO_DEEP = 'ERR_RECURSIVE_OPERATION_TOO_DEEP',
  ERR_RECURSIVE_SIZE_TIMEOUT = 'ERR_RECURSIVE_SIZE_TIMEOUT',

  // Server Errors
  ERR_INTERNAL_SERVER_ERROR = 'ERR_INTERNAL_SERVER_ERROR',
  ERR_NOT_IMPLEMENTED = 'ERR_NOT_IMPLEMENTED',
}

export { MCPErrorStatus };

/**
 * Creates a standardized MCP error object.
 * @param errorCode The unique error code.
 * @param message A descriptive human-readable error message.
 * @returns MCPError object.
 */
export function createMCPError(errorCode: ErrorCode, message: string): MCPError {
  return {
    error_code: errorCode,
    error_message: message,
  };
}

/**
 * Creates a standardized MCP error status object for tool responses.
 * @param errorCode The unique error code.
 * @param message A descriptive human-readable error message.
 * @returns MCPErrorStatus object.
 */
export function createMCPErrorStatus(errorCode: ErrorCode, message: string): MCPErrorStatus {
  return {
    status: 'error',
    error_code: errorCode,
    error_message: message,
  };
}

/**
 * Utility class for throwing standardized Conduit errors.
 */
export class ConduitError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly MCPPErrorStatus: MCPErrorStatus;

  constructor(errorCode: ErrorCode, message?: string) {
    const fullMessage = message || `Conduit operation failed with code: ${errorCode}`;
    super(fullMessage);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.MCPPErrorStatus = createMCPErrorStatus(errorCode, fullMessage);
    Error.captureStackTrace(this, this.constructor);
  }
} 