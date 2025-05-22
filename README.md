# conduit-mcp

**conduit-mcp: MCP server for rich file system ops, web content fetching (HTML/Markdown), image processing, search, diff & archives, via concise tools.**

## Overview

`conduit-mcp` is a Node.js based MCP (Model Context Protocol) server designed to act as an intelligent data channel. It exposes a concise set of powerful tools for reading, writing, listing, and finding data across local filesystems (within user-configured allowed paths) and the web. All operational feedback, including one-time notices about default configurations, is communicated through MCP tool responses.

The server aims to provide a versatile and efficient way for AI models and other clients to interact with various data sources and perform common data manipulation tasks, adhering strictly to the MCP communication protocol.

## Key Features

*   **Comprehensive File System Operations:**
    *   Read, write (overwrite, append), copy, move, delete files and directories.
    *   Create directories recursively (`mkdir -p` like).
    *   Touch files to update timestamps or create empty files.
    *   List directory contents with recursive depth control and optional recursive size calculation.
    *   Advanced search for files and directories by name (glob patterns), content (text/regex), and metadata attributes (size, dates, type, MIME).
*   **Web Content Retrieval:**
    *   Fetch content from HTTP/S URLs.
    *   Clean HTML webpages to Markdown using a Readability-based pipeline.
    *   Retrieve metadata from web resources (HTTP headers, Content-Type, Last-Modified).
*   **Data Processing & Formatting:**
    *   Read file/URL content as text or base64.
    *   Calculate checksums (MD5, SHA1, SHA256, SHA512).
    *   Generate unified diffs between two local files.
    *   Optional automatic image compression for large images when requested in base64 format (JPEG, PNG, WebP).
*   **Archive Management:**
    *   Create ZIP and TAR.GZ archives from specified local files/directories.
    *   Extract ZIP and TAR.GZ archives to a specified destination.
*   **Secure and Configurable:**
    *   Operates only within user-defined allowed paths (defaults to `~:/tmp` if not set).
    *   Robust path validation and symlink resolution to prevent unauthorized access.
    *   Configurable via environment variables for timeouts, resource limits, default behaviors.
*   **MCP Compliant:**
    *   Strict adherence to MCP for requests and responses.
    *   Detailed error codes and messages.
    *   Includes a one-time informational notice in the first MCP response if default allowed paths are used.
*   **Batch Operations:** Supports batching multiple file operations (put, mkdir, copy, move, delete, touch) in a single `write` tool request for efficiency.

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

There are two primary ways to use `conduit-mcp`:

### 1. Using `npx` (Recommended for most users)

This method ensures you are using the latest published version of `conduit-mcp` from NPM.

```bash
# No installation step needed, npx handles it.
# Configure your MCP client to use the command below.
```

Your MCP client (e.g., in its `mcp.json`) should be configured to invoke the server like this:

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

### 2. Running Locally (for Development or Direct Use)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/conduit-mcp.git # Replace with actual repo URL
    cd conduit-mcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Run the server:**
    The server can be run using the `start.sh` script located in the project root. This script will automatically try to run the compiled version from `dist/` or fall back to running the TypeScript source directly using `tsx`.

    Configure your MCP client to point to this script:

    ```json
    {
      "mcpServers": {
        "conduit_mcp_local": {
          "command": "/absolute/path/to/your/cloned/conduit-mcp/start.sh",
          "env": {
            "LOG_LEVEL": "DEBUG",
            "CONDUIT_ALLOWED_PATHS": "~", 
            "CONDUIT_MAX_FILE_READ_BYTES": "104857600"
          }
        }
      }
    }
    ```

    **Note on `start.sh`:**
    The `start.sh` script handles:
    *   Setting a default `LOG_LEVEL` if not provided.
    *   Prioritizing the compiled JavaScript version (`dist/server.js`).
    *   Falling back to `tsx` to run `src/server.ts` if the compiled version is not found.
    *   Attempting a local, temporary install of `tsx` if it's not found globally or in local `node_modules` (this is for developer convenience and doesn't save `tsx` to `package.json`).

## MCP Client Configuration

As shown in the "Installation & Usage" section, you configure your MCP client by specifying the command to run (`npx conduit-mcp@latest` or the path to `start.sh`) and any necessary environment variables within the `env` block for that server definition.

The `CONDUIT_ALLOWED_PATHS` environment variable is crucial for defining the server's access scope. See the "Configuration" section below for more details.

## Configuration (Environment Variables)

The server is configured using the following environment variables. These are typically set in your MCP client's configuration for the server.

| Variable                                  | Default                        | Description                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                               | `"INFO"`                       | For internal server logging (not to MCP client). Valid: `"TRACE"`, `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, `"FATAL"`.                                                                                                                                            |
| **`CONDUIT_ALLOWED_PATHS`**               | **`"~:/tmp"`**                 | **Crucial for security.** Colon-separated list of absolute local directory paths the server can access. `~` is resolved to the user's home. If not set, defaults to home and system temp. **A one-time notice is sent via MCP if defaults are used.**                       |
| `CONDUIT_HTTP_TIMEOUT_MS`                 | `"30000"` (30s)                | Timeout in milliseconds for all external HTTP/S requests.                                                                                                                                                                                                             |
| `CONDUIT_MAX_PAYLOAD_SIZE_BYTES`          | `"10485760"` (10MB)            | Maximum size of the entire incoming MCP request string on `stdin`.                                                                                                                                                                                                    |
| `CONDUIT_MAX_FILE_READ_BYTES`             | `"52428800"` (50MB)            | Maximum size for an individual local file read operation.                                                                                                                                                                                                           |
| `CONDUIT_MAX_URL_DOWNLOAD_BYTES`          | `"20971520"` (20MB)            | Maximum size for content downloaded from a URL.                                                                                                                                                                                                                     |
| `CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES` | `"1048576"` (1MB)             | Images larger than this (before base64 encoding) will attempt compression if `read.format: "base64"` is requested.                                                                                                                                                     |
| `CONDUIT_IMAGE_COMPRESSION_QUALITY`       | `"75"` (Range 1-100)           | Quality setting for JPEG/WebP compression.                                                                                                                                                                                                                          |
| `CONDUIT_DEFAULT_CHECKSUM_ALGORITHM`      | `"sha256"`                     | Default algorithm if `read.format: "checksum"` is used without `checksum_algorithm`. Supported: `"md5"`, `"sha1"`, `"sha256"`, `"sha512"`.                                                                                                                          |
| `CONDUIT_MAX_RECURSIVE_DEPTH`             | `"10"`                         | Maximum depth for recursive operations like `list.entries` and `find`.                                                                                                                                                                                              |
| `CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS`       | `"60000"` (60s)                | Server-side timeout for `list.entries` with `calculate_recursive_size: true`.                                                                                                                                                                                     |

**Important Note on `CONDUIT_ALLOWED_PATHS`:**

*   This variable defines a colon-separated list of local directory paths (e.g., `CONDUIT_ALLOWED_PATHS="/path/to/data:~/agent_files"`).
*   The `~` character at the start of a path segment is resolved to the user's home directory.
*   If `CONDUIT_ALLOWED_PATHS` is **not explicitly set** by the user or is an empty string, the server **must** default to using `~:/tmp` (the user's home directory and the system temporary directory).
*   In this default scenario (when `~:/tmp` is used because `CONDUIT_ALLOWED_PATHS` was not set), the server will send a **one-time informational notice** as part of its very first successful tool response in that session. This notice (with `notice_code: "DEFAULT_PATHS_USED"`) will detail the default paths being used and recommend explicit configuration for production or security-sensitive environments.
*   For enhanced security, it is **strongly recommended** to set `CONDUIT_ALLOWED_PATHS` explicitly to only the directories the server needs to access.

## Tools Provided

`conduit-mcp` offers the following tools. All tools communicate errors via a standard structure containing `status: "error"`, an `error_code`, and an `error_message`.

### 1. Tool: `read`

**Description:**
The `read` tool is a versatile data retrieval utility. It allows fetching content from local files (within configured allowed paths) and remote URLs. It can also retrieve detailed metadata for these sources, calculate cryptographic checksums, and compare the differences between two specified local files or URLs.

**Key Operations & Parameters:**

*   **`operation: "content"`**: Retrieves the content of specified sources.
    *   `sources`: `string[]` (Required) - Array of local file paths or URLs.
    *   `format?`: `string` (Optional) - Desired output: `"text"`, `"base64"`, `"markdown"` (for HTML sources), `"checksum"`.
        *   Defaults intelligently based on content type (e.g., text for `text/*`, base64 for `image/*`).
        *   `"markdown"`: Converts HTML content to Markdown; falls back to `"text"` for non-HTML.
        *   `"base64"`: Applies image compression for large images if applicable.
    *   `checksum_algorithm?`: `string` (Required if `format: "checksum"`) - e.g., `"md5"`, `"sha256"`.
    *   `offset?`: `integer` (Optional, default: `0`) - Byte offset for partial reads.
    *   `length?`: `integer` (Optional, default: `-1` for to end) - Number of bytes to read.
    *   **Response (Success):** Array of result objects, each with `source`, `source_type`, `status: "success"`, `output_format_used`, `content` (or `checksum`), `mime_type`, `size_bytes`, etc.

*   **`operation: "metadata"`**: Retrieves metadata about specified sources.
    *   `sources`: `string[]` (Required) - Array of local file paths or URLs.
    *   **Response (Success):** Array of result objects, each with `source`, `source_type`, `status: "success"`, and a `metadata` object containing `name`, `entry_type`, `size_bytes`, `mime_type`, timestamps, permissions (for files), and HTTP headers (for URLs).

*   **`operation: "diff"`**: Compares two sources (local files or URLs).
    *   `sources`: `string[]` (Required, exactly two items: local file paths or URLs).
    *   `diff_format?`: `string` (Optional, default: `"unified"`).
    *   **Response (Success):** Single result object with `sources_compared`, `diff_format_used`, and `diff_content`.

**Examples:**

1.  Read content of a local file as text:
    ```json
    {
      "tool_name": "read",
      "tool_version": "1.0",
      "parameters": {
        "operation": "content",
        "sources": ["/Users/steipete/Projects/conduit-mcp/docs/spec.md"],
        "format": "text"
      }
    }
    ```

2.  Get metadata for a URL:
    ```json
    {
      "tool_name": "read",
      "tool_version": "1.0",
      "parameters": {
        "operation": "metadata",
        "sources": ["https://www.google.com"]
      }
    }
    ```

3.  Calculate SHA256 checksum for a file:
    ```json
    {
      "tool_name": "read",
      "tool_version": "1.0",
      "parameters": {
        "operation": "content",
        "sources": ["~/.bashrc"],
        "format": "checksum",
        "checksum_algorithm": "sha256"
      }
    }
    ```

### 2. Tool: `write`

**Description:**
The `write` tool facilitates modifications to the local filesystem within configured allowed paths. It supports creating/overwriting files, appending content, creating directories, copying/moving/deleting items, updating timestamps (`touch`), and creating/extracting archives.

**Key Actions & Parameters:**

*   **Batched Actions (via `entries` array): `"put"`, `"mkdir"`, `"copy"`, `"move"`, `"delete"`, `"touch"`**
    *   `action`: `string` (Required) - The specific action to perform.
    *   `entries`: `object[]` (Required) - Array of entry objects, each defining a single operation.
        *   `put` entry: `{ path, content, input_encoding?, write_mode? }`
            *   `input_encoding`: `"text"` (default) or `"base64"`.
            *   `write_mode`: `"overwrite"` (default) or `"append"`.
        *   `mkdir` entry: `{ path, recursive? }` (`recursive` default `false`).
        *   `copy` entry: `{ source_path, destination_path }`.
        *   `move` entry: `{ source_path, destination_path }`.
        *   `delete` entry: `{ path, recursive? }` (`recursive` default `false`, must be `true` for non-empty dirs).
        *   `touch` entry: `{ path }`.
    *   **Response (Success):** Array of result objects, one for each entry, with `action_performed`, `status`, and relevant paths.

*   **Single Actions: `"archive"`, `"unarchive"`**
    *   `action: "archive"`
        *   `source_paths`: `string[]` (Required) - Files/directories to archive.
        *   `archive_path`: `string` (Required) - Path for the new archive file.
        *   `format?`: `string` (Optional, default: `"zip"`) - `"zip"`, `"tar.gz"`, `"tgz"`.
        *   `recursive_source_listing?`: `boolean` (Optional, default: `true`).
        *   **Response (Success):** Single result object (in an array) with archive details.
    *   `action: "unarchive"`
        *   `archive_path`: `string` (Required) - Archive file to extract.
        *   `destination_path`: `string` (Required) - Directory to extract to.
        *   `format?`: `string` (Optional, auto-detected if omitted) - `"zip"`, `"tar.gz"`, `"tgz"`.
        *   **Response (Success):** Single result object (in an array) with extraction details.

**Examples:**

1.  Write content to a new file and create a directory:
    ```json
    {
      "tool_name": "write",
      "tool_version": "1.0",
      "parameters": {
        "action": "put",
        "entries": [
          { 
            "path": "~/output/newfile.txt", 
            "content": "Hello from conduit-mcp!"
          }
        ]
      }
    }
    ```
    ```json
    {
      "tool_name": "write",
      "tool_version": "1.0",
      "parameters": {
        "action": "mkdir",
        "entries": [
          { "path": "~/output/new_directory", "recursive": true }
        ]
      }
    }
    ```

2.  Create a ZIP archive:
    ```json
    {
      "tool_name": "write",
      "tool_version": "1.0",
      "parameters": {
        "action": "archive",
        "source_paths": ["~/docs/project_a", "~/config/main.json"],
        "archive_path": "~/archives/project_a_backup.zip",
        "format": "zip"
      }
    }
    ```

### 3. Tool: `list`

**Description:**
The `list` tool provides capabilities to inspect local directory structures and retrieve system-level information. It can list files and directories with options for recursion and calculating total sizes, and can also provide server capabilities and filesystem statistics.

**Key Operations & Parameters:**

*   **`operation: "entries"`**: Lists files and subdirectories.
    *   `path`: `string` (Required) - Local directory path.
    *   `recursive_depth?`: `integer` (Optional, default: `0` for non-recursive). `N > 0` for N levels, capped by server max.
    *   `calculate_recursive_size?`: `boolean` (Optional, default: `false`). If true, attempts to sum file sizes within directories.
    *   **Response (Success):** Array of `EntryInfo` objects (name, path, type, size_bytes?, mime_type?, timestamps, permissions, children?, recursive_size_calculation_note?).

*   **`operation: "system_info"`**: Retrieves server capabilities or filesystem statistics.
    *   `info_type`: `string` (Required) - `"server_capabilities"` or `"filesystem_stats"`.
    *   `path?`: `string` (Optional) - Only for `info_type: "filesystem_stats"`, specifies a path on the volume to get stats for.
    *   **Response (Success for `server_capabilities`):** Object with server version, active config, supported algorithms, etc.
    *   **Response (Success for `filesystem_stats` with path):** Object with path_queried, total/free/available/used bytes.
    *   **Response (Success for `filesystem_stats` without path):** Informational object with guidance and allowed paths.

**Examples:**

1.  List entries in a directory (recursive):
    ```json
    {
      "tool_name": "list",
      "tool_version": "1.0",
      "parameters": {
        "operation": "entries",
        "path": "~/projects",
        "recursive_depth": 1,
        "calculate_recursive_size": true
      }
    }
    ```

2.  Get server capabilities:
    ```json
    {
      "tool_name": "list",
      "tool_version": "1.0",
      "parameters": {
        "operation": "system_info",
        "info_type": "server_capabilities"
      }
    }
    ```

### 4. Tool: `find`

**Description:**
The `find` tool enables powerful searching for files and directories within allowed local paths. Searches are from a `base_path`, can be recursive, and use multiple criteria (AND logic).

**Key Parameters:**

*   `base_path`: `string` (Required) - Local directory to start search.
*   `recursive?`: `boolean` (Optional, default: `true`). Respects `CONDUIT_MAX_RECURSIVE_DEPTH`.
*   `match_criteria`: `object[]` (Required) - Array of criterion objects. All must match.
    *   **Criterion `type: "name_pattern"`**:
        *   `pattern`: `string` (Required, glob pattern like `*.txt`, `**/*.log`).
    *   **Criterion `type: "content_pattern"`**:
        *   `pattern`: `string` (Required, text or regex).
        *   `is_regex?`: `boolean` (Optional, default: `false`).
        *   `case_sensitive?`: `boolean` (Optional, default: `false` for literal string search).
        *   `file_types_to_search?`: `string[]` (Optional, e.g., `[".txt", ".md"]`). Restricts content search to these file extensions. Binary files are generally skipped.
    *   **Criterion `type: "metadata_filter"`**:
        *   `attribute`: `string` (Required) - `"name" | "size_bytes" | "created_at_iso" | "modified_at_iso" | "entry_type" | "mime_type"`.
        *   `operator`: `string` (Required) - e.g., `"equals"`, `"contains"` (for strings); `"eq"`, `"gt"` (for numbers); `"before"`, `"on_date"` (for dates).
        *   `value`: `any` (Required) - Appropriate value for attribute and operator.
        *   `case_sensitive?`: `boolean` (Optional, default: `false` for string operators).
*   `entry_type_filter?`: `string` (Optional, default: `"any"`) - `"file" | "directory" | "any"`.

**Response (Success):** An array of `EntryInfo` objects matching all criteria (flat list).

**Example:**

Search for Markdown files containing "project Conduit":
```json
{
  "tool_name": "find",
  "tool_version": "1.0",
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

### 5. Tool: `test` (Utility)

**Description:**
The `test` tool is a utility for development and client integration testing. It is not typically used for production data operations.

**Key Operations & Parameters:**

*   **`operation: "echo"`**: Echoes back the parameters sent to it.
    *   `params_to_echo`: `any` (Required) - The data to be echoed.
    *   **Response (Success):** Object containing the `echoed_params`.

*   **`operation: "generate_error"`**: Generates a specified error response.
    *   `error_code_to_generate`: `string` (Required) - The `ErrorCode` to simulate.
    *   `error_message_to_generate`: `string` (Required) - The error message to return.
    *   **Response:** An error object with the specified code and message.

**Example (Echo):**
```json
{
  "tool_name": "test",
  "tool_version": "1.0",
  "parameters": {
    "operation": "echo",
    "params_to_echo": { "message": "Hello from client!" }
  }
}
```

## Error Handling

Failed operations or individual failures in batch requests result in `status: "error"`. Error objects include:
*   `error_code`: `"UNIQUE_ERROR_CODE"` (A string representing a specific error type).
*   `error_message`: `"Descriptive human-readable error message."` (A string detailing the error).

For a comprehensive list of all possible error codes and their meanings, please refer to **Appendix A** in the `docs/spec.md` file.

## Security Considerations

`conduit-mcp` incorporates several security measures:

*   **Path Validation:** All local filesystem paths provided by the client are strictly validated. Operations are only permitted if the final, absolute, real path (after resolving any symlinks) resides within one of the directories specified by the `CONDUIT_ALLOWED_PATHS` environment variable.
*   **Symlink Resolution:** Symbolic links in local filesystem paths are always resolved to their target. The final real path is then checked against `CONDUIT_ALLOWED_PATHS`.
*   **Resource Limits:** The server enforces configurable limits on payload size, file read size, and URL download size to prevent abuse and ensure stability.

It is crucial to configure `CONDUIT_ALLOWED_PATHS` appropriately for your environment to restrict server access to only necessary directories.

## Development

See `DEVELOPMENT.md`