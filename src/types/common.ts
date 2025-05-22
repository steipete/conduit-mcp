/**
 * Represents information about a file or directory entry.
 */
export interface EntryInfo {
  name: string; // Filename or directory name
  path: string; // Full absolute path to the entry
  type: 'file' | 'directory' | 'symlink' | 'other'; // Type of the entry, now including symlink and other
  size_bytes?: number; // Size of the file. For directories, see specific tool docs.
  mime_type?: string; // For type: "file", detected MIME type
  created_at: string; // ISO 8601 UTC timestamp of creation (renamed from created_at_iso)
  modified_at: string; // ISO 8601 UTC timestamp of last modification (renamed from modified_at_iso)
  last_accessed_at?: string; // ISO 8601 UTC timestamp of last access (optional)
  is_readonly?: boolean; // True if the file is considered read-only for the server process (optional)
  symlink_target?: string; // For type: "symlink", the target path of the symlink (optional)
  permissions_octal?: string; // e.g., "0755"
  permissions_string?: string; // e.g., "rwxr-xr-x"
  children?: EntryInfo[]; // For list.entries with recursion
  recursive_size_calculation_note?: string; // For list.entries with calculate_recursive_size
  created_at_iso?: string;
  modified_at_iso?: string;
}

/**
 * Represents a generic error object structure used in MCP responses.
 */
export interface MCPError {
  error_code: string;
  error_message: string;
}

/**
 * Represents a generic successful operation status.
 */
export interface MCPSuccess {
  status: 'success';
  message?: string; // Optional success message
}

/**
 * Represents a generic error operation status.
 */
export interface MCPErrorStatus {
  status: 'error';
  error_code: string;
  error_message: string;
}

/**
 * Represents a generic result item in a batch operation or a single operation response.
 */
export type MCPResult<TSuccessPayload = Record<string, unknown>> =
  | (MCPSuccess & TSuccessPayload)
  | MCPErrorStatus;

/**
 * Base for tool responses that might be an array of results or a single result object.
 * Also accounts for the potential prepended informational notice.
 */
export type MCPToolResponse<T> = T | T[] | [InfoNotice, T] | [InfoNotice, ...T[]];

/**
 * Structure for the one-time informational notice.
 */
export interface InfoNotice {
  type: 'info_notice';
  notice_code: 'DEFAULT_PATHS_USED';
  message: string;
  details: {
    server_version: string;
    server_start_time_iso: string;
    default_paths_used: string[];
  };
}

export enum ErrorCode {
  // General Errors
  UNKNOWN_ERROR = 'ERR_UNKNOWN',
  NOT_IMPLEMENTED = 'ERR_NOT_IMPLEMENTED',
  INTERNAL_ERROR = 'ERR_INTERNAL',
  INVALID_PARAMETER = 'ERR_INVALID_PARAMETER',
  MISSING_PARAMETER = 'ERR_MISSING_PARAMETER',
  OPERATION_FAILED = 'ERR_OPERATION_FAILED',
  OPERATION_TIMEOUT = 'ERR_OPERATION_TIMEOUT',
  UNSUPPORTED_OPERATION = 'ERR_UNSUPPORTED_OPERATION',
  ACCESS_DENIED = 'ERR_ACCESS_DENIED',
  RESOURCE_NOT_FOUND = 'ERR_RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'ERR_RESOURCE_ALREADY_EXISTS',
  RESOURCE_LIMIT_EXCEEDED = 'ERR_RESOURCE_LIMIT_EXCEEDED',
  AUTHENTICATION_FAILED = 'ERR_AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'ERR_AUTHORIZATION_FAILED',
  NETWORK_ERROR = 'ERR_NETWORK_ERROR',
  CONNECTION_REFUSED = 'ERR_CONNECTION_REFUSED',
  DNS_LOOKUP_FAILED = 'ERR_DNS_LOOKUP_FAILED',
  TOO_MANY_REQUESTS = 'ERR_TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE = 'ERR_SERVICE_UNAVAILABLE',
  BAD_GATEWAY = 'ERR_BAD_GATEWAY',
  GATEWAY_TIMEOUT = 'ERR_GATEWAY_TIMEOUT',
  REQUEST_PAYLOAD_TOO_LARGE = 'ERR_REQUEST_PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'ERR_UNSUPPORTED_MEDIA_TYPE',

  // --- ERR_ Prefixed Specific Errors ---
  // File System & IO Errors (Standardized to ERR_ prefix)
  ERR_FS_NOT_FOUND = 'ERR_FS_NOT_FOUND',
  ERR_FS_ALREADY_EXISTS = 'ERR_FS_ALREADY_EXISTS',
  ERR_FS_READ_FAILED = 'ERR_FS_READ_FAILED',
  ERR_FS_WRITE_FAILED = 'ERR_FS_WRITE_FAILED',
  ERR_FS_DELETE_FAILED = 'ERR_FS_DELETE_FAILED',
  ERR_FS_COPY_FAILED = 'ERR_FS_COPY_FAILED',
  ERR_FS_MOVE_FAILED = 'ERR_FS_MOVE_FAILED',
  ERR_FS_MOVE_TARGET_IS_DIR = 'ERR_FS_MOVE_TARGET_IS_DIR',
  ERR_FS_DESTINATION_EXISTS = 'ERR_FS_DESTINATION_EXISTS',
  ERR_FS_COPY_TARGET_IS_DIR = 'ERR_FS_COPY_TARGET_IS_DIR',
  ERR_FS_DIR_NOT_FOUND = 'ERR_FS_DIR_NOT_FOUND',
  ERR_FS_DIR_ALREADY_EXISTS = 'ERR_FS_DIR_ALREADY_EXISTS',
  ERR_FS_DIR_CREATE_FAILED = 'ERR_FS_DIR_CREATE_FAILED',
  ERR_FS_DIR_DELETE_FAILED = 'ERR_FS_DIR_DELETE_FAILED',
  ERR_FS_DIR_LIST_FAILED = 'ERR_FS_DIR_LIST_FAILED',
  ERR_FS_DIR_NOT_EMPTY = 'ERR_FS_DIR_NOT_EMPTY',
  ERR_FS_PATH_IS_FILE = 'ERR_FS_PATH_IS_FILE',
  ERR_FS_PATH_IS_DIR = 'ERR_FS_PATH_IS_DIR',
  ERR_FS_INVALID_PATH = 'ERR_FS_INVALID_PATH',
  ERR_FS_PERMISSION_DENIED = 'ERR_FS_PERMISSION_DENIED',
  ERR_FS_BAD_ALLOWED_PATH = 'ERR_FS_BAD_ALLOWED_PATH',
  ERR_FS_PATH_RESOLUTION_FAILED = 'ERR_FS_PATH_RESOLUTION_FAILED',

  // Read/Get Content Specific Errors (Standardized to ERR_ prefix)
  ERR_INVALID_ENCODING = 'ERR_INVALID_ENCODING',
  ERR_INVALID_CHECKSUM = 'ERR_INVALID_CHECKSUM',
  ERR_INVALID_BYTE_RANGE = 'ERR_INVALID_BYTE_RANGE',
  ERR_CONTENT_TOO_LARGE = 'ERR_CONTENT_TOO_LARGE',
  ERR_UNSUPPORTED_MIME_TYPE = 'ERR_UNSUPPORTED_MIME_TYPE',
  ERR_IMAGE_PROCESSING_FAILED = 'ERR_IMAGE_PROCESSING_FAILED',
  ERR_HTML_CLEANING_FAILED = 'ERR_HTML_CLEANING_FAILED',
  ERR_MARKDOWN_CONVERSION_FAILED = 'ERR_MARKDOWN_CONVERSION_FAILED',
  ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED = 'ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED',
  ERR_CANNOT_REPRESENT_BINARY_AS_TEXT = 'ERR_CANNOT_REPRESENT_BINARY_AS_TEXT',

  // Write/Put Content Specific Errors (Standardized to ERR_ prefix)
  ERR_CANNOT_OVERWRITE_FILE = 'ERR_CANNOT_OVERWRITE_FILE',
  ERR_INVALID_WRITE_MODE = 'ERR_INVALID_WRITE_MODE',
  ERR_FS_TOUCH_FAILED = 'ERR_FS_TOUCH_FAILED',

  // Diff Specific Errors (Standardized to ERR_ prefix)
  ERR_DIFF_TARGET_NOT_TEXT = 'ERR_DIFF_TARGET_NOT_TEXT',
  ERR_DIFF_FAILED = 'ERR_DIFF_FAILED',

  // Archive Specific Errors (Standardized to ERR_ prefix)
  ERR_ARCHIVE_CREATION_FAILED = 'ERR_ARCHIVE_CREATION_FAILED',
  ERR_ARCHIVE_EXTRACTION_FAILED = 'ERR_ARCHIVE_EXTRACTION_FAILED',
  ERR_ARCHIVE_FORMAT_NOT_SUPPORTED = 'ERR_ARCHIVE_FORMAT_NOT_SUPPORTED',
  ERR_ARCHIVE_INVALID_PATH_IN_ARCHIVE = 'ERR_ARCHIVE_INVALID_PATH_IN_ARCHIVE',
  ERR_ARCHIVE_NO_SOURCES = 'ERR_ARCHIVE_NO_SOURCES',
  ERR_ARCHIVE_READ_FAILED = 'ERR_ARCHIVE_READ_FAILED',
  ERR_UNARCHIVE_FAILED = 'ERR_UNARCHIVE_FAILED',
  ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT = 'ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT',
  ERR_ARCHIVE_NOT_FOUND = 'ERR_ARCHIVE_NOT_FOUND',

  // Find Specific Errors (Standardized to ERR_ prefix)
  ERR_FIND_INVALID_CRITERIA = 'ERR_FIND_INVALID_CRITERIA',

  // Test Tool Specific Errors
  TEST_ASSERTION_FAILED = 'ERR_TEST_ASSERTION_FAILED',

  // General MCP/Request Errors (Standardized to ERR_ prefix)
  ERR_MCP_INVALID_REQUEST = 'ERR_MCP_INVALID_REQUEST',
  ERR_UNKNOWN_TOOL = 'ERR_UNKNOWN_TOOL',
  ERR_UNKNOWN_OPERATION_ACTION = 'ERR_UNKNOWN_OPERATION_ACTION',
  ERR_MISSING_ENTRIES_FOR_BATCH = 'ERR_MISSING_ENTRIES_FOR_BATCH',
  ERR_INVALID_PARAMS = 'ERR_INVALID_PARAMS',

  // Configuration & Initialization Errors (Standardized to ERR_ prefix)
  ERR_CONFIG_INVALID = 'ERR_CONFIG_INVALID',

  // URL/HTTP Errors (Standardized to ERR_ prefix)
  ERR_HTTP_INVALID_URL = 'ERR_HTTP_INVALID_URL',
  ERR_HTTP_REQUEST_FAILED = 'ERR_HTTP_REQUEST_FAILED',
  ERR_HTTP_TIMEOUT = 'ERR_HTTP_TIMEOUT',
  ERR_HTTP_STATUS_ERROR = 'ERR_HTTP_STATUS_ERROR',
  ERR_HTTP_RANGE_NOT_SATISFIABLE = 'ERR_HTTP_RANGE_NOT_SATISFIABLE',
  ERR_HTTP_EMPTY_RESPONSE = 'ERR_HTTP_EMPTY_RESPONSE',

  // Limit/Constraint Errors (Standardized to ERR_ prefix)
  ERR_RECURSIVE_OPERATION_TOO_DEEP = 'ERR_RECURSIVE_OPERATION_TOO_DEEP',
  ERR_RECURSIVE_SIZE_TIMEOUT = 'ERR_RECURSIVE_SIZE_TIMEOUT',

  // Server Errors (Standardized to ERR_ prefix)
  ERR_INTERNAL_SERVER_ERROR = 'ERR_INTERNAL_SERVER_ERROR',
  ERR_UNSUPPORTED_IMAGE_TYPE = 'ERR_UNSUPPORTED_IMAGE_TYPE',
  ERR_INVALID_BASE64 = 'ERR_INVALID_BASE64',
  ERR_UNSUPPORTED_CHECKSUM_ALGORITHM = 'ERR_UNSUPPORTED_CHECKSUM_ALGORITHM',
  ERR_CHECKSUM_FAILED = 'ERR_CHECKSUM_FAILED',
}

/**
 * Status of range request processing for content fetching operations.
 */
export type RangeRequestStatus =
  | 'native'
  | 'simulated'
  | 'full_content_returned'
  | 'not_supported'
  | 'not_applicable_offset_oob';

/**
 * Represents content fetched from a web URL with metadata.
 */
export interface FetchedContent {
  finalUrl: string;
  httpStatus: number;
  headers: Record<string, string | string[] | undefined>;
  mimeType?: string; // From Content-Type header, processed
  content: Buffer | null; // Raw body as Buffer, or null if metadata request or error
  range_request_status?: RangeRequestStatus;
  size_bytes?: number; // Actual size of the content buffer returned
}
