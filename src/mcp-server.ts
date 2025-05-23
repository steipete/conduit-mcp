#!/usr/bin/env node

import {
  Server,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  StdioServerTransport,
} from '@modelcontextprotocol/sdk/server/index.js';
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
} from '@/internal';
import { readToolHandler } from '@/tools/readTool';
import { writeToolHandler } from '@/tools/writeTool';
import { listToolHandler } from '@/tools/listTool';
import { findToolHandler } from '@/tools/findTool';
import { archiveToolHandler } from '@/operations/archiveOps';
import { testToolHandler } from '@/tools/testTool';

// Union type for all tool parameters
type ToolArguments =
  | ReadTool.Parameters
  | WriteTool.Parameters
  | ListTool.Parameters
  | FindTool.Parameters
  | ArchiveTool.Params
  | TestTool.Parameters;

const server = new Server(
  {
    name: 'conduit-mcp',
    version: '1.0.0-rc.5',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const TOOLS = [
  {
    name: 'read',
    description:
      'Read file contents, fetch web content, or extract data from various sources. Supports text files, web pages (HTML/Markdown conversion), images (OCR/metadata), and binary content.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read_file', 'read_url', 'read_image_metadata', 'read_image_text'],
          description: 'Type of read operation to perform',
        },
        file_path: {
          type: 'string',
          description: 'Path to the file to read (for file operations)',
        },
        url: {
          type: 'string',
          description: 'URL to fetch content from (for web operations)',
        },
        options: {
          type: 'object',
          properties: {
            encoding: {
              type: 'string',
              enum: ['utf8', 'base64'],
              description: 'File encoding format',
            },
            convert_to_markdown: {
              type: 'boolean',
              description: 'Convert HTML to Markdown format',
            },
            include_raw_content: {
              type: 'boolean',
              description: 'Include raw HTML content along with converted',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'write',
    description:
      'Write files, create directories, copy/move/delete files and directories. Includes touch operation for creating empty files or updating timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['put', 'mkdir', 'copy', 'move', 'delete', 'touch'],
          description: 'Type of write operation to perform',
        },
        file_path: {
          type: 'string',
          description: 'Target file or directory path',
        },
        source_path: {
          type: 'string',
          description: 'Source path (for copy/move operations)',
        },
        content: {
          type: 'string',
          description: 'Content to write (for put operations)',
        },
        options: {
          type: 'object',
          properties: {
            encoding: {
              type: 'string',
              enum: ['utf8', 'base64'],
              description: 'Content encoding format',
            },
            mode: {
              type: 'string',
              enum: ['overwrite', 'append', 'error_if_exists'],
              description: 'Write mode behavior',
            },
            create_parents: {
              type: 'boolean',
              description: "Create parent directories if they don't exist",
            },
            recursive: {
              type: 'boolean',
              description: 'Apply operation recursively (for directory operations)',
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing files/directories',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'list',
    description:
      'List directory contents, get filesystem info, and retrieve system capabilities. Provides detailed file/directory information including metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['entries', 'system_info'],
          description: 'Type of list operation to perform',
        },
        path: {
          type: 'string',
          description: 'Directory path to list (for entries operation)',
        },
        options: {
          type: 'object',
          properties: {
            include_hidden: {
              type: 'boolean',
              description: 'Include hidden files and directories',
            },
            detailed: {
              type: 'boolean',
              description: 'Include detailed metadata for each entry',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'find',
    description:
      'Search for files and directories with powerful filtering options. Supports glob patterns, content search, metadata filters, and advanced search criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['search'],
          description: 'Type of find operation to perform',
        },
        path: {
          type: 'string',
          description: 'Root path to search from',
        },
        options: {
          type: 'object',
          properties: {
            glob_pattern: {
              type: 'string',
              description: 'Glob pattern to match file names',
            },
            content_pattern: {
              type: 'string',
              description: 'Regex pattern to search within file contents',
            },
            entry_type_filter: {
              type: 'string',
              enum: ['file', 'directory', 'symlink', 'any'],
              description: 'Filter by entry type',
            },
            size_filter: {
              type: 'object',
              properties: {
                min_size: { type: 'number' },
                max_size: { type: 'number' },
              },
              additionalProperties: false,
            },
            modified_filter: {
              type: 'object',
              properties: {
                after: { type: 'string' },
                before: { type: 'string' },
              },
              additionalProperties: false,
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Case sensitive pattern matching',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
            max_depth: {
              type: 'number',
              description: 'Maximum directory depth to search',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['operation', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'archive',
    description:
      'Create and extract ZIP and TAR.GZ archives. Supports various compression options, path prefixes, and selective extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'extract'],
          description: 'Archive operation to perform',
        },
        archive_path: {
          type: 'string',
          description: 'Path to the archive file',
        },
        source_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to archive (for create operation)',
        },
        destination_path: {
          type: 'string',
          description: 'Extraction destination (for extract operation)',
        },
        options: {
          type: 'object',
          properties: {
            archive_type: {
              type: 'string',
              enum: ['zip', 'tar.gz'],
              description: 'Type of archive to create/extract',
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing files',
            },
            path_prefix: {
              type: 'string',
              description: 'Add prefix to archived paths',
            },
            strip_components: {
              type: 'number',
              description: 'Strip leading path components during extraction',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['operation', 'archive_path'],
      additionalProperties: false,
    },
  },
  {
    name: 'test',
    description:
      'Test tool for debugging and validation. Echoes back provided parameters and can simulate various error conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['echo', 'error'],
          description: 'Test operation to perform',
        },
        params_to_echo: {
          description: 'Parameters to echo back (any type)',
        },
        error_code: {
          type: 'string',
          description: 'Error code to simulate (for error operation)',
        },
        error_message: {
          type: 'string',
          description: 'Error message to return (for error operation)',
        },
      },
      required: ['operation'],
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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let toolResponse: unknown;

    switch (name) {
      case 'read':
        toolResponse = await readToolHandler(args as ReadTool.Parameters, conduitConfig);
        break;
      case 'write':
        toolResponse = await writeToolHandler(args as WriteTool.Parameters, conduitConfig);
        break;
      case 'list':
        toolResponse = await listToolHandler(args as ListTool.Parameters, conduitConfig);
        break;
      case 'find':
        toolResponse = await findToolHandler(args as FindTool.Parameters, conduitConfig);
        break;
      case 'archive':
        toolResponse = await archiveToolHandler(args as ArchiveTool.Params, conduitConfig, name);
        break;
      case 'test':
        toolResponse = await testToolHandler(args as TestTool.Parameters, conduitConfig);
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
          type: 'text',
          text: JSON.stringify(toolResponse, null, 2),
        },
      ],
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      content: [
        {
          type: 'text',
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
      `Conduit-MCP Server v${conduitConfig.serverVersion} started at ${conduitConfig.serverStartTimeIso}. PID: ${process.pid}. Allowed paths: ${JSON.stringify(conduitConfig.resolvedAllowedPaths)}. Max payload: ${conduitConfig.maxPayloadSizeBytes} bytes.`
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP Server connected and ready');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });
}
