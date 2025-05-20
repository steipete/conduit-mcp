# conduit-mcp

MCP server for rich file system ops, web content fetching (HTML/Markdown), image processing, search, diff & archives, via concise tools.

**Version:** 1.0.0

`conduit-mcp` is a Node.js based MCP server designed to act as an intelligent data channel. It exposes a concise set of powerful tools for reading, writing, listing, and finding data across local filesystems and the web. All operational feedback, including one-time notices about default configurations, is communicated through the MCP tool responses.

## Features

*   Secure access to user-configured or default (`~:/tmp`) local directories.
*   Fetching and processing remote URLs (images, webpages, other files).
*   Webpage cleaning (main content extraction and conversion to Markdown).
*   Image loading to base64 with optional compression.
*   Advanced file operations: partial reads, checksums, diffing, appending.
*   Comprehensive directory and file search capabilities (name, metadata, content).
*   Archive (zip, tar.gz) functionality.
*   Batch operations for enhanced efficiency.
*   Configurable behavior via environment variables.
*   Detailed error codes for programmatic handling.
*   UTF-8 as the standard character encoding.
*   ISO 8601 UTC for all timestamps.

## Installation & Usage

The primary method for users to run this server is via `npx`, ensuring they use the latest published version. The official NPM package name for publication is `conduit-mcp`.

**MCP Client Configuration (e.g., in a client's `mcp.json`):**
```json
{
  "mcpServers": {
    "conduit_mcp": { 
      "command": "npx",
      "args": [
        "-y",
        "conduit-mcp@latest"
      ],
      "env": {
        "LOG_LEVEL": "INFO",
        "CONDUIT_ALLOWED_PATHS": "~/.my_agent_data:/projects" 
      }
    }
  }
}
```

**Important Note on `CONDUIT_ALLOWED_PATHS`:**

This environment variable is crucial for security. It defines a colon-separated list of local directory paths that the server is permitted to access (e.g., `CONDUIT_ALLOWED_PATHS="/path/to/data:~/agent_files"`). The `~` character is resolved to the user's home directory.

If `CONDUIT_ALLOWED_PATHS` is **not explicitly set** or is empty, the server defaults to `~:/tmp` (user's home directory and the system temporary directory). In this default scenario, the server will send a **one-time informational notice** as part of its very first successful tool response in a session. This notice will detail the default paths being used and recommend explicit configuration for production or security-sensitive environments. For enhanced security, it is **strongly recommended** to set `CONDUIT_ALLOWED_PATHS` explicitly to only the required directories.

**Running Locally (for Development or Direct Use):**
1.  Clone the repository: `git clone <repository_url_for_conduit-mcp>`
2.  Navigate to the directory: `cd conduit-mcp`
3.  Install dependencies: `npm install`
4.  The server can then be run using the `start.sh` script. Configure your MCP client to point to this script.

    Example for client's `mcp.json` using a local development instance:
    ```json
    {
      "mcpServers": {
        "conduit_mcp_local": {
          "command": "/absolute/path/to/your/cloned/conduit-mcp/start.sh",
          "env": {
            "LOG_LEVEL": "DEBUG",
            "CONDUIT_ALLOWED_PATHS": "~/my_dev_data:/tmp/agent_tests",
            "CONDUIT_MAX_FILE_READ_BYTES": "104857600"
          }
        }
      }
    }
    ```

## Configuration (Environment Variables)

The server is configured via environment variables. These are parsed at startup. Numeric and boolean string values are robustly parsed.

*   **`LOG_LEVEL`**: `string` (Default: `"INFO"`). For internal server logging (if output to a file is configured via `CONDUIT_LOG_PATH`). Valid values (case-insensitive): `"TRACE"`, `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, `"FATAL"`.
*   **`CONDUIT_LOG_PATH`**: `string` (Optional). If set to a file path, internal server logs will be written to this file. Otherwise, internal logging is a no-op to stdout/stderr to comply with MCP.
*   **`CONDUIT_ALLOWED_PATHS`**: `string` (Default: `"~:/tmp"`). Colon-separated list of absolute local directory paths the server is permitted to access. `~` is resolved to the user's home directory. **Crucial for security.**
*   **`CONDUIT_HTTP_TIMEOUT_MS`**: `string` (Integer, Default: `"30000"`). Timeout in milliseconds for all external HTTP/S requests.
*   **`CONDUIT_MAX_PAYLOAD_SIZE_BYTES`**: `string` (Integer, Default: `"10485760"` - 10MB). Maximum size of the entire incoming MCP request string on `stdin`.
*   **`CONDUIT_MAX_FILE_READ_BYTES`**: `string` (Integer, Default: `"52428800"` - 50MB). Maximum size for an individual local file read operation.
*   **`CONDUIT_MAX_URL_DOWNLOAD_BYTES`**: `string` (Integer, Default: `"20971520"` - 20MB). Maximum size for content downloaded from a URL.
*   **`CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES`**: `string` (Integer, Default: `"1048576"` - 1MB). Images larger than this will attempt compression if `format: "base64"` is requested for an image source.
*   **`CONDUIT_IMAGE_COMPRESSION_QUALITY`**: `string` (Integer, Default: `"75"`, Range 1-100). Quality setting for JPEG/WebP compression.
*   **`CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`**: `string` (Default: `"sha256"`). Supported values (case-insensitive): `"md5"`, `"sha1"`, `"sha256"`, `"sha512"`.
*   **`CONDUIT_MAX_RECURSIVE_DEPTH`**: `string` (Integer, Default: `"10"`). Maximum depth for recursive operations like `list.entries` and `find`.
*   **`CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS`**: `string` (Integer, Default: `"60000"` - 60 seconds). Internal server-side timeout for potentially long-running `calculate_recursive_size` operations in `list.entries`.

## Tools Provided

*(Detailed tool descriptions, parameters, responses, and examples will be provided for each tool below, based on the server's implementation.)*

### Tool: `read`

The `read` tool is a versatile data retrieval utility. It allows fetching content from local files (within configured allowed paths) and remote URLs. It can also retrieve detailed metadata for these sources, calculate cryptographic checksums of their content, and compare the differences between two specified local files. Key features include support for partial content reads (byte ranges) for both local files and URLs (though partial reads for URLs are not explicitly implemented in this version beyond standard HTTP Range requests if supported by the remote server), automatic image compression for large images when requested in base64 format, and intelligent conversion of fetched HTML webpages into cleaned Markdown. The tool provides smart defaults for output formats based on content type but allows explicit format requests.

**Operations:**

*   `content`: Fetches the actual content of specified sources.
*   `metadata`: Retrieves detailed metadata about specified sources.
*   `diff`: Compares two local files and returns their differences.

**Common Parameters for all `read` operations:**
*   `sources`: `string[]` (Required for `content` and `metadata`, an array of one or more local file paths or URLs. For `diff`, must be exactly two local file paths).
*   `operation`: `string` (Required). Valid values: `"content" | "metadata" | "diff"`.

**Parameters for `operation: "content"`:**
*   `format?`: `string` (Optional). Specifies the desired output format. Valid: `"text" | "base64" | "markdown" | "checksum"`.
    *   **Default behavior (if `format` is not specified):**
        *   Local files: `"text"` for recognized text-based MIME types (e.g., `text/*`, `application/json`), `"base64"` for others (e.g., `image/*`).
        *   URLs: `"base64"` if `Content-Type` is an image, `"text"` (raw response body) otherwise.
    *   **Specific `format` behaviors:**
        *   `"text"`: Returns UTF-8 string. For binary content, returns `"[Binary content, request with format: 'base64' to view]"`.
        *   `"base64"`: Returns base64 encoded string. Applies image compression if applicable.
        *   `"markdown"`: For HTML URLs/files, performs cleaning (Readability + Turndown). For non-HTML, falls back to `"text"` behavior with a notification.
        *   `"checksum"`: Calculates a checksum of the full content.
*   `checksum_algorithm?`: `string` (Optional, default: `CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`). Required if `format: "checksum"`. Valid: `"md5" | "sha1" | "sha256" | "sha512"`.
*   `offset?`: `integer` (Optional, default: `0`). Byte offset for partial reads (currently only for local files, URL range requests depend on server support).
*   `length?`: `integer` (Optional, default: `-1` i.e., to end). Number of bytes to read for partial reads.

**Parameters for `operation: "diff"`:**
*   `diff_format?`: `string` (Optional, default: `"unified"`). Currently, only `"unified"` is supported.

**Response Structure (general):**
*   For `content` and `metadata`: An array of result objects (one per source).
*   For `diff`: A single result object.
*   Each result object contains `source`, `source_type`, `status` (`"success"` or `"error"`), and `error_code?`/`error_message?` if error.

**Example `read.content` (text):**
```json
{
  "toolName": "read",
  "parameters": {
    "operation": "content",
    "sources": ["~/myfile.txt"],
    "format": "text"
  }
}
```
**Example `read.metadata` (URL):**
```json
{
  "toolName": "read",
  "parameters": {
    "operation": "metadata",
    "sources": ["https://example.com/image.png"]
  }
}
```

*(Refer to `src/types/tools.ts` for detailed response field specifications for each operation.)*

### Tool: `write`
The `write` tool facilitates modifications to the local filesystem within configured allowed paths. It supports creating or overwriting files, appending content, creating directories, copying, moving, deleting, updating timestamps (`touch`), and managing archives (zip, tar.gz). Most individual actions can be batched.

**Actions:**

*   `put`: Writes or appends content to a file.
*   `mkdir`: Creates a directory.
*   `copy`: Copies a file or directory.
*   `move`: Moves/renames a file or directory.
*   `delete`: Deletes a file or directory.
*   `touch`: Creates an empty file or updates timestamps of an existing one.
*   `archive`: Creates a zip or tar.gz archive from specified source paths.
*   `unarchive`: Extracts a zip or tar.gz archive.

**Common Parameters for batchable actions (`put`, `mkdir`, `copy`, `move`, `delete`, `touch`):**
*   `action`: `string` (Required, one of the batchable action names).
*   `entries`: `object[]` (Required, not empty). Each object defines a single operation with its specific parameters:
    *   **For `put` entry:** `path` (string, req), `content` (string, req), `input_encoding?` (`"text"`|`"base64"`, def: `"text"`), `write_mode?` (`"overwrite"`|`"append"`, def: `"overwrite"`).
    *   **For `mkdir` entry:** `path` (string, req), `recursive?` (boolean, def: `false`).
    *   **For `copy` entry:** `source_path` (string, req), `destination_path` (string, req).
    *   **For `move` entry:** `source_path` (string, req), `destination_path` (string, req).
    *   **For `delete` entry:** `path` (string, req), `recursive?` (boolean, def: `false`, req for non-empty dirs).
    *   **For `touch` entry:** `path` (string, req).

**Parameters for `action: "archive"` (single operation):**
*   `action`: `"archive"` (Required).
*   `source_paths`: `string[]` (Required, one or more local file/directory paths).
*   `archive_path`: `string` (Required, path for the resulting archive file).
*   `format?`: `string` (Optional, default: `"zip"`). Valid: `"zip" | "tar.gz" | "tgz"`.
*   `recursive_source_listing?`: `boolean` (Optional, default: `true`).

**Parameters for `action: "unarchive"` (single operation):**
*   `action`: `"unarchive"` (Required).
*   `archive_path`: `string` (Required, path to the archive file).
*   `destination_path`: `string` (Required, directory to extract contents).
*   `format?`: `string` (Optional). Valid: `"zip" | "tar.gz" | "tgz"`. Auto-detected if omitted.

**Response Structure (general):**
*   For batchable actions: An array of result objects (one per entry).
*   For `archive`/`unarchive`: A single result object.
*   Each result object contains `status`, `action_performed`, and relevant paths/details or `error_code?`/`error_message?`.

**Example `write.put` (batch):**
```json
{
  "toolName": "write",
  "parameters": {
    "action": "put",
    "entries": [
      { "path": "~/newfile.txt", "content": "Hello World!" },
      { "path": "~/another.log", "content": "TG9nIGRhdGE=", "input_encoding": "base64", "write_mode": "append" }
    ]
  }
}
```
**Example `write.archive`:**
```json
{
  "toolName": "write",
  "parameters": {
    "action": "archive",
    "source_paths": ["~/docs/project1", "~/important.txt"],
    "archive_path": "~/backup.zip",
    "format": "zip"
  }
}
```

*(Refer to `src/types/tools.ts` for detailed response field specifications for each action.)*

### Tool: `list`
The `list` tool provides capabilities to inspect local directory structures and retrieve system-level information.

**Operations:**

*   `entries`: Lists files and subdirectories within a path.
*   `system_info`: Retrieves server capabilities or filesystem statistics.

**Parameters for `operation: "entries"`:**
*   `path`: `string` (Required, local directory path).
*   `recursive_depth?`: `integer` (Optional, default: `0` for non-recursive. `N > 0` for N levels, `-1` or > `CONDUIT_MAX_RECURSIVE_DEPTH` capped by server max).
*   `calculate_recursive_size?`: `boolean` (Optional, default: `false`). If true, attempts to sum file sizes within directories (subject to depth and timeout).

**Parameters for `operation: "system_info"`:**
*   `info_type`: `string` (Required). Valid: `"server_capabilities" | "filesystem_stats"`.
*   `path?`: `string` (Optional). Only for `info_type: "filesystem_stats"`, specifies a path on the volume to get stats for.

**Response Structure (general):**
*   `list.entries`: Array of `EntryInfo` objects (name, path, type, size_bytes?, mime_type?, timestamps, permissions, children?, recursive_size_calculation_note?).
*   `list.system_info` (`server_capabilities`): Object with server version, active config, supported algorithms, etc.
*   `list.system_info` (`filesystem_stats` with path): Object with path_queried, total/free/available/used bytes.
*   `list.system_info` (`filesystem_stats` without path): Informational object with guidance and allowed paths.

**Example `list.entries` (recursive):**
```json
{
  "toolName": "list",
  "parameters": {
    "operation": "entries",
    "path": "~/projects",
    "recursive_depth": 1,
    "calculate_recursive_size": true
  }
}
```
**Example `list.system_info` (capabilities):**
```json
{
  "toolName": "list",
  "parameters": {
    "operation": "system_info",
    "info_type": "server_capabilities"
  }
}
```

*(Refer to `src/types/tools.ts` and `src/types/common.ts` for detailed response field specifications.)*

### Tool: `find`
The `find` tool enables powerful searching for files and directories within allowed local paths. Searches are from a `base_path`, can be recursive, and use multiple criteria (AND logic).

**Parameters:**
*   `base_path`: `string` (Required, local directory to start search).
*   `recursive?`: `boolean` (Optional, default: `true`). Respects `CONDUIT_MAX_RECURSIVE_DEPTH`.
*   `match_criteria`: `object[]` (Required). Array of criterion objects. All must match.
    *   **Criterion `type: "name_pattern"`**: 
        *   `pattern`: `string` (Required, glob pattern like `*.txt`, `**/*.log`).
    *   **Criterion `type: "content_pattern"`**: 
        *   `pattern`: `string` (Required, text or regex).
        *   `is_regex?`: `boolean` (Optional, default: `false`).
        *   `case_sensitive?`: `boolean` (Optional, default: `false` for literal string search).
        *   `file_types_to_search?`: `string[]` (Optional, e.g., `[".txt", ".md"]`. Restricts content search to these file extensions. Binary files are generally skipped for content search unless explicitly listed and deemed text-searchable by the server).
    *   **Criterion `type: "metadata_filter"`**: 
        *   `attribute`: `string` (Required). Valid: `"name" | "size_bytes" | "created_at_iso" | "modified_at_iso" | "entry_type" | "mime_type"`.
        *   `operator`: `string` (Required). Valid for string attributes: `"equals" | "not_equals" | "contains" | "starts_with" | "ends_with" | "matches_regex"`. Valid for numeric: `"eq" | "neq" | "gt" | "gte" | "lt" | "lte"`. Valid for date: `"before" | "after" | "on_date"`.
        *   `value`: `any` (Required, appropriate type for attribute and operator).
        *   `case_sensitive?`: `boolean` (Optional, default: `false` for string operators).
*   `entry_type_filter?`: `string` (Optional, default: `"any"`). Valid: `"file" | "directory" | "any"`.

**Response Structure:**
*   An array of `EntryInfo` objects matching all criteria (flat list, no `children` or `recursive_size_calculation_note` fields).

**Example `find` (files by name and content):**
```json
{
  "toolName": "find",
  "parameters": {
    "base_path": "~/notes",
    "recursive": true,
    "match_criteria": [
      { "type": "name_pattern", "pattern": "*.md" },
      { "type": "content_pattern", "pattern": "project Conduit", "case_sensitive": false }
    ],
    "entry_type_filter": "file"
  }
}
```

*(Refer to `src/types/tools.ts` for detailed criterion and response specifications.)*

## Error Handling

Failed operations or individual failures in batch requests result in `status: "error"`. Error objects include:
*   `error_code`: `"UNIQUE_ERROR_CODE"` (see Appendix A in `docs/spec.md` for a full list).
*   `error_message`: `"Descriptive human-readable error message."`

## Development

See `DEVELOPMENT.md` for details on project structure, setup, building, testing, and contributing.
