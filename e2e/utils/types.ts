// E2E Test Types

// BufferEncoding type definition for Node.js
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

// Tool response types
export interface BaseToolResponse {
  tool_name: string;
  status?: 'success' | 'error';
  error_code?: string;
  error_message?: string;
}

// List tool specific types
export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size_bytes?: number;
  modified?: string;
  created?: string;
  mode?: string;
  target?: string;
}

export interface ListToolResponse extends BaseToolResponse {
  tool_name: 'list';
  results?:
    | DirectoryEntry[]
    | {
        entries: DirectoryEntry[];
        total_size?: number;
        [key: string]: unknown;
      };
}

export interface ListCapabilitiesResponse extends BaseToolResponse {
  tool_name: 'list';
  results?: {
    server_version: string;
    active_configuration: {
      HTTP_TIMEOUT_MS: number;
      MAX_PAYLOAD_SIZE_BYTES: number;
      MAX_FILE_READ_BYTES: number;
      MAX_URL_DOWNLOAD_BYTES: number;
      IMAGE_COMPRESSION_THRESHOLD_BYTES: number;
      IMAGE_COMPRESSION_QUALITY: number;
      ALLOWED_PATHS: string[];
      DEFAULT_CHECKSUM_ALGORITHM: string;
      MAX_RECURSIVE_DEPTH: number;
      RECURSIVE_SIZE_TIMEOUT_MS: number;
      [key: string]: unknown;
    };
    supported_checksum_algorithms: string[];
    supported_archive_formats: string[];
    default_checksum_algorithm: string;
    max_recursive_depth: number;
    [key: string]: unknown;
  };
}

export interface ListFilesystemStatsResponse extends BaseToolResponse {
  tool_name: 'list';
  results?: {
    path_queried: string;
    total_bytes: number;
    free_bytes: number;
    available_bytes: number;
    used_bytes: number;
    [key: string]: unknown;
  };
}

// Find tool specific types
export interface FindResultItem {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  name: string;
  size_bytes?: number;
  created_at?: string;
  modified_at?: string;
  matched_on?: string;
  line_number?: number;
  line_preview?: string;
  match_count?: number;
}

export interface FindToolResponse extends BaseToolResponse {
  tool_name: 'find';
  results?: FindResultItem[];
}

// Read tool specific types
export interface ReadResultItem {
  path: string;
  content?: string;
  content_bytes?: number[];
  content_base64?: string;
  content_type?: string;
  encoding?: string;
  checksum?: string;
  file_size?: number;
  created_at?: string;
  modified_at?: string;
  accessed_at?: string;
  mode?: string;
  is_binary?: boolean;
  is_executable?: boolean;
}

export interface ReadToolResponse extends BaseToolResponse {
  tool_name: 'read';
  results?: ReadResultItem[];
}

// Write tool specific types
export interface WriteResultItem {
  path: string;
  status: 'created' | 'updated';
  previous_size?: number;
  new_size: number;
  checksum?: string;
  backup_path?: string;
}

export interface WriteToolResponse extends BaseToolResponse {
  tool_name: 'write';
  results?: WriteResultItem[];
}

// Test tool specific types
export interface TestToolResponse extends BaseToolResponse {
  tool_name: 'test';
  results?: {
    status: string;
    echoed_params?: unknown;
    [key: string]: unknown;
  };
}

// Union type for all tool responses
export type ToolResponse =
  | ListToolResponse
  | ListCapabilitiesResponse
  | ListFilesystemStatsResponse
  | FindToolResponse
  | ReadToolResponse
  | WriteToolResponse
  | TestToolResponse
  | BaseToolResponse;

// Notice type
export interface InfoNotice {
  type: 'info_notice';
  notice_code: string;
  message?: string;
  details?: Record<string, unknown>;
}

// Combined response type (can be tool response or array with notice)
export type E2EResponse = ToolResponse | [InfoNotice, ToolResponse];

// Test scenario types with proper typing
export interface SetupFile {
  path: string;
  content?: string;
  content_type?: string;
  base_dir?: string;
  encoding?: BufferEncoding;
  archive_type?: string;
  entries?: Array<{
    path: string;
    content?: string;
  }>;
}

export interface ScenarioAssertion {
  type: string;
  name?: string;
  path?: string;
  expected_content?: string;
  should_exist?: boolean;
  archive_path?: string;
  expected_entries?: string[];
  setup_path?: string;
  comment?: string;
  [key: string]: unknown;
}

export interface ExpectedStdout {
  tool_name: string;
  status?: string;
  error_code?: string;
  error_message?: string;
  results?: unknown;
  [key: string]: unknown;
}

// Helper type guards
export function isInfoNotice(obj: unknown): obj is InfoNotice {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'info_notice'
  );
}

export function isToolResponse(obj: unknown): obj is ToolResponse {
  return typeof obj === 'object' && obj !== null && 'tool_name' in obj;
}

export function isNoticeResponse(response: unknown): response is [InfoNotice, ToolResponse] {
  return (
    Array.isArray(response) &&
    response.length === 2 &&
    isInfoNotice(response[0]) &&
    isToolResponse(response[1])
  );
}

// Type assertion helpers
export function assertListToolResponse(response: unknown): asserts response is ListToolResponse {
  if (!isToolResponse(response) || response.tool_name !== 'list') {
    throw new Error('Response is not a ListToolResponse');
  }
}

export function assertFindToolResponse(response: unknown): asserts response is FindToolResponse {
  if (!isToolResponse(response) || response.tool_name !== 'find') {
    throw new Error('Response is not a FindToolResponse');
  }
}

export function assertReadToolResponse(response: unknown): asserts response is ReadToolResponse {
  if (!isToolResponse(response) || response.tool_name !== 'read') {
    throw new Error('Response is not a ReadToolResponse');
  }
}

export function assertWriteToolResponse(response: unknown): asserts response is WriteToolResponse {
  if (!isToolResponse(response) || response.tool_name !== 'write') {
    throw new Error('Response is not a WriteToolResponse');
  }
}
