/**
 * Represents information about a file or directory entry.
 */
export interface EntryInfo {
  name: string;                   // Filename or directory name
  path: string;                   // Full absolute path to the entry
  type: 'file' | 'directory';     // Type of the entry
  size_bytes?: number;            // Size of the file. For directories, see specific tool docs.
  mime_type?: string;             // For type: "file", detected MIME type
  created_at_iso: string;         // ISO 8601 UTC timestamp of creation
  modified_at_iso: string;        // ISO 8601 UTC timestamp of last modification
  permissions_octal?: string;     // e.g., "0755"
  permissions_string?: string;    // e.g., "rwxr-xr-x"
  children?: EntryInfo[];         // For list.entries with recursion
  recursive_size_calculation_note?: string; // For list.entries with calculate_recursive_size
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
  (MCPSuccess & TSuccessPayload) | MCPErrorStatus;


/**
 * Base for tool responses that might be an array of results or a single result object.
 * Also accounts for the potential prepended informational notice.
 */
export type MCPToolResponse<T> = T | T[] | [InfoNotice, T] | [InfoNotice, ...T[]];

/**
 * Structure for the one-time informational notice.
 */
export interface InfoNotice {
  type: "info_notice";
  notice_code: "DEFAULT_PATHS_USED";
  message: string;
  details: {
    server_version: string;
    server_start_time_iso: string;
    default_paths_used: string[];
  };
} 