#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  logger,
  conduitConfig,
  loadConduitConfig,
  noticeService,
  ReadTool,
  WriteTool,
  ListTool,
  FindTool,
  ArchiveTool,
  TestTool,
} from "@/internal";
import { readToolHandler } from "@/tools/readTool";
import { writeToolHandler } from "@/tools/writeTool";
import { listToolHandler } from "@/tools/listTool";
import { findToolHandler } from "@/tools/findTool";
import { archiveToolHandler } from "@/operations/archiveOps";
import { testToolHandler } from "@/tools/testTool";

const server = new Server(
  {
    name: "conduit-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Define tools
const TOOLS = [
  {
    name: "read",
    description:
      "Comprehensive data reading tool that can read local files, fetch web content (with HTML-to-Markdown conversion), extract image metadata/text via OCR, and handle various content formats. Supports text files, binary files (base64), web pages with content cleaning, and image processing. Can handle partial reads, different encodings, and provides detailed metadata about sources.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["read_file", "read_url", "read_image_metadata", "read_image_text"],
          description:
            "Required. Type of read operation: read_file (local files), read_url (web content with optional HTML-to-Markdown conversion), read_image_metadata (image file information), read_image_text (OCR text extraction from images)",
        },
        file_path: {
          type: "string",
          description:
            "Optional (required for read_file, read_image_metadata, read_image_text operations). Path to the local file to read. Can be absolute or relative to workspace. Supports tilde (~) expansion if enabled in server config.",
        },
        url: {
          type: "string",
          description:
            "Optional (required for read_url operation). Full URL to fetch content from. Supports HTTP/HTTPS. For HTML pages, content will be cleaned and converted to Markdown by default.",
        },
        options: {
          type: "object",
          description: "Optional. Additional options to control read behavior.",
          properties: {
            encoding: {
              type: "string",
              enum: ["utf8", "base64"],
              description:
                "Optional. Default utf8. File encoding format. Use base64 for binary files or when you need raw binary data encoded as base64 string.",
            },
            convert_to_markdown: {
              type: "boolean",
              description:
                "Optional. Default true. For URL operations on HTML content, whether to convert cleaned HTML to Markdown format. When false, returns cleaned HTML.",
            },
            include_raw_content: {
              type: "boolean",
              description:
                "Optional. Default false. For URL operations, whether to include the original raw HTML content alongside the converted content. Useful for debugging or custom processing.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "write",
    description:
      "Versatile file system modification tool supporting file creation/updates, directory operations, file/directory copying and moving, deletion, and timestamp updates. Handles text and binary content with various encodings. Supports batch operations, recursive directory operations, and safe overwrite controls. Can create parent directories automatically and provides detailed operation results.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["put", "mkdir", "copy", "move", "delete", "touch"],
          description:
            "Required. Type of write operation: put (create/update file), mkdir (create directory), copy (duplicate file/directory), move (relocate file/directory), delete (remove file/directory), touch (create empty file or update timestamps)",
        },
        file_path: {
          type: "string",
          description:
            "Optional (required for put, mkdir, delete, touch operations). Target file or directory path. For put: file to create/update. For mkdir: directory to create. For delete/touch: target to delete/touch. Can be absolute or relative to workspace.",
        },
        source_path: {
          type: "string",
          description:
            "Optional (required for copy, move operations). Source path for copy/move operations. The file or directory to be copied or moved. Must exist and be within allowed paths.",
        },
        content: {
          type: "string",
          description:
            "Optional (required for put operation). Content to write to the file. Can be plain text (with encoding=utf8) or base64-encoded binary data (with encoding=base64).",
        },
        options: {
          type: "object",
          description: "Optional. Additional options to control write behavior.",
          properties: {
            encoding: {
              type: "string",
              enum: ["utf8", "base64"],
              description:
                "Optional. Default utf8. Content encoding format for put operations. Use base64 when writing binary data that has been base64-encoded.",
            },
            mode: {
              type: "string",
              enum: ["overwrite", "append", "error_if_exists"],
              description:
                "Optional. Default overwrite. Write mode for put operations. overwrite=replace existing file, append=add to end of existing file, error_if_exists=fail if file already exists.",
            },
            create_parents: {
              type: "boolean",
              description:
                "Optional. Default false. Whether to create parent directories if they don't exist. Applies to put, mkdir operations. When true, will create the entire directory path as needed.",
            },
            recursive: {
              type: "boolean",
              description:
                "Optional. Default false. Apply operation recursively for directory operations. For delete: remove directory and all contents. For copy: copy directory and all contents. For mkdir: create nested directories.",
            },
            overwrite: {
              type: "boolean",
              description:
                "Optional. Default true. Whether to overwrite existing files/directories during copy/move operations. When false, operation will fail if destination already exists.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "list",
    description:
      "File system exploration and server information tool. Can list directory contents with detailed metadata (file sizes, timestamps, permissions, MIME types) or retrieve server capabilities and system information. Supports recursive directory traversal, hidden file inclusion, and provides comprehensive file system statistics.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["entries", "system_info"],
          description:
            "Required. Type of list operation: entries (list directory contents with metadata), system_info (get server capabilities, configuration, and file system statistics)",
        },
        path: {
          type: "string",
          description:
            "Optional (required for entries operation). Directory path to list. Can be absolute or relative to workspace. For system_info operation, this is optional and used only for file system statistics of a specific path.",
        },
        options: {
          type: "object",
          description: "Optional. Additional options to control listing behavior.",
          properties: {
            include_hidden: {
              type: "boolean",
              description:
                "Optional. Default false. Whether to include hidden files and directories (those starting with .) in the results. Only applies to entries operation.",
            },
            detailed: {
              type: "boolean",
              description:
                "Optional. Default false. Whether to include detailed metadata for each entry (file sizes, timestamps, permissions, MIME types). When true, provides comprehensive file information. Only applies to entries operation.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "find",
    description:
      "Advanced file and directory search tool with powerful filtering capabilities. Can search by file names (glob patterns), file content (regex patterns), metadata attributes (size, dates, types), and combinations thereof. Supports recursive directory traversal, result limits, depth controls, and case-sensitive matching. Returns detailed metadata for found items.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["search"],
          description:
            'Required. Type of find operation. Currently only "search" is supported, which performs comprehensive file/directory searching with multiple filter criteria.',
        },
        path: {
          type: "string",
          description:
            "Required. Root directory path to start the search from. Search will be performed recursively from this location unless recursive is false. Must be within allowed paths.",
        },
        recursive: {
          type: "boolean",
          description:
            "Optional. Default true. If true, search extends into subdirectories respecting max depth. If false, only entries directly within path are considered.",
        },
        name_pattern: {
          type: "string",
          description:
            'Optional. Glob pattern to match file/directory names (e.g., "*.txt", "test_*", "**/*.js"). Supports standard glob wildcards: * (any chars), ? (single char), [] (char sets), ** (recursive directories).',
        },
        case_sensitive: {
          type: "boolean",
          description:
            "Optional. Default false. Whether name_pattern matching should be case-sensitive.",
        },
        content_pattern: {
          type: "string",
          description:
            "Optional. Text or regular expression pattern to search within file contents. Only searches text files up to configured size limit. Binary files are skipped.",
        },
        content_is_regex: {
          type: "boolean",
          description:
            "Optional. Default false. If true, content_pattern is treated as a JavaScript-compatible regular expression. If false, treated as literal string.",
        },
        content_case_sensitive: {
          type: "boolean",
          description:
            "Optional. Default false. Controls case sensitivity for literal string content search. Ignored if content_is_regex is true (use regex flags instead).",
        },
        file_extensions: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional. Array of file extensions (e.g., [".txt", ".log", ".md"]) to restrict content searching to these file types. If omitted, searches all presumed text files.',
        },
        size_min: {
          type: "number",
          description:
            "Optional. Minimum file size in bytes. Files smaller than this will be excluded from results.",
        },
        size_max: {
          type: "number",
          description:
            "Optional. Maximum file size in bytes. Files larger than this will be excluded from results.",
        },
        modified_after: {
          type: "string",
          description:
            'Optional. ISO 8601 datetime string (e.g., "2023-10-26T12:00:00Z"). Only files modified after this time will be included.',
        },
        modified_before: {
          type: "string",
          description:
            "Optional. ISO 8601 datetime string. Only files modified before this time will be included.",
        },
        created_after: {
          type: "string",
          description:
            "Optional. ISO 8601 datetime string. Only files created after this time will be included.",
        },
        created_before: {
          type: "string",
          description:
            "Optional. ISO 8601 datetime string. Only files created before this time will be included.",
        },
        entry_type: {
          type: "string",
          enum: ["file", "directory", "any"],
          description:
            "Optional. Default any. Filter results by entry type. file=only files, directory=only directories, any=all types.",
        },
        mime_type: {
          type: "string",
          description:
            'Optional. Filter by MIME type (e.g., "text/plain", "image/jpeg"). Only files with this MIME type will be included.',
        },
        max_results: {
          type: "number",
          description:
            "Optional. Maximum number of results to return. If specified, only the first N matching entries will be returned to prevent excessive resource usage.",
        },
      },
      required: ["operation", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "archive",
    description:
      "Archive creation and extraction tool supporting ZIP and TAR.GZ formats. Can create archives from multiple files/directories with compression options, path prefixes, and selective inclusion. Supports extracting archives to specified locations with options for overwriting, path stripping, and selective extraction. Provides detailed operation results including checksums and entry counts.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["create", "extract"],
          description:
            "Required. Archive operation type: create (make new archive from source files/directories), extract (unpack archive contents to target location)",
        },
        archive_path: {
          type: "string",
          description:
            "Required. Path to the archive file. For create: where to save the new archive (format determined by extension: .zip, .tar.gz, .tgz). For extract: path to existing archive to unpack. Must be within allowed paths.",
        },
        source_paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional (required for create operation). Array of file and/or directory paths to include in the archive. All paths must exist and be within allowed paths. Can be absolute or relative to workspace.",
        },
        target_path: {
          type: "string",
          description:
            "Optional (required for extract operation). Default current directory (.). Directory path where archive contents should be extracted. Will be created if it doesn't exist. Must be within allowed paths.",
        },
        options: {
          type: "object",
          description: "Optional. Additional options to control archive behavior.",
          properties: {
            archive_type: {
              type: "string",
              enum: ["zip", "tar.gz"],
              description:
                "Optional. Default auto-detected from archive_path extension. Archive format override. zip=ZIP format, tar.gz=gzipped tar format. Usually not needed as format is inferred from file extension.",
            },
            overwrite: {
              type: "boolean",
              description:
                "Optional. Default true. Whether to overwrite existing files during extraction or archive creation. When false, operation will fail if target files already exist.",
            },
            path_prefix: {
              type: "string",
              description:
                "Optional. For create operation: prefix to add to all archived file paths. For extract: not used. Useful for organizing archive contents in subdirectories.",
            },
            strip_components: {
              type: "number",
              description:
                "Optional. Default 0. For extract operation: number of leading path components to strip from archive entries. Useful for extracting nested archives directly to target without intermediate directories.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["operation", "archive_path"],
      additionalProperties: false,
    },
  },
  {
    name: "test",
    description:
      "Development and debugging tool for testing MCP communication and error handling. Can echo back provided parameters to verify tool invocation and parameter passing, or simulate specific error conditions for testing error handling workflows. Useful for validating client-server communication and testing error recovery mechanisms.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["echo", "error"],
          description:
            "Required. Test operation type: echo (return provided parameters for verification), error (simulate specific error condition with custom error code and message)",
        },
        params_to_echo: {
          description:
            "Optional (used for echo operation). Any parameters/data to echo back in the response. Can be any JSON type (string, number, object, array, etc.). Useful for testing parameter transmission.",
        },
        error_code: {
          type: "string",
          description:
            "Optional (required for error operation). Error code to simulate in the error response. Can be any string, typically standard error codes like ERR_FS_NOT_FOUND, ERR_PERMISSION_DENIED, etc. Used for testing error handling.",
        },
        error_message: {
          type: "string",
          description:
            "Optional (required for error operation). Human-readable error message to include in the error response. Should describe the simulated error condition. Used for testing error message display and handling.",
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  try {
    let toolResponse: unknown;

    switch (name) {
      case "read":
        toolResponse = await readToolHandler(args as unknown as ReadTool.Parameters, conduitConfig);
        break;
      case "write":
        toolResponse = await writeToolHandler(
          args as unknown as WriteTool.Parameters,
          conduitConfig,
        );
        break;
      case "list":
        toolResponse = await listToolHandler(args as unknown as ListTool.Parameters, conduitConfig);
        break;
      case "find":
        toolResponse = await findToolHandler(args as unknown as FindTool.Parameters, conduitConfig);
        break;
      case "archive":
        toolResponse = await archiveToolHandler(
          args as unknown as ArchiveTool.Params,
          conduitConfig,
          name,
        );
        break;
      case "test":
        toolResponse = await testToolHandler(args as unknown as TestTool.Parameters, conduitConfig);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Handle first-use notice
    if (toolResponse && !noticeService.hasFirstUseNoticeBeenSent()) {
      const notice = noticeService.generateFirstUseNotice(conduitConfig);
      if (notice) {
        if (Array.isArray(toolResponse)) {
          toolResponse.unshift(notice);
        } else {
          toolResponse = [notice, toolResponse];
        }
        noticeService.markFirstUseNoticeSent();
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(toolResponse, null, 2),
        },
      ],
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  try {
    await loadConduitConfig();

    logger.info(
      `Conduit-MCP Server v${conduitConfig.serverVersion} started at ${conduitConfig.serverStartTimeIso}. PID: ${process.pid}. Allowed paths: ${JSON.stringify(conduitConfig.resolvedAllowedPaths)}. Max payload: ${conduitConfig.maxPayloadSizeBytes} bytes.`,
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("MCP Server connected and ready");
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Unhandled error:", error);
    process.exit(1);
  });
}
