## Technical Specification: `conduit-mcp` Server

**Version:** 1.0.0
**Project Name:** `conduit-mcp`
**Primary Goal:** To provide a versatile and efficient Model Context Protocol (MCP) server for interacting with local filesystems, fetching and processing web content (including images and cleaned webpages), and performing various data manipulation tasks, communicating all necessary information, including initial setup details, via the MCP tool responses.

**GitHub Repo One-Liner:**
`conduit-mcp: MCP server for rich file system ops, web content fetching (HTML/Markdown), image processing, search, diff & archives, via concise tools.`

### 1. Overview

`conduit-mcp` is a Node.js based MCP server designed to act as an intelligent data channel. It exposes a concise set of powerful tools for reading, writing, listing, and finding data across local filesystems and the web. All operational feedback, including one-time notices about default configurations, is communicated through the MCP tool responses. Key features include:

- Secure access to user-configured or default (`~:/tmp`) local directories.
- Fetching and processing remote URLs (images, webpages, other files).
- Webpage cleaning (main content extraction and conversion to Markdown).
- Image loading to base64 with optional compression.
- Advanced file operations: partial reads, checksums, diffing, appending.
- Comprehensive directory and file search capabilities (name, metadata, content).
- Archive (zip, tar.gz) functionality.
- Batch operations for enhanced efficiency.
- Configurable behavior via environment variables.
- Detailed error codes for programmatic handling.
- UTF-8 as the standard character encoding.
- ISO 8601 UTC for all timestamps.

### 2. Core Server Features & Behavior

- **MCP Compliance:** The server must strictly adhere to the Model Context Protocol. The tool definitions, parameters, and request/response structures detailed within this document constitute the complete MCP interface for this server. **The server must not write any data to `stdout` or `stderr` that is not part of a valid MCP JSON response to a request.** This includes startup messages or general logs. All necessary communication, including one-time informational messages, must be embedded within MCP tool responses.
- **First Use Informational Message:**
  - The server must maintain a state variable (e.g., a boolean flag, initialized to `false` at server start) to track if it has sent a "first use informational message" during its current runtime session. This flag is reset only when the server process restarts.
  - On the **very first successful tool request processed by the server in a session**, if the `CONDUIT_ALLOWED_PATHS` environment variable was _not_ explicitly set by the user (and thus the server defaulted to using `~:/tmp`), the MCP response for _that first successful tool request_ **must** be modified to include an informational notice.
  - **Injection Mechanism:**
    - If the tool's original successful response is an **array** (e.g., `read.content` with multiple sources, `write` batched actions, `list.entries`, `find`), the informational notice object **must be prepended** as the first element of this array.
    - If the tool's original successful response is a **single JSON object** (e.g., `read.diff`, `write.archive`, `list.system_info`, or `read.content` with a single source if it were to return a single object - though spec defines it as an array), the response **must be transformed into a two-element array.** The first element **must be** the informational notice object, and the second element **must be** the original single JSON object response from the tool.
  - The server must set its internal "first use message sent" flag to `true` after successfully preparing to include this notice, ensuring it is sent only once per server session.
  - **Structure of the prepended informational message (as a JSON object):**
    ```json
    {
      "type": "info_notice", // A distinct type to allow clients to potentially handle it differently.
      "notice_code": "DEFAULT_PATHS_USED",
      "message": "INFO [conduit-mcp v1.0.0, Server Started: YYYY-MM-DDTHH:mm:ss.sssZ]: CONDUIT_ALLOWED_PATHS was not explicitly set by the user. Defaulting to allow access to resolved paths for '~' (home directory) and '/tmp' (system temporary directory). For production environments or enhanced security, it is strongly recommended to set the CONDUIT_ALLOWED_PATHS environment variable explicitly to only the required directories.",
      "details": {
        "server_version": "1.0.0", // Actual server version from package.json
        "server_start_time_iso": "YYYY-MM-DDTHH:mm:ss.sssZ", // Actual server start time
        "default_paths_used": ["/actual/resolved/home/path", "/actual/resolved/tmp/path"] // Array of resolved default paths
      }
    }
    ```
  - The `server_version` **must** be dynamically read (e.g., from `package.json`). The `server_start_time_iso` and `default_paths_used` (with `~` and `/tmp` resolved to absolute paths) **must** be dynamically included.
- **Security:**
  - **Path Traversal Prevention:** All local filesystem paths provided by the client must be validated. Paths are resolved to their absolute form (including resolving `~` at the start of a path segment if part of `CONDUIT_ALLOWED_PATHS` or input paths). It must be verified that the fully resolved, real path resides within one of the directories specified by the active `CONDUIT_ALLOWED_PATHS` configuration (either user-set or the default `~:/tmp`). Operations on paths determined to be outside these configured scopes will result in an `ERR_FS_ACCESS_DENIED` error.
  - **Symlink Security:** The server **must always resolve symbolic links** encountered in any part of a local filesystem path (the `CONDUIT_FOLLOW_SYMLINKS` variable is removed). After resolving all symlinks, the final, absolute, real path **must** reside within one of the configured `CONDUIT_ALLOWED_PATHS`. If the resolved real path is outside this scope, an `ERR_FS_ACCESS_DENIED` error must be returned.
  - **URL Fetching Security:** All external HTTP/S requests are subject to the `CONDUIT_HTTP_TIMEOUT_MS`. No other URL filtering (allow/deny patterns) is implemented in this version.
  - **Resource Limits:** The server enforces limits defined by `CONDUIT_MAX_PAYLOAD_SIZE_BYTES` (for the entire incoming MCP request string on stdin), `CONDUIT_MAX_FILE_READ_BYTES` (for individual local file reads), and `CONDUIT_MAX_URL_DOWNLOAD_BYTES` (for content fetched from URLs). Requests or operations exceeding these limits will result in an `ERR_RESOURCE_LIMIT_EXCEEDED` error, and the operation will be terminated.
- **Error Handling:**
  - Responses for failed operations or individual failed items in a batch must have `status: "error"`.
  - Each error object must include:
    - `error_code: "UNIQUE_ERROR_CODE"` (`string`, see Appendix A for a comprehensive list).
    - `error_message: "Descriptive human-readable error message detailing the cause."` (`string`).
  - For batch operations, each item in the response array will have its own `status`, `error_code`, and `error_message` if applicable.
- **MIME Type Detection:**
  - Local files: The `file-type` npm package (which inspects file magic numbers) **must** be used to determine MIME types.
  - URL responses: The `Content-Type` header from the HTTP response **must** be respected as the primary source of MIME type information.
- **Idempotency:**
  - `write.action: "mkdir"`: If the directory specified (and all parent directories if `recursive: true`) already exists, the operation will succeed without error. No special message is included in the MCP response. An internal `DEBUG` level log (if internal logging to a file is active) can note "mkdir operation for path '[path]' succeeded: directory already existed."
  - `write.action: "touch"`: If the file already exists, its access (atime) and modification (mtime) timestamps are updated to the current server time using OS-level functions (e.g. Node.js `fs.utimes`). If it doesn't exist, it is created as an empty file (which will also have current atime/mtime). This operation will always report success if the path is writable.
- **Logging (Internal Server Logging Only):**
  - The server **must not** write any operational logs to `stdout` or `stderr` to maintain MCP compliance.
  - It **must** be implemented with an internal, configurable logging mechanism (e.g., using `pino`).
  - **Log Destination:**
    - If the `CONDUIT_LOG_FILE_PATH` environment variable is set to a valid, writable path, the server **must** write its internal logs to that file.
    - If `CONDUIT_LOG_FILE_PATH` is _not_ set, the server **must** attempt to write its internal logs to a default file located at `[SYSTEM_TEMP_DIR]/conduit-mcp.log` (e.g., `/tmp/conduit-mcp.log` on Unix-like systems, `os.tmpdir()` for Node.js). The server should attempt to create this log file if it doesn't exist. If it cannot write to this default location (e.g., due to permissions), it should then operate with its logging effectively disabled (like a no-op logger) to prevent crashes. This failure to write to the default log path should be noted by an internal, in-memory-only critical log event if possible (but not sent to stdout/stderr).
    - If `CONDUIT_LOG_FILE_PATH` is set to the case-insensitive value `"NONE"`, internal logging **must** be completely disabled (no-op logger).
  - **Log Level:** The `LOG_LEVEL` environment variable controls the _granularity_ of messages written to the configured log destination.
  - **Logged Information (to the configured log file/destination, not to MCP client):**
    - At `INFO` or `DEBUG` level (based on `LOG_LEVEL`): Server startup, including all active `CONDUIT_*` configuration values (no redaction), resolved default paths if used, and chosen log file path or disabled status.
    - At `DEBUG` level: Incoming MCP request received (including `toolName`, `operation`/`action`, and key parameters, but _excluding_ full raw content like file data or large web content to avoid excessive log sizes).
    - At `INFO` or `DEBUG` level: Outcome of significant operations (e.g., "File /path/to/file.txt written successfully", "URL http://example.com fetched", "Search found N results").
    - At `WARN` level: Recoverable issues or deviations from expected behavior (e.g., "Image compression failed for X, returning original.").
    - At `ERROR` level: Details of internal errors or failures corresponding to MCP error responses, including the `error_code`.
- **Webpage Cleaning Pipeline (for `read.operation: "content", format: "markdown"` on URLs):**
  1.  Fetch raw content from the URL.
  2.  Check the `Content-Type` header of the response. If it is not `text/html` or a closely related HTML variant (e.g., `application/xhtml+xml`), then the fallback behavior described in Section 5.1 for `format: "markdown"` on non-HTML URLs is triggered (return raw text with notification fields).
  3.  If HTML, parse the content using `jsdom`.
  4.  Extract the main content block from the parsed DOM using `@mozilla/readability`. If `readability.parse()` returns `null` or fails to extract meaningful content (e.g., result's `textContent` is empty or very short after stripping whitespace), this is considered a failure of the cleaning process, resulting in an `ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED` error for that source.
  5.  If main content HTML is successfully extracted, convert this HTML snippet to Markdown using `turndown`.
  6.  Return the resulting Markdown string.
- **Image Compression (for `read.operation: "content", format: "base64"` on image URLs/files):**
  - This processing applies if the detected MIME type (from `file-type` for local files, or `Content-Type` header for URLs) is an image type supported for processing by the `sharp` library (e.g., `image/jpeg`, `image/png`, `image/webp`, `image/tiff`, `image/gif`, `image/avif`).
  - If the raw image data size (before base64 encoding) exceeds `CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES`, the server **must** attempt to compress the image using `sharp`.
    - For JPEG/WebP: Adjust quality using `CONDUIT_IMAGE_COMPRESSION_QUALITY`.
    - For PNG: Use optimization options available in `sharp` (e.g., `png({ compressionLevel: 9, adaptiveFiltering: true })`).
    - Other formats: Apply suitable lossless or lossy compression available in `sharp`.
  - If compression is successful (i.e., `sharp` does not throw an error and potentially produces smaller data), the compressed image data is then base64 encoded. The response **must** include `compression_applied: true` and `original_size_bytes`.
  - If no compression was attempted (e.g., image size is below threshold, or `sharp` does not support compression for the specific image subtype), `compression_applied: false` and `original_size_bytes` is omitted.
  - If compression was attempted but `sharp` throws an error, an error should be logged internally (to the configured log file). The server **must** then proceed to base64 encode the _original, uncompressed_ image data and the MCP response for that source should include `compression_applied: false` and `compression_error_note: "Image compression attempt failed; original image data used."`.
- **Character Encoding:** All text file reading, writing, and text content from URLs (after decoding HTTP responses according to their `Content-Type` or defaulting to UTF-8 if unspecified by the remote server) **must** assume, operate with, and produce UTF-8 encoded text.
- **Date/Time Format:** All timestamps produced by the server and included in MCP responses (e.g., `created_at_iso`, `modified_at_iso`, `server_start_time_iso`) **must** be strings formatted according to ISO 8601 and **must** represent Coordinated Universal Time (UTC), including the `Z` designator or explicit UTC offset (+00:00). Example: `2025-05-16T15:30:00.123Z`.

### 3. Installation & Usage

The primary method for users to run this server is via `npx`, ensuring they use the latest published version. The official NPM package name for publication **must** be `conduit-mcp`.

**MCP Client Configuration (e.g., in a client's `mcp.json`):**

```json
{
  "mcpServers": {
    "conduit_mcp": {
      // Client-defined alias for this server instance
      "command": "npx",
      "args": [
        "-y",
        "conduit-mcp@latest" // Assumes 'conduit-mcp' is the published package name
      ],
      "env": {
        // Environment variables passed to the server process
        "LOG_LEVEL": "INFO", // For server's internal logging if file output is configured
        "CONDUIT_ALLOWED_PATHS": "~/.my_agent_data:/projects" // Example explicit user setting
        // If CONDUIT_ALLOWED_PATHS is omitted, server defaults to "~:/tmp" and sends one-time notice
      }
    }
  }
}
```

_Documentation must prominently explain the `CONDUIT_ALLOWED_PATHS` variable, its default (`~:/tmp`), the one-time informational notice sent via the first MCP response if the default is used, and security implications. It should strongly advise users to set this variable explicitly for production environments._

**Running Locally (for Development or Direct Use):**

1.  Clone the repository: `git clone <repository_url_for_conduit-mcp>`
2.  Navigate to the directory: `cd conduit-mcp`
3.  Install dependencies: `npm install`
4.  The server can then be run using the `start.sh` script. Configure the MCP client to point to this script.

    Example for client's `mcp.json` using a local development instance:

    ```json
    {
      "mcpServers": {
        "conduit_mcp_local": {
          "command": "/absolute/path/to/your/cloned/conduit-mcp/start.sh",
          "env": {
            "LOG_LEVEL": "DEBUG",
            // CONDUIT_ALLOWED_PATHS omitted here to test default path behavior and notice
            "CONDUIT_LOG_FILE_PATH": "./conduit-dev.log", // Example: Log to a local file for dev
            "CONDUIT_MAX_FILE_READ_BYTES": "104857600"
          }
        }
      }
    }
    ```

**`start.sh` Script (to be included in the repository):**

```bash
#!/bin/bash
# start.sh: Runs the conduit-mcp server, prioritizing compiled build, then source.

# Default LOG_LEVEL to INFO if not set by the environment.
# This is for the server's internal logging mechanisms (e.g., to a file), not for stdout/stderr.
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

# Determine the absolute path to the script's directory, then the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Define paths for compiled and source entry points
DIST_SERVER_JS="$PROJECT_ROOT/dist/server.js" # Anticipated compiled output location
SRC_SERVER_TS="$PROJECT_ROOT/src/server.ts"   # Main TypeScript source file

# Note: The CONDUIT_ALLOWED_PATHS default and its validation is handled by the server application itself.
# This script no longer checks for it, allowing the server to manage the default
# and the one-time informational notice through the MCP response.

# Check if a compiled version exists
if [ -f "$DIST_SERVER_JS" ]; then
  # (Server's internal logger, if active to a file, would note: "Running compiled version from $DIST_SERVER_JS")
  exec node "$DIST_SERVER_JS"
else
  # (Server's internal logger, if active to a file, would note: "Compiled version not found. Attempting to run from source $SRC_SERVER_TS using tsx.")

  # Check for tsx: first in local node_modules, then global path
  LOCAL_TSX_PATH="$PROJECT_ROOT/node_modules/.bin/tsx"
  TSX_CMD=""

  if [ -f "$LOCAL_TSX_PATH" ]; then
    TSX_CMD="$LOCAL_TSX_PATH"
  elif command -v tsx &> /dev/null; then
    TSX_CMD="tsx"
  fi

  # If tsx is not found after initial checks, attempt to install it locally (dev dependency style).
  # This output to stderr is acceptable as it's a bootstrap/dev environment issue not an MCP violation.
  if [ -z "$TSX_CMD" ]; then
    echo "WARN: [conduit-mcp/start.sh] tsx command not found. Attempting to install it locally (will not be saved to package.json)..." >&2
    # Execute npm install in the project root context
    (cd "$PROJECT_ROOT" && npm install tsx --no-save)
    # Re-check for local tsx after attempting install
    if [ -f "$LOCAL_TSX_PATH" ]; then
      TSX_CMD="$LOCAL_TSX_PATH"
    else
      # If still not found, error out.
      echo "ERROR: [conduit-mcp/start.sh] Failed to find or install tsx. Please install tsx globally ('npm install -g tsx') or ensure it's a devDependency and install project dependencies, or build the project first." >&2
      exit 1
    fi
  fi

  # (Server's internal logger, if active to a file, would note: "Executing server with: $TSX_CMD $SRC_SERVER_TS")
  exec "$TSX_CMD" "$SRC_SERVER_TS"
fi
```

### 4. Configuration (via Environment Variables)

The server **must** parse these environment variables at startup. String values for numbers and booleans **must** be robustly parsed (e.g., `"true"`/`"false"` for booleans, numeric strings for integers). The server **must** resolve `~` at the beginning of any path segment in the `CONDUIT_ALLOWED_PATHS` string to the current user's home directory (e.g., using `os.homedir()` from Node.js `os` module) before using the paths. If a path after `~` resolution or an explicitly absolute path in `CONDUIT_ALLOWED_PATHS` does not exist or is not a directory, the server should log this internally at `WARN` level and not consider it an allowed path, but continue to operate with other valid allowed paths. If _no_ valid allowed paths remain after this processing (including the default), the server must refuse to start with an `ERR_CONFIG_INVALID` or `ERR_FS_BAD_ALLOWED_PATH` internal log and exit.

- **`LOG_LEVEL`**: `string` (Default: `"INFO"`). For internal server logging written to the configured log file (see `CONDUIT_LOG_FILE_PATH`). Valid values (case-insensitive): `"TRACE"`, `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, `"FATAL"`.
- **`CONDUIT_LOG_FILE_PATH`**: `string` (Optional. **Default**: `[SYSTEM_TEMP_DIR]/conduit-mcp.log`).
  - Specifies the absolute path to a file where the server's internal logs will be written. The directory containing the log file must be writable by the server process.
  - If not set, logs are written to a file named `conduit-mcp.log` in the system's temporary directory (e.g., as determined by `os.tmpdir()`).
  - If set to the special case-insensitive value `"NONE"`, internal logging is completely disabled (no-op logger).
- **`CONDUIT_ALLOWED_PATHS`**: `string` (**Default: `~:/tmp`**). Colon-separated list of absolute local directory paths that the server is permitted to access. If this variable is not set or is an empty string, the server **must** use this default. The server **must** resolve `~` in each path segment (e.g. `~` or `~/some/path`) to the user's home directory, and `/tmp` to the system's standard temporary directory. Each resolved path must exist and be a directory to be considered valid.
- **`CONDUIT_HTTP_TIMEOUT_MS`**: `string` (Integer, Default: `"30000"`). Timeout in milliseconds for all external HTTP/S requests.
- **`CONDUIT_MAX_PAYLOAD_SIZE_BYTES`**: `string` (Integer, Default: `"10485760"` - 10MB). Maximum size of the entire incoming MCP request string on `stdin`. Checked before JSON parsing.
- **`CONDUIT_MAX_FILE_READ_BYTES`**: `string` (Integer, Default: `"52428800"` - 50MB). Maximum size for an individual local file read operation.
- **`CONDUIT_MAX_URL_DOWNLOAD_BYTES`**: `string` (Integer, Default: `"20971520"` - 20MB). Maximum size for content downloaded from a URL.
- **`CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES`**: `string` (Integer, Default: `"1048576"` - 1MB). Images larger than this will attempt compression if `format: "base64"` is requested.
- **`CONDUIT_IMAGE_COMPRESSION_QUALITY`**: `string` (Integer, Default: `"75"`, Range 1-100). Quality setting for JPEG/WebP compression.
- **`CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`**: `string` (Default: `"sha256"`). Supported values (case-insensitive): `"md5"`, `"sha1"`, `"sha256"`, `"sha512"`.
- **`CONDUIT_MAX_RECURSIVE_DEPTH`**: `string` (Integer, Default: `"10"`). Maximum depth for recursive operations like `list.entries` and `find`.
- **`CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS`**: `string` (Integer, Default: `"60000"` - 60 seconds). Internal server-side timeout in milliseconds for potentially long-running `calculate_recursive_size` operations. This is not configurable per MCP request.

### 5. Tools Provided

_(The AI building the server is responsible for generating extensive descriptions for the project's README.md for each tool, and each of its operations/actions. These descriptions must be inferred from the detailed parameter specifications, return structures, default behaviors, and error conditions outlined below. Each description should clearly state the purpose, all parameters with their types, optionality, and defaults, the structure of the success response with all possible fields, common error codes, and include 1-2 illustrative JSON examples of usage.)_

#### 5.1. Tool: `read`

- **Description:** (AI to generate based on full capabilities listed below)
- **Parameters:**
  - `sources`: `string[]` (Required. For `operation: "content"` and `operation: "metadata"`, this is an array of one or more local file paths or URLs. For `operation: "diff"`, this array **must** contain exactly two local file paths).
  - `operation`: `string` (Required). Valid values: `"content" | "metadata" | "diff"`.
  - **Parameters specific to `operation: "content"`:**
    - `format?`: `string` (Optional). Specifies the desired output format for the content.
      - Valid values: `"text" | "base64" | "markdown" | "checksum"`.
      - **Default behavior if `format` is not specified:**
        - For local files: Determined by the MIME type detected using `file-type`. If the MIME type is recognized as predominantly text-based (e.g., `text/*`, `application/json`, `application/xml`, `application/javascript`, `application/svg+xml`, and other common script/config types like `.py`, `.sh`, `.yaml`), the default is `"text"`. For other types (e.g., `image/*`, `application/pdf`, `application/zip`, `application/octet-stream`), the default is `"base64"`.
        - For URLs: Determined by the `Content-Type` header from the HTTP response. If it indicates an image type (e.g., `image/jpeg`, `image/png`, etc.), the default is `"base64"`. For other `Content-Type` values, the default is `"text"` (raw response body).
      - **Specific `format` behavior details:**
        - `"text"`: Returns content as a UTF-8 string. If explicitly requested for content identified as binary (based on MIME type determination as per default behavior: not in the list of known text-friendly types), the `content` field in the response **must** be the placeholder string: `"[Binary content, request with format: 'base64' to view]"`.
        - `"base64"`: Returns content as a base64 encoded string. If the source is an image meeting criteria, server-side image compression (see Section 2) is applied before encoding.
        - `"markdown"`: **Primarily for URL sources.**
          - If the source is a URL and its `Content-Type` is HTML (e.g., `text/html`, `application/xhtml+xml`), the server performs the webpage cleaning pipeline (fetch, parse, main content extraction via Readability, convert main HTML to Markdown via Turndown).
          - If the source is a URL but its `Content-Type` is _not_ HTML-like, the server **must** fallback to behaving as if `format: "text"` was requested (returning the raw content). The response for this source **must** include `output_format_used: "text"`, `markdown_conversion_status: "skipped_unsupported_content_type"`, and `markdown_conversion_skipped_reason: "Original Content-Type '[actual_mime_type]' is not suitable for Markdown conversion; returning raw content."`. The `[actual_mime_type]` must be the `Content-Type` from the URL's response header.
          - If the source is a local file, requesting `format: "markdown"` for a local HTML file (identified by `file-type` returning `text/html` or similar) should perform the same cleaning pipeline. For non-HTML local files, it should behave like the non-HTML URL case (fallback to text, include skip reason based on detected local MIME type).
        - `"checksum"`: Calculates a checksum of the full file or URL content.
    - `checksum_algorithm?`: `string` (Optional, but required if `format: "checksum"` and no server default `CONDUIT_DEFAULT_CHECKSUM_ALGORITHM` is set or if overriding the default). If `format: "checksum"` and this is not provided, defaults to the value of `CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`. Valid values (case-insensitive): `"md5"`, `"sha1"`, `"sha256"`, `"sha512"`.
    - `offset?`: `integer` (Optional, default: `0`). Byte offset from which to start reading. Must be non-negative. If `offset` exceeds content length, an empty `content` should be returned for text/base64 formats, or an error for checksum.
    - `length?`: `integer` (Optional, default: `-1`, which means read from `offset` to the end of the content). Number of bytes to read. Must be non-negative if specified (other than -1). If `offset` + `length` exceeds content length, content up to the end is returned.
  - **Parameters specific to `operation: "metadata"`:** (None beyond `sources`).
  - **Parameters specific to `operation: "diff"`:**
    - `sources`: This **must** be an array containing exactly two `string` elements, each being a local file path. If not, `ERR_INVALID_PARAMETER`.
    - `diff_format?`: `string` (Optional, default: `"unified"`). For V1, only `"unified"` is required. The server should use a library like `diff` to generate this.
- **Returns:**
  - For `operation: "content"` and `operation: "metadata"`: An **array** of result objects, one for each item in the input `sources` array, in the same order. This is true even if `sources` contains only one item.
  - For `operation: "diff"`: A **single** result object.
  - _(The first successful response of a server session may prepend the one-time informational notice object as the first element of the response array, or wrap the single object response in a two-element array with the notice as the first element, if default paths were used by the server. Client documentation must highlight this.)_
  - **Common fields for each result object:**
    - `source`: `string` (The source path or URL that was processed for this result).
    - `source_type`: `string` (`"file" | "url"`).
    - `status`: `string` (`"success" | "error"`).
    - `error_code?`: `string` (Present if `status` is `"error"`; see Appendix A).
    - `error_message?`: `string` (Present if `status` is `"error"`).
  - **Additional fields for `operation: "content"` on `status: "success"`:**
    - `output_format_used`: `string` (The actual format of the `content` field, e.g., `"text"`, `"base64"`, `"markdown"`, `"checksum"`).
    - `content?`: `string` (The requested content: UTF-8 text, base64 encoded data, Markdown text, the placeholder string for `format: "text"` on binary, or the checksum string. This field is absent if `output_format_used` is `"checksum"` and the `checksum` field is present).
    - `mime_type?`: `string` (Detected MIME type of the source content before any conversion or formatting).
    - `size_bytes?`: `integer` (For `output_format_used` of `text`/`base64`/`markdown`, this is the byte length of the string in the `content` field. For `output_format_used` of `checksum`, this is the size in bytes of the original data that was checksummed).
    - `original_size_bytes?`: `integer` (If image compression was applied and successful, this is the size of the image data _before_ compression. Omitted otherwise).
    - `compression_applied?`: `boolean` (For image sources when `output_format_used: "base64"`. `true` if compression was attempted and successful, `false` otherwise. Omitted if not an image or compression not applicable/attempted).
    - `compression_error_note?`: `string` (Optional. If `compression_applied: false` due to an error during an attempted compression, this provides a brief note, e.g., "Compression attempt failed; original image data used.").
    - `checksum?`: `string` (The calculated checksum string, if `output_format_used: "checksum"`).
    - `checksum_algorithm_used?`: `string` (The algorithm used, if `output_format_used: "checksum"`).
    - `http_status_code?`: `integer` (For `source_type: "url"`, the HTTP status code from the final response, e.g., `200` for success, `206` for partial content).
    - `range_request_status?`: `string` (For URL sources where `offset` or `length` implied a partial read. Values: `"native"` if the remote server responded with HTTP 206 and the range was fulfilled as requested; `"simulated"` if the remote server did not support Range or returned full content, and `conduit-mcp` performed the slicing from the full download; `"full_content_returned"` if a range was requested but the full content was small enough to fit the range or the remote server returned full content and no slicing was needed by `conduit-mcp`; `"not_supported"` if Range headers were explicitly rejected or the remote server errored in a way that prevented even full fetch for simulation. Omitted for local files or non-ranged URL requests).
    - `markdown_conversion_status?`: `string` (If `format: "markdown"` was initially requested for a URL. Values: `"success"` if Markdown was generated, or `"skipped_unsupported_content_type"` if fallback to text occurred).
    - `markdown_conversion_skipped_reason?`: `string` (If `markdown_conversion_status` is `"skipped_unsupported_content_type"`, e.g., `"Original Content-Type 'image/png' is not suitable for Markdown conversion; returning raw content."`).
    - `final_url?`: `string` (For URL sources, if HTTP redirects occurred, this is the final URL from which content was actually fetched. Only present if different from the original `source` URL provided in the request).
  - **Additional fields for `operation: "metadata"` on `status: "success"`:**
    - `http_status_code?`: `integer` (For `source_type: "url"`, the HTTP status code from the response, e.g., 200, 304).
    - `metadata`: `object` (Contains metadata attributes):
      - `name`: `string` (Filename for local files, or the last segment of the URL path for URLs, decoded from URL encoding if necessary).
      - `entry_type`: `string` (`"file" | "directory" | "url"`).
      - `size_bytes?`: `integer` (For local files, the actual file size. For URLs, the value from the `Content-Length` HTTP response header, if present and numeric).
      - `mime_type?`: `string` (Detected MIME type for local files. For URLs, from the `Content-Type` HTTP response header).
      - `created_at_iso?`: `string` (ISO 8601 UTC timestamp of creation for local files, if available from the OS).
      - `modified_at_iso?`: `string` (ISO 8601 UTC timestamp of last modification. For local files, from OS. For URLs, from the `Last-Modified` HTTP response header, if present).
      - `permissions_octal?`: `string` (For local files, e.g., `"0755"`. Must include leading zero if standard for OS representation).
      - `permissions_string?`: `string` (For local files, e.g., `"rwxr-xr-x"` Unix-style).
      - `http_headers?`: `object` (For `source_type: "url"`, a key-value map of _all_ HTTP response headers received from the remote server. Header names **must be lowercased** for consistency).
      - `final_url?`: `string` (For URL sources, if HTTP redirects occurred, this is the final URL. Only present if different from original `source` URL).
  - **Additional fields for `operation: "diff"` on `status: "success"`:**
    - `sources_compared`: `string[]` (The two absolute, resolved local file paths that were compared).
    - `diff_format_used`: `string` (The format of the diff, e.g., `"unified"`).
    - `diff_content`: `string` (The textual representation of the differences generated by the `diff` library).

#### 5.2. Tool: `write`

- **Description:** (AI to generate based on full capabilities listed below)
- **Parameters:**
  - `action`: `string` (Required). Valid values: `"put" | "mkdir" | "copy" | "move" | "delete" | "touch" | "archive" | "unarchive"`.
  - `entries?`: `object[]` (Required for actions: `"put"`, `"mkdir"`, `"copy"`, `"move"`, `"delete"`, `"touch"`. This array **must not** be empty for these actions. If it is missing or empty, the server **must** return an `ERR_INVALID_PARAMETER` error with a message like "`entries` array is required and cannot be empty for action '[action_name]'."). Each object within the `entries` array defines a single operation with its specific parameters:
    - **Parameters for each entry in `action: "put"`:**
      - `path`: `string` (Required). The local filesystem path where the file will be written.
      - `content`: `string` (Required). The content to write to the file.
      - `input_encoding?`: `string` (Optional, default: `"text"`). Valid values: `"text"` (content is a UTF-8 string) or `"base64"` (content is a base64 encoded string, which will be decoded to binary before writing).
      - `write_mode?`: `string` (Optional, default: `"overwrite"`). Valid values: `"overwrite"` (creates a new file or truncates and overwrites an existing one) or `"append"` (adds content to the end of an existing file; creates the file as new if it does not exist).
    - **Parameters for each entry in `action: "mkdir"`:**
      - `path`: `string` (Required). The local filesystem path of the directory to create.
      - `recursive?`: `boolean` (Optional, default: `false`). If `true`, parent directories will be created if they do not exist (similar to `mkdir -p`). This operation is idempotent; if the directory (and parents if `recursive:true`) already exists, it succeeds silently.
    - **Parameters for each entry in `action: "copy"`:**
      - `source_path`: `string` (Required). The path to the source file or directory.
      - `destination_path`: `string` (Required). The path to the destination.
        - If `destination_path` is an existing directory, `source_path` (whether file or directory) is copied _inside_ `destination_path` (e.g., `cp source_file dest_dir/` results in `dest_dir/source_file`).
        - If `source_path` is a directory, its contents are copied recursively.
        - If `destination_path` names an existing file, it is overwritten.
    - **Parameters for each entry in `action: "move"`:**
      - `source_path`: `string` (Required).
      - `destination_path`: `string` (Required).
        - If `destination_path` is an existing directory, `source_path` is moved _inside_ `destination_path`.
        - Otherwise, `source_path` is renamed or moved to `destination_path`. Overwrites an existing file at `destination_path`.
    - **Parameters for each entry in `action: "delete"`:**
      - `path`: `string` (Required). Path to the file or directory to delete.
      - `recursive?`: `boolean` (Optional, default: `false`). **Must be `true`** to delete a directory that is not empty. This parameter is ignored if `path` points to a file.
    - **Parameters for each entry in `action: "touch"`:**
      - `path`: `string` (Required). Creates an empty file if it doesn't exist. If it does exist, its access (atime) and modification (mtime) timestamps are updated to the current server time. Idempotent.
  - **Parameters specific to `action: "archive"` (This is a single operation, not batched via `entries` field):**
    - `source_paths`: `string[]` (Required). An array of one or more local file or directory paths to be included in the archive. If any path in this array does not exist or is inaccessible, it is skipped, and a note about these skipped paths **must** be included in the `skipped_sources` field of the success response.
    - `archive_path`: `string` (Required). The full local filesystem path where the resulting archive file will be created. If the file already exists, it will be overwritten.
    - `format?`: `string` (Optional, default: `"zip"`). Valid values: `"zip" | "tar.gz" | "tgz"` (`"tgz"` is an alias for `"tar.gz"`). Server must use appropriate libraries (`adm-zip` for zip, `tar` for tar.gz).
    - `recursive_source_listing?`: `boolean` (Optional, default: `true`). If `true` and a path in `source_paths` is a directory, its contents are added recursively to the archive, preserving the internal directory structure relative to that source directory within the archive.
  - **Parameters specific to `action: "unarchive"` (This is a single operation, not batched via `entries` field):**
    - `archive_path`: `string` (Required). The local filesystem path to the archive file to be decompressed.
    - `destination_path`: `string` (Required). The local directory path where the contents of the archive will be extracted. This directory will be created if it doesn't already exist (including parent directories if necessary).
    - `format?`: `string` (Optional). Valid values: `"zip" | "tar.gz" | "tgz"`. If omitted, the server **must** attempt to auto-detect the format by:
      1.  Checking the `archive_path`'s file extension (`.zip`, `.tar.gz`, `.tgz`).
      2.  If the extension is ambiguous or unrecognized for these types, it should then attempt to identify the format by inspecting the file's magic numbers for supported types (`zip`, `tar.gz`).
          If auto-detection fails to identify a supported format, an `ERR_UNSUPPORTED_ARCHIVE_FORMAT` or `ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT` error is returned.
- **Returns:**
  - For batched actions (`put`, `mkdir`, `copy`, `move`, `delete`, `touch`): An **array** of result objects, one for each item in the input `entries` array, in the same order.
  - For single operations (`archive`, `unarchive`): A **single** result object.
  - _(The first successful response of a server session may prepend the one-time informational notice object if default paths were used. Clients should handle this possibility.)_
  - **Common fields for each result object:**
    - `status`: `string` (`"success" | "error"`).
    - If `status: "error"`, then `error_code: string` and `error_message: string` are also present.
    - `action_performed`: `string` (The specific action that was attempted from the request, e.g., `"put"`, `"mkdir"`, `"archive"`).
    - `path?`: `string` (The primary path involved in the operation. For `put`, `mkdir`, `delete`, `touch`: the target path. For `archive`: the `archive_path`. For `unarchive`: the `archive_path`).
    - `source_path?`: `string` (For `copy`, `move` actions, the source path for that specific entry from the `entries` array).
    - `destination_path?`: `string` (For `copy`, `move` actions, the destination path for that specific entry. For `unarchive`, the `destination_path` where files were extracted).
  - **Additional fields on `status: "success"`:**
    - `bytes_written?`: `integer` (For `action: "put"`).
    - `message?`: `string` (Optional, for additional human-readable context, e.g., "Directory created.", "File timestamps updated.", "Archive created successfully.").
    - `skipped_sources?`: `string[]` (For `action: "archive"`, an array of resolved absolute source paths that were skipped because they didn't exist or were inaccessible. Omitted if no sources were skipped).
    - `extracted_files_count?`: `integer` (For `action: "unarchive"`, the total number of files and directories successfully extracted to the `destination_path`. Omitted if not applicable or extraction failed).

#### 5.3. Tool: `list`

- **Description:** (AI to generate based on full capabilities listed below)
- **Parameters:**
  - `operation`: `string` (Required). Valid values: `"entries" | "system_info"`.
  - **Parameters specific to `operation: "entries"`:**
    - `path`: `string` (Required). The local directory path to list.
    - `recursive_depth?`: `integer` (Optional, default: `0`).
      - `0`: Non-recursive (lists immediate children only).
      - `N > 0`: Recurses N levels deep.
      - Any value greater than `CONDUIT_MAX_RECURSIVE_DEPTH` or `-1` (or any negative number) will be effectively capped by `CONDUIT_MAX_RECURSIVE_DEPTH`.
    - `calculate_recursive_size?`: `boolean` (Optional, default: `false`). If `true`, for each directory entry (including the top-level `path` itself if it's a directory being listed with `recursive_depth:0` or greater and it's not a symlink being listed directly without following), its `size_bytes` field will attempt to be the sum of all files within it and its subdirectories (respecting the `recursive_depth` and subject to `CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS`).
  - **Parameters specific to `operation: "system_info"`:**
    - `info_type`: `string` (Required). Valid values: `"server_capabilities" | "filesystem_stats"`.
    - `path?`: `string` (Optional). Only used if `info_type: "filesystem_stats"`. Specifies a path within an allowed directory; statistics will be for the volume containing this path.
- **Returns:**
  - **For `operation: "entries"`:** An array of `EntryInfo` objects.
    - Each `EntryInfo` object:
      - `name`: `string` (Filename or directory name).
      - `path`: `string` (Full absolute, resolved path to the entry).
      - `type`: `string` (`"file" | "directory"`).
      - `size_bytes?`: `integer` (Size of the file. For directories: if `calculate_recursive_size` is `false`, this is the OS-reported directory size (often small, e.g., inode size or block allocation). If `calculate_recursive_size` is `true`, this is the sum of all contained file sizes. Will be `null` if calculation timed out, failed, or was not applicable for that entry (e.g. a symlink that wasn't followed to a dir), accompanied by `recursive_size_calculation_note`).
      - `mime_type?`: `string` (For `type: "file"`, detected MIME type using `file-type`).
      - `created_at_iso`: `string` (ISO 8601 UTC timestamp from OS file stats).
      - `modified_at_iso`: `string` (ISO 8601 UTC timestamp from OS file stats).
      - `permissions_octal?`: `string` (For local files/directories, e.g., `"0755"`).
      - `permissions_string?`: `string` (For local files/directories, e.g., `"rwxr-xr-x"` Unix-style).
      - `is_symlink?`: `boolean` (True if this entry itself is a symbolic link, regardless of whether it was resolved to get its target's info).
      - `symlink_target_path?`: `string` (If `is_symlink: true`, this is the path the symlink points to. May be relative or absolute as read from the link. Omitted otherwise).
      - `children?`: `EntryInfo[]` (Array of child `EntryInfo` objects, present if `recursive_depth > 0` and the current entry is a directory (after symlink resolution if applicable) that has children within the depth limit).
      - `recursive_size_calculation_note?`: `string` (Optional. E.g., `"Calculation timed out due to server limit (60000ms)"`, `"Partial size: depth limit reached during calculation"`, if `calculate_recursive_size` was true but encountered issues or couldn't complete fully for this entry).
  - **For `operation: "system_info"` with `info_type: "server_capabilities"`:** A single object:
    - `server_version`: `string` (e.g., "1.0.0", from `package.json`).
    - `active_configuration`: `object` (A map of currently active `CONDUIT_*` settings. `CONDUIT_ALLOWED_PATHS` should be an array of resolved absolute strings. Numerical values should be numbers, booleans as booleans).
    - `supported_checksum_algorithms`: `string[]` (e.g., `["md5", "sha1", "sha256", "sha512"]`).
    - `supported_archive_formats`: `string[]` (e.g., `["zip", "tar.gz", "tgz"]`).
    - `default_checksum_algorithm`: `string` (Value of `CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`).
    - `max_recursive_depth`: `integer` (Value of `CONDUIT_MAX_RECURSIVE_DEPTH`).
    - `system_temp_directory`: `string` (Resolved path of `os.tmpdir()`).
  - **For `operation: "system_info"` with `info_type: "filesystem_stats"`:**
    - **If `path` parameter is provided, valid, and within an allowed path:** A single object:
      - `path_queried`: `string` (The absolute, resolved path for which stats were retrieved).
      - `total_bytes`: `integer` (Total size of the filesystem volume containing `path_queried`).
      - `free_bytes`: `integer` (Free space available on the volume to the current user).
      - `available_bytes`: `integer` (Often same as `free_bytes`, but can differ for privileged users).
      - `used_bytes`: `integer` (Total `total_bytes` - `free_bytes`).
    - **If `path` parameter is NOT provided:** A single informational object:
      ```json
      {
        "info_type_requested": "filesystem_stats",
        "status_message": "No specific path provided for filesystem_stats. To retrieve statistics for a filesystem volume, please provide a 'path' parameter pointing to a location within one of the configured allowed paths.",
        "server_version": "1.0.0",
        "server_start_time_iso": "YYYY-MM-DDTHH:mm:ss.sssZ",
        "configured_allowed_paths": ["/actual/resolved/path/one", "/actual/resolved/path/two"]
      }
      ```
  - _(The first successful response of a server session may prepend the one-time informational notice object if default paths were used. Clients should handle this possibility.)_

#### 5.4. Tool: `find`

- **Description:** (AI to generate based on full capabilities listed below)
- **Parameters:**
  - `base_path`: `string` (Required). The local directory path from which the search will originate.
  - `recursive?`: `boolean` (Optional, default: `true`). If `true`, the search will extend into subdirectories, respecting `CONDUIT_MAX_RECURSIVE_DEPTH`. If `false`, only entries directly within `base_path` are considered.
  - `match_criteria`: `object[]` (Required). An array of criterion objects. An entry is included in the results only if it **matches ALL criteria** defined in this array (implicit AND logic between criterion objects).
    - Each criterion object **must** have a `type` field, and other fields depending on the `type`:
      - **`type: "name_pattern"`**
        - `pattern`: `string` (Required). A glob pattern (e.g., `*.txt`, `image[0-9]?.png`, `**/specific_dir/*.log`) to match against entry names (filenames or directory names). Standard glob syntax should be supported (e.g., by a library like `micromatch`).
      - **`type: "content_pattern"`**
        - `pattern`: `string` (Required). The text or regular expression pattern to search for within the content of files.
        - `is_regex?`: `boolean` (Optional, default: `false`). If `true`, the `pattern` string is treated as a JavaScript-compatible regular expression string (e.g., `"^error\\s\\d+$"`). If `false`, `pattern` is treated as a literal string to be found.
        - `case_sensitive?`: `boolean` (Optional, default: `false`). If `is_regex: false`, this controls case sensitivity of the literal string search. If `is_regex: true`, this flag is typically ignored as case sensitivity is controlled by regex flags (e.g., `/pattern/i` for case-insensitive).
        - `file_types_to_search?`: `string[]` (Optional). An array of file extensions (e.g., `[".txt", ".log", ".md"]`) to restrict content searching to these types of files. If omitted, the server will attempt to search content only in files that are presumed to be text-based. This presumption is made by:
          1.  Checking the file extension against an internal list of common text file extensions (e.g., `.txt`, `.md`, `.json`, `.xml`, `.html`, `.js`, `.py`, `.sh`, `.csv`, `.ini`, `.yaml`).
          2.  Using `file-type` to get the MIME type. If it's a known text-friendly type (e.g., `text/*`, `application/json`), it's included.
              Files identified as binary by these methods (e.g. `image/*`, `application/zip`) **must be skipped** for content searching, regardless of `file_types_to_search`, to prevent issues. No error is generated for skipped binary files.
      - **`type: "metadata_filter"`**
        - `attribute`: `string` (Required). The metadata attribute to filter on. Valid values:
          - `"name"` (string: filename or directory name)
          - `"size_bytes"` (integer: file size)
          - `"created_at_iso"` (string: ISO 8601 timestamp for creation time)
          - `"modified_at_iso"` (string: ISO 8601 timestamp for last modification time)
          - `"entry_type"` (string: value must be exactly `"file"` or `"directory"`)
          - `"mime_type"` (string: MIME type, typically for files only)
        - `operator`: `string` (Required). The comparison operator.
          - For string attributes (`name`, `entry_type`, `mime_type`): `"equals" | "not_equals" | "contains" | "starts_with" | "ends_with" | "matches_regex"`.
          - For numeric attributes (`size_bytes`): `"eq"` (equals), `"neq"` (not equals), `"gt"` (greater than), `"gte"` (greater than or equal to), `"lt"` (less than), `"lte"` (less than or equal to).
          - For date attributes (`created_at_iso`, `modified_at_iso`): `"before"` (strictly before), `"after"` (strictly after), `"on_date"` (date part matches).
        - `value`: `any` (Required). The value to compare against. Its type must be appropriate for the `attribute`:
          - `string` for `name`, `entry_type`, `mime_type`. For `operator: "matches_regex"`, `value` is a regex string (e.g., `"^start.*end$"`).
          - `integer` for `size_bytes`.
          - `string` (ISO 8601 date for `on_date` e.g., `"2023-10-26"`; or ISO 8601 datetime string for `before`/`after` e.g., `"2023-10-26T12:00:00Z"`) for date attributes. The server must parse these robustly for comparison.
        - `case_sensitive?`: `boolean` (Optional, default: `false`). Applies to string attribute operators (`equals`, `not_equals`, `contains`, `starts_with`, `ends_with`). Ignored if `operator` is `matches_regex` (regex flags should control case sensitivity, e.g. `/pattern/i`).
  - `entry_type_filter?`: `string` (Optional, default: `"any"`). A shorthand filter for entry type. Valid values: `"file" | "directory" | "any"`. If specified, acts as an additional AND criterion equivalent to a `metadata_filter` for `entry_type`.
- **Returns:** An array of `EntryInfo` objects that match all specified criteria. The structure of each `EntryInfo` object is identical to that returned by `list.operation: "entries"`, but will not contain the `children` or `recursive_size_calculation_note` fields as this is a flat list of matching results.
  - _(The first successful response of a server session may prepend the one-time informational notice object if default paths were used. Clients should handle this possibility.)_

### 6. Project Structure (Conceptual - Node.js/TypeScript)

```
conduit-mcp/
├── dist/                     # Compiled JavaScript output (e.g., after `npm run build`)
├── src/
│   ├── server.ts             # Main server entry point, MCP request/response router
│   ├── tools/                # Implementations for each of the 4 tools
│   │   ├── readTool.ts
│   │   ├── writeTool.ts
│   │   ├── listTool.ts
│   │   └── findTool.ts
│   ├── operations/           # Business logic for specific operations/actions if they are complex
│   │   ├── getContentOps.ts    # Includes URL fetching, partial reads, content type handling
│   │   ├── putContentOps.ts    # Includes file writing, appending
│   │   ├── metadataOps.ts      # Logic for fetching and formatting metadata
│   │   ├── archiveOps.ts       # Zip/Tar.gz creation and extraction
│   │   ├── diffOps.ts          # File comparison logic
│   │   └── findOps.ts          # Core find logic and criteria matching
│   ├── core/                 # Core functionalities shared across tools
│   │   ├── securityHandler.ts # Path validation (allowed paths, symlink resolution)
│   │   ├── fileSystemOps.ts  # Low-level fs promise wrappers, path manipulation
│   │   ├── webFetcher.ts     # HTTP client wrapper, HTML cleaning pipeline (Readability, Turndown)
│   │   ├── imageProcessor.ts # Image compression logic (using Sharp)
│   │   ├── configLoader.ts   # Environment variable parsing, config object (with defaults, ~ resolution)
│   │   ├── noticeService.ts  # Manages the one-time informational notice state and content
│   │   └── mimeService.ts    # MIME type detection logic (using file-type)
│   ├── utils/                # General utility functions
│   │   ├── logger.ts         # Internal logging setup (Pino), configured to be no-op to stdout/stderr
│   │   ├── errorHandler.ts   # Standardized error object creation and mapping to error codes
│   │   └── dateTime.ts       # Date/time formatting (ISO 8601 UTC)
│   └── types/                # TypeScript interface definitions
│       ├── mcp.ts            # General MCP request/response base structures
│       ├── tools.ts          # Specific parameter/return types for each tool and their operations/actions
│       ├── config.ts         # Types for the parsed server configuration object
│       └── common.ts         # Common shared types (e.g., EntryInfo)
├── package.json
├── tsconfig.json
├── .env.example              # Example environment file showing all CONDUIT_* vars and their defaults/examples
├── start.sh                  # Script to run locally (as defined in Section 3)
├── README.md                 # (AI to generate detailed descriptions for each tool, installation, config, usage based on this spec)
└── DEVELOPMENT.md            # (AI to generate: Project Structure, Prerequisites, Getting Started, Building, Running Dev, Testing, Linting/Formatting, Contribution Guidelines - Conventional Commits, PR process)
```

### 7. Key NPM Dependencies (Node.js)

- **HTTP Client:** `axios` (preferred for robust timeout and error handling, request/response interceptors).
- **Filesystem:** Node.js built-in `fs.promises` API.
- **Webpage Cleaning/Parsing:** `jsdom` (for DOM environment), `@mozilla/readability` (for main content extraction), `turndown` (for HTML to Markdown).
- **Image Processing:** `sharp` (for image compression and manipulation).
- **Archiving:** `adm-zip` (for .zip create/extract), `tar` (for .tar.gz/.tgz create/extract).
- **MIME Types:** `file-type` (from sindresorhus, for magic number based detection of local files).
- **Logging (Internal):** `pino` (for structured, performant JSON logging; configured not to output to stdout/stderr by default for MCP compliance).
- **TypeScript Execution (for dev via `start.sh`):** `tsx`.
- **Checksums:** Node.js built-in `crypto` module.
- **Diffing:** `diff` (for generating unified diffs between files).
- **Path Resolution:** Node.js built-in `path` and `os` (for `os.homedir()`).

### 8. Testing Plan (High-Level for AI Implementation)

The AI **must** generate a comprehensive suite of automated tests covering the following categories. Tests should be written using a standard Node.js testing framework like Jest or Vitest.

- **Unit Tests:**
  - Each individual function and class method within `src/core/`, `src/operations/`, and `src/utils/` must be unit tested in isolation.
  - All external I/O (filesystem calls via `fs`, network HTTP requests) and complex external library interactions (e.g., `sharp`, `jsdom`, `turndown`, archive libraries) **must** be mocked to ensure tests are fast, deterministic, and focused on the unit's logic.
  - Test `configLoader.ts` thoroughly with various environment variable inputs: valid values, invalid values (e.g., non-integer for a size), missing values (to check default application), empty strings, and resolution of `~` in `CONDUIT_ALLOWED_PATHS`.
  - Test `securityHandler.ts` path validation: correct identification of paths within/outside `CONDUIT_ALLOWED_PATHS`, correct handling of `.` and `..` segments, correct symlink resolution and subsequent validation against allowed paths. Test cases for attempted path traversal.
  - Test parameter validation logic within each tool module for all operations/actions: missing required parameters, incorrect data types, invalid enum values.
  - Test `noticeService.ts` logic for the one-time informational message: correct state tracking, correct message formatting.
- **Integration Tests (Tool-Level and Inter-Module):**
  - For each tool (`read`, `write`, `list`, `find`) and each of its operations/actions:
    - Set up a temporary, controlled "mock" filesystem structure for tests involving local files (e.g., using a library like `memfs` or by scripting creation/deletion of temporary directories and files on the actual filesystem in a dedicated test area).
    - Utilize a mock HTTP server (e.g., `nock` or `msw`) to simulate various URL responses: success with different content types, HTTP error codes, servers that support/don't support HTTP Range requests, delayed responses (for timeout testing).
    - Test the full flow of valid requests, from parameter parsing to data processing and response generation.
    - Test with invalid inputs to ensure correct error codes and messages are generated.
    - Thoroughly test batch operations in `write` tool: correct processing of all items in `entries`, correct individual error reporting for any failed items within a successful batch response.
    - Verify enforcement of resource limits (`CONDUIT_MAX_FILE_READ_BYTES`, `CONDUIT_MAX_URL_DOWNLOAD_BYTES`).
    - Test the `read.format: "markdown"` pipeline for URLs: successful HTML cleaning, correct fallback for non-HTML content.
    - Test `read.format: "base64"` with image sources, including scenarios above and below `CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES` to verify compression logic.
    - Test `write` archive/unarchive operations for both `zip` and `tar.gz` with various file/directory structures, including empty files/directories and skipped sources.
    - Test `find` with complex combinations of `match_criteria` (name, content, metadata), including different operators and `case_sensitive` flags.
    - Test `list.calculate_recursive_size` including the `CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS` behavior (verify `size_bytes` is `null` and note is present on timeout).
- **End-to-End (MCP Protocol Level) Tests:**
  - Automate starting an actual instance of the `conduit-mcp` server (using `start.sh` or directly via `node dist/server.js`).
  - Craft JSON strings representing valid MCP requests for each tool and operation/action. Pipe these requests to the server's standard input.
  - Capture the server's standard output and parse the JSON MCP response.
  - Validate that the response structure, status, content, and error details strictly match this specification for various valid and invalid inputs.
  - Test the "first use informational message" behavior: ensure it's prepended correctly only on the first successful call when default paths are used, and not on subsequent calls or if paths are explicitly set.
  - Test sequences of operations that depend on each other (e.g., `write.put` a file, then `read.content` it, then `find` it using metadata, then `write.delete` it).
- **Security Specific Tests:**
  - Craft specific test cases that attempt path traversal using various encodings and relative path constructions (e.g., `../../`, `%2E%2E%2F`).
  - Test symlink resolution to ensure it correctly denies access if the real path is outside `CONDUIT_ALLOWED_PATHS`.
  - Test scenarios that could lead to ReDoS (Regular Expression Denial of Service) if user-provided patterns are used in regexes without proper sanitization or if complex regexes are used in `find.content_pattern` (ensure regexes are constructed safely or timeouts are in place for regex execution).
- **Configuration Tests:**
  - Test server startup and operational behavior with a matrix of different `CONDUIT_*` environment variable settings: various valid allowed paths (single, multiple, with `~`), different log levels (for internal logging if checked), different timeouts and resource limits.
  - Verify the server correctly applies the `~:/tmp` default for `CONDUIT_ALLOWED_PATHS` if the variable is unset or empty.
  - Verify server correctly parses string numbers and booleans from env vars.
- **Test Coverage:** Aim for high unit and integration test coverage, measured by a code coverage tool (e.g., >90%).

### Appendix A: Error Codes

This list defines unique error codes the server must use in its JSON error responses. Messages should be descriptive.

- **General MCP/Request Errors:**
  - `ERR_MCP_INVALID_REQUEST`: Malformed or unparsable MCP request JSON.
  - `ERR_UNKNOWN_TOOL`: The requested `toolName` is not recognized by the server.
  - `ERR_UNKNOWN_OPERATION_ACTION`: The `operation` (for `read`/`list`) or `action` (for `write`) is not valid for the specified tool.
  - `ERR_INVALID_PARAMETER`: A required parameter is missing, or a parameter has an invalid value, type, or format. The `error_message` should specify which parameter and why it's invalid.
  - `ERR_MISSING_ENTRIES_FOR_BATCH`: The `entries` array is missing or empty for a `write` tool action that requires it.
- **Configuration & Initialization Errors:**
  - `ERR_CONFIG_INVALID`: A `CONDUIT_*` environment variable has an unparsable or fundamentally invalid value (e.g., non-numeric for a size, invalid enum for `LOG_LEVEL`). Message should specify the variable.
  - `ERR_FS_BAD_ALLOWED_PATH`: A path provided in `CONDUIT_ALLOWED_PATHS` is invalid, unresolvable, or does not point to a directory. Server may not start or may operate with a reduced set of allowed paths if others are invalid.
- **Filesystem Errors:**
  - `ERR_FS_ACCESS_DENIED`: Filesystem access denied (e.g., operation targets a path outside resolved `CONDUIT_ALLOWED_PATHS`, or underlying OS permissions prevent access).
  - `ERR_FS_PATH_RESOLUTION_FAILED`: Error resolving a path component (e.g., a segment is not a directory when expecting one, `~` resolution failed unexpectedly).
  - `ERR_FS_NOT_FOUND`: The specified file or directory path does not exist.
  - `ERR_FS_IS_FILE`: Expected a directory but found a file at the path.
  - `ERR_FS_IS_DIRECTORY`: Expected a file but found a directory at the path.
  - `ERR_FS_ALREADY_EXISTS`: Attempted to create a file/directory that already exists, and the operation (e.g., `write.put` without overwrite, `mkdir` without idempotency for some reason) does not support overwriting or idempotent success.
  - `ERR_FS_READ_FAILED`: Generic error during file read operation (e.g., I/O error).
  - `ERR_FS_WRITE_FAILED`: Generic error during file write/append operation.
  - `ERR_FS_DELETE_FAILED`: Error deleting a file or directory (e.g., directory not empty and `recursive: false` was specified, or OS-level lock).
  - `ERR_FS_OPERATION_FAILED`: Catch-all for other filesystem operations like copy, move, touch, list, find if a more specific error isn't applicable.
  - `ERR_FS_BAD_PATH_INPUT`: An input path string is malformed or contains invalid characters for the OS filesystem.
- **URL/HTTP Errors:**
  - `ERR_HTTP_INVALID_URL`: The provided URL string is malformed or uses an unsupported scheme (only http/https supported).
  - `ERR_HTTP_REQUEST_FAILED`: URL fetch failed due to a network issue (e.g., DNS resolution failure, connection refused, unreachable host).
  - `ERR_HTTP_TIMEOUT`: URL fetch exceeded `CONDUIT_HTTP_TIMEOUT_MS`.
  - `ERR_HTTP_STATUS_ERROR`: The remote server responded with an HTTP error status code (e.g., 403 Forbidden, 404 Not Found, 500 Internal Server Error). The MCP error response should include the received HTTP status code in its details.
  - `ERR_HTTP_RANGE_NOT_SATISFIABLE`: An HTTP Range request was made, but the remote server indicated it cannot satisfy the range (e.g., HTTP 416).
- **Content Processing & Formatting Errors:**
  - `ERR_MARKDOWN_CONVERSION_FAILED`: A general error occurred during the HTML to Markdown conversion process (e.g., Turndown library error).
  - `ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED`: The Readability-style library failed to extract meaningful main content from the HTML.
  - `ERR_IMAGE_PROCESSING_FAILED`: An error occurred during image compression or manipulation using the `sharp` library.
  - `ERR_UNSUPPORTED_IMAGE_TYPE`: The image type is not supported by the `sharp` library for the requested processing.
  - `ERR_CHECKSUM_FAILED`: An error occurred while calculating the checksum of a file or URL content.
  - `ERR_UNSUPPORTED_CHECKSUM_ALGORITHM`: The specified `checksum_algorithm` is not in the supported list (`md5`, `sha1`, `sha256`, `sha512`).
  - `ERR_DIFF_FAILED`: An error occurred during the file diff operation.
  - `ERR_CANNOT_REPRESENT_BINARY_AS_TEXT`: Client explicitly requested `format: "text"` for content identified as binary, and the placeholder is being returned. (This is more of an informational status than a hard error, but uses the error structure for consistency if desired, or could be handled via a note in a success response).
- **Archive Errors:**
  - `ERR_ARCHIVE_CREATION_FAILED`: The archiving operation (e.g., zip, tar.gz creation) failed.
  - `ERR_ARCHIVE_READ_FAILED`: Failed to read one or more source files/directories during archiving.
  - `ERR_UNARCHIVE_FAILED`: The decompression/extraction operation failed (e.g., corrupted archive, write errors during extraction).
  - `ERR_UNSUPPORTED_ARCHIVE_FORMAT`: The specified or auto-detected archive format is not supported by the server (e.g., client requests `.rar` but only zip/tar.gz implemented).
  - `ERR_COULD_NOT_DETECT_ARCHIVE_FORMAT`: Failed to auto-detect a supported archive format when `format` was not provided for `unarchive`.
  - `ERR_ARCHIVE_PATH_INVALID`: The `archive_path` or `destination_path` for archive operations is invalid or inaccessible.
- **Limit/Constraint Errors:**
  - `ERR_RESOURCE_LIMIT_EXCEEDED`: A configured resource limit was surpassed. The `error_message` **must** specify which limit (e.g., "Incoming MCP request payload exceeds CONDUIT_MAX_PAYLOAD_SIZE_BYTES", "File read exceeds CONDUIT_MAX_FILE_READ_BYTES", "URL download exceeds CONDUIT_MAX_URL_DOWNLOAD_BYTES").
  - `ERR_RECURSIVE_OPERATION_TOO_DEEP`: A recursive operation (e.g., `list.entries`, `find`) attempted to go deeper than `CONDUIT_MAX_RECURSIVE_DEPTH`.
  - `ERR_RECURSIVE_SIZE_TIMEOUT`: The `calculate_recursive_size` operation in `list.entries` exceeded the internal `CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS`.
- **Server Errors:**
  - `ERR_INTERNAL_SERVER_ERROR`: An unexpected error occurred on the server side that doesn't fit other categories. The `error_message` should provide some context if possible, without exposing sensitive details.
  - `ERR_NOT_IMPLEMENTED`: A specific feature, parameter option, or code path is recognized by the spec but not yet implemented in the current server version.
