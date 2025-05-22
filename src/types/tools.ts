import {
  EntryInfo,
  MCPResult,
  InfoNotice,
  MCPToolResponse,
  MCPErrorStatus,
  MCPSuccess,
  RangeRequestStatus,
} from './common.js';
import { ErrorCode } from '@/internal';

// This file will be expanded with specific request and response types for each tool
// as they are implemented. For now, it re-exports common types useful for tools.

export { EntryInfo, MCPResult, InfoNotice, MCPToolResponse, MCPErrorStatus, MCPSuccess };

// Example structure for a tool's specific types (will be filled in later)
/*
export namespace ReadTool {
  export interface Parameters {
    sources: string[];
    operation: 'content' | 'metadata' | 'diff';
    // ... other parameters
  }

  export interface ContentResultSuccess extends MCPSuccess {
    source: string;
    source_type: 'file' | 'url';
    output_format_used: string;
    // ... other fields
  }
  export type ContentResult = ContentResultSuccess | MCPErrorStatus;

  export type Response = MCPToolResponse<ContentResult[] | SomeOtherResultType>;
}
*/

export namespace ReadTool {
  export type ReadOperation = 'content' | 'metadata' | 'diff';
  export type ContentFormat = 'text' | 'base64' | 'markdown' | 'checksum';
  export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';
  export type DiffFormat = 'unified';

  export interface BaseParams {
    sources: string[];
    operation: ReadOperation;
  }

  export interface ContentParams extends BaseParams {
    operation: 'content';
    format?: ContentFormat;
    checksum_algorithm?: ChecksumAlgorithm | string; // Allow string for broader compatibility, validation in handler
    offset?: number;
    length?: number;
  }

  export interface MetadataParams extends BaseParams {
    operation: 'metadata';
  }

  export interface DiffParams extends BaseParams {
    operation: 'diff';
    sources: [string, string]; // Exactly two sources for diff
    diff_format?: DiffFormat;
  }

  export type Parameters = ContentParams | MetadataParams | DiffParams;

  // --- Result Types ---
  interface BaseResult {
    source: string;
    source_type: 'file' | 'url';
    http_status_code?: number; // Added to make it available on error items
  }

  export interface ContentResultSuccess extends MCPSuccess, BaseResult {
    output_format_used: ContentFormat | 'text'; // 'text' if markdown fallback
    content?: string; // Text, base64, markdown, binary placeholder, or checksum string
    mime_type?: string;
    size_bytes?: number; // Size of content field for text/base64/markdown, or original for checksum
    original_size_bytes?: number; // If image compression applied
    compression_applied?: boolean;
    compression_error_note?: string;
    checksum?: string;
    checksum_algorithm_used?: ChecksumAlgorithm | string;
    range_request_status?: RangeRequestStatus;
    markdown_conversion_status?: 'success' | 'skipped_unsupported_content_type';
    markdown_conversion_skipped_reason?: string;
  }
  export type ContentResultItem = ContentResultSuccess | (MCPErrorStatus & BaseResult);

  export interface DefinedContentResponse {
    tool_name: 'read';
    results: ContentResultItem[];
    info_notices?: InfoNotice[];
  }

  export interface Metadata {
    name: string;
    entry_type: 'file' | 'directory' | 'symlink' | 'other' | 'url' | 'special';
    size_bytes?: number;
    mime_type?: string;
    created_at?: string;
    modified_at?: string;
    permissions_octal?: string;
    permissions_string?: string;
    http_headers?: Record<string, string | string[] | undefined>;
  }
  export interface MetadataResultSuccess extends MCPSuccess, BaseResult {
    http_status_code?: number; // For URL source
    metadata: Metadata;
    final_url?: string; // The final URL after any redirects
  }
  export type MetadataResultItem = MetadataResultSuccess | (MCPErrorStatus & BaseResult);

  export interface DefinedMetadataResponse {
    tool_name: 'read';
    results: MetadataResultItem[];
    info_notices?: InfoNotice[];
  }

  export interface DiffResultSuccess extends MCPSuccess {
    sources_compared: [string, string];
    diff_format_used: DiffFormat;
    diff_content: string;
  }
  export type DiffResult = DiffResultSuccess | MCPErrorStatus;

  export interface DefinedDiffResponse {
    tool_name: 'read';
    results: DiffResult; // Singular
    info_notices?: InfoNotice[];
  }
}

export namespace WriteTool {
  export type WriteAction =
    | 'put'
    | 'mkdir'
    | 'copy'
    | 'move'
    | 'delete'
    | 'touch'
    | 'archive'
    | 'unarchive';
  export type InputEncoding = 'text' | 'base64';
  export type WriteMode = 'overwrite' | 'append' | 'error_if_exists';
  export type ArchiveFormat = 'zip' | 'tar.gz' | 'tgz';

  // Entry types for batchable operations
  export interface PutEntry {
    path: string;
    content: string; // string, as Buffer cannot be in JSON. Base64 handled by input_encoding.
    input_encoding?: InputEncoding;
    write_mode?: WriteMode;
    checksum_algorithm?: string;
  }
  export interface MkdirEntry {
    path: string;
    recursive?: boolean;
  }
  export interface CopyEntry {
    source_path: string;
    destination_path: string;
  }
  export interface MoveEntry {
    source_path: string;
    destination_path: string;
  }
  export interface DeleteEntry {
    path: string;
    recursive?: boolean;
  }
  export interface TouchEntry {
    path: string;
  }

  // Base parameters for actions that use the 'entries' array
  export interface BaseBatchParams {
    action: 'put' | 'mkdir' | 'copy' | 'move' | 'delete' | 'touch';
    entries: Array<PutEntry | MkdirEntry | CopyEntry | MoveEntry | DeleteEntry | TouchEntry>;
  }

  // Specific parameter types for each action
  export interface PutParams extends BaseBatchParams {
    action: 'put';
    entries: PutEntry[];
  }
  export interface MkdirParams extends BaseBatchParams {
    action: 'mkdir';
    entries: MkdirEntry[];
  }
  export interface CopyParams extends BaseBatchParams {
    action: 'copy';
    entries: CopyEntry[];
  }
  export interface MoveParams extends BaseBatchParams {
    action: 'move';
    entries: MoveEntry[];
  }
  export interface DeleteParams extends BaseBatchParams {
    action: 'delete';
    entries: DeleteEntry[];
  }
  export interface TouchParams extends BaseBatchParams {
    action: 'touch';
    entries: TouchEntry[];
  }

  // Parameters for single operations (archive/unarchive)
  export interface ArchiveParams {
    action: 'archive';
    source_paths: string[];
    archive_path: string;
    format?: ArchiveFormat | string; // Allow string for broader compatibility
    recursive_source_listing?: boolean;
  }
  export interface UnarchiveParams {
    action: 'unarchive';
    archive_path: string;
    destination_path: string;
    format?: ArchiveFormat | string;
  }

  export type Parameters =
    | PutParams
    | MkdirParams
    | CopyParams
    | MoveParams
    | DeleteParams
    | TouchParams
    | ArchiveParams
    | UnarchiveParams;

  // --- Result Types ---
  interface BaseResult {
    action_performed: WriteAction;
    path?: string; // Primary path for put, mkdir, delete, touch, archive/unarchive target
    source_path?: string; // For copy, move
    destination_path?: string; // For copy, move, unarchive dest
  }

  export interface WriteResultSuccess extends MCPSuccess, BaseResult {
    bytes_written?: number; // For put
    checksum?: string;
    checksum_algorithm_used?: string;
    message?: string; // e.g., "Directory created."
    skipped_sources?: string[]; // For archive
    extracted_files_count?: number; // For unarchive
  }

  export type WriteResultItem = WriteResultSuccess | (MCPErrorStatus & BaseResult);

  export interface DefinedBatchResponse {
    tool_name: 'write';
    results: WriteResultItem[];
    info_notices?: InfoNotice[];
  }

  export type ArchiveActionResult = WriteResultSuccess | MCPErrorStatus; // For single archive/unarchive

  export interface DefinedArchiveResponse {
    tool_name: 'write';
    results: ArchiveTool.ArchiveResultItem[];
    info_notices?: InfoNotice[];
  }
}

export namespace ListTool {
  export type ListOperation = 'entries' | 'system_info';
  export type SystemInfoType = 'server_capabilities' | 'filesystem_stats';

  export interface BaseParams {
    operation: ListOperation;
  }

  export interface EntriesParams extends BaseParams {
    operation: 'entries';
    path: string;
    recursive_depth?: number;
    calculate_recursive_size?: boolean;
  }

  export interface SystemInfoParams extends BaseParams {
    operation: 'system_info';
    info_type: SystemInfoType;
    path?: string; // Only for info_type: "filesystem_stats"
  }

  export type Parameters = EntriesParams | SystemInfoParams;

  // --- Result Types ---
  // EntryInfo is already defined in common.ts and re-exported by tools.ts top level
  // export { EntryInfo } from '../common'; // No, it's directly available

  export interface DefinedEntriesResponse {
    tool_name: 'list';
    results: EntryInfo[];
    info_notices?: InfoNotice[];
  }

  export interface ServerCapabilities {
    server_version: string;
    active_configuration: Record<string, any>; // Simplified, actual config object structure
    supported_checksum_algorithms: string[];
    supported_archive_formats: string[];
    default_checksum_algorithm: string;
    max_recursive_depth: number;
  }

  export interface DefinedServerCapabilitiesResponse {
    tool_name: 'list';
    results: ServerCapabilities; // Singular
    info_notices?: InfoNotice[];
  }

  export interface FilesystemStats {
    path_queried: string;
    total_bytes: number;
    free_bytes: number;
    available_bytes: number;
    used_bytes: number;
  }
  export interface FilesystemStatsNoPath {
    info_type_requested: 'filesystem_stats';
    status_message: string;
    server_version: string;
    server_start_time_iso: string;
    configured_allowed_paths: string[];
  }

  export interface DefinedFilesystemStatsResponse {
    tool_name: 'list';
    results: FilesystemStats | FilesystemStatsNoPath; // Singular, union type
    info_notices?: InfoNotice[];
  }
}

export namespace FindTool {
  export interface NamePatternCriterion {
    type: 'name_pattern';
    pattern: string; // Glob pattern
  }

  export interface ContentPatternCriterion {
    type: 'content_pattern';
    pattern: string; // Text or regex
    is_regex?: boolean;
    case_sensitive?: boolean;
    file_types_to_search?: string[]; // e.g., [".txt", ".log"]
  }

  export type MetadataAttribute =
    | 'name'
    | 'size_bytes'
    | 'created_at'
    | 'modified_at'
    | 'entry_type'
    | 'mime_type';
  export type StringOperator =
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'starts_with'
    | 'ends_with'
    | 'matches_regex';
  export type NumericOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  export type DateOperator = 'before' | 'after' | 'on_date';

  export interface MetadataFilterCriterion {
    type: 'metadata_filter';
    attribute: MetadataAttribute | string;
    operator: StringOperator | NumericOperator | DateOperator | string;
    value: any; // string, number, or ISO date string
    case_sensitive?: boolean; // For string operators
  }

  export type MatchCriterion =
    | NamePatternCriterion
    | ContentPatternCriterion
    | MetadataFilterCriterion;

  export interface Parameters {
    base_path: string;
    recursive?: boolean;
    match_criteria: MatchCriterion[];
    entry_type_filter?: 'file' | 'directory' | 'any';
  }

  // Response is an array of EntryInfo objects, similar to list.entries
  // EntryInfo is already available from common types.
  export interface DefinedFindResponse {
    tool_name: 'find';
    results: EntryInfo[];
    info_notices?: InfoNotice[];
  }
}

// Namespace for the TestTool (New)
export namespace TestTool {
  export interface EchoParams {
    operation: 'echo';
    params_to_echo: any;
  }

  export interface GenerateErrorParams {
    operation: 'generate_error';
    error_code_to_generate: ErrorCode | string; // Allow any string for testing unregistered codes too
    error_message_to_generate: string;
  }

  export type Parameters = EchoParams | GenerateErrorParams;

  // --- Result Types ---
  export interface EchoResultSuccess extends MCPSuccess {
    echoed_params: any;
  }
  // For generate_error, the result IS an error, so it will conform to MCPErrorStatus directly.
  // No specific success type for generate_error.

  export interface DefinedEchoResponse {
    tool_name: 'test';
    results: EchoResultSuccess; // Singular
    info_notices?: InfoNotice[];
  }
  // Response for generate_error will be MCPErrorStatus, handled by the main MCPToolResponse structure.
}

export namespace ArchiveTool {
  export interface ArchiveOptions {
    overwrite?: boolean;
    portable?: boolean; // For create
    prefix?: string; // For create
    filter_paths?: string[]; // Paths relative to source_paths for create, or archive root for extract
    strip_components?: number; // For extract
    keep_newer_files?: boolean; // For extract
    preserve_owner?: boolean; // For extract
  }

  export interface CreateArchiveParams {
    operation: 'create';
    source_paths: string[];
    archive_path: string;
    compression?: 'gzip' | 'none';
    metadata?: Record<string, any>;
    options?: ArchiveOptions;
  }

  export interface ExtractArchiveParams {
    operation: 'extract';
    archive_path: string;
    target_path: string;
    options?: ArchiveOptions;
  }

  export type Params = CreateArchiveParams | ExtractArchiveParams;

  // --- Result Types ---
  export interface ArchiveResultError {
    status: 'error'; // from MCPErrorStatus
    error_code: string; // from MCPErrorStatus
    error_message: string; // from MCPErrorStatus
    operation: 'create' | 'extract';
  }

  export interface CreateArchiveSuccess {
    status: 'success';
    operation: 'create';
    archive_path: string;
    format_used: string; // e.g., 'zip', 'tar', 'tar.gz'
    size_bytes: number;
    entries_processed: number; // Number of top-level source paths processed
    checksum_sha256?: string;
    compression_used?: 'zip' | 'gzip' | 'none';
    metadata?: Record<string, any>;
    options_applied?: ArchiveOptions;
    message?: string;
  }

  export interface ExtractArchiveSuccess {
    status: 'success';
    operation: 'extract';
    archive_path: string;
    target_path: string;
    format_used: string; // e.g., 'zip', 'tar', 'tar.gz'
    entries_extracted: number; // Number of entries extracted, -1 if not easily countable
    options_applied?: ArchiveOptions;
    message?: string;
  }

  export type ArchiveResultItem = CreateArchiveSuccess | ExtractArchiveSuccess | ArchiveResultError;
  // MCPToolResponse requires a tool_name and results for object responses
  // The generic T in MCPToolResponse<T> refers to the type of the 'results' field content.
  // So if Response is MCPToolResponse<ArchiveResultItem[]>, then it means results: ArchiveResultItem[]
  // Let's define the Response structure explicitly to match MCPToolResponse expectation for an object
  export interface Response {
    tool_name: 'ArchiveTool';
    results: ArchiveResultItem[];
    // Plus potential InfoNotice as per MCPToolResponse definition
    // This needs to be a union if InfoNotice can also be at the top level alone
  }
  // A more accurate MCPToolResponse structure might be needed if InfoNotice is also part of it.
  // For now, assuming the primary structure is tool_name and results.
  // The provided MCPToolResponse<T> = T | T[] | [InfoNotice, T] | [InfoNotice, ...T[]] definition
  // might be too broad or misinterpreted by the linter in this context.
  // Let's redefine Response to be the object structure expected by the handler
}
