import readline from 'node:readline';
import {
  logger,
  conduitConfig,
  loadConduitConfig,
  ReadTool,
  WriteTool,
  ListTool,
  FindTool,
  ArchiveTool,
  TestTool,
  ErrorCode,
  createErrorResponse,
} from '@/internal';
import { readToolHandler } from '@/tools/readTool';
import { writeToolHandler } from '@/tools/writeTool';
import { listToolHandler } from '@/tools/listTool';
import { findToolHandler } from '@/tools/findTool';
import { archiveToolHandler } from '@/operations/archiveOps';
import { testToolHandler } from '@/tools/testTool';
import * as noticeService from '@/core/noticeService';
import { MCPErrorStatus, InfoNotice } from '@/types/common';

function sendErrorResponse(errorCode: ErrorCode, message: string, details?: string) {
  const finalMessage = details ? `${message} ${details}` : message;
  const errorRes = createErrorResponse(errorCode, finalMessage);
  process.stdout.write(JSON.stringify(errorRes) + '\n');
}

(async () => {
  try {
    await loadConduitConfig();
  } catch (error) {
    console.error(
      `Critical config error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  logger.info(
    `Conduit-MCP Server v${conduitConfig.serverVersion} started at ${conduitConfig.serverStartTimeIso}. PID: ${process.pid}. Allowed paths: ${JSON.stringify(conduitConfig.resolvedAllowedPaths)}. Max payload: ${conduitConfig.maxPayloadSizeBytes} bytes.`
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      if (line.length > conduitConfig.maxPayloadSizeBytes) {
        sendErrorResponse(
          ErrorCode.RESOURCE_LIMIT_EXCEEDED,
          'Request payload exceeds maximum allowed size.'
        );
        return;
      }

      let request: any;
      try {
        request = JSON.parse(line);
      } catch (parseError) {
        sendErrorResponse(ErrorCode.ERR_MCP_INVALID_REQUEST, 'Malformed MCP request JSON.');
        return;
      }

      if (!request.tool_name || !request.params) {
        sendErrorResponse(
          ErrorCode.INVALID_PARAMETER,
          'Invalid request structure: missing tool_name or params.'
        );
        return;
      }

      let toolResponse: any;
      switch (request.tool_name) {
        case 'read':
          toolResponse = await readToolHandler(request.params, conduitConfig);
          break;
        case 'write':
          toolResponse = await writeToolHandler(request.params, conduitConfig);
          break;
        case 'list':
          toolResponse = await listToolHandler(request.params, conduitConfig);
          break;
        case 'find':
          toolResponse = await findToolHandler(request.params, conduitConfig);
          break;
        case 'ArchiveTool':
          toolResponse = await archiveToolHandler(request.params, conduitConfig);
          break;
        case 'test':
          toolResponse = await testToolHandler(request.params, conduitConfig);
          break;
        default:
          sendErrorResponse(ErrorCode.ERR_UNKNOWN_TOOL, `Unknown tool: ${request.tool_name}`);
          return;
      }

      if (
        toolResponse &&
        !(toolResponse as MCPErrorStatus).error_code &&
        !noticeService.hasFirstUseNoticeBeenSent()
      ) {
        const notice = noticeService.generateFirstUseNotice(conduitConfig);
        if (notice) {
          if (toolResponse.results && Array.isArray(toolResponse.results)) {
            toolResponse.results.unshift(notice);
          } else if (toolResponse.results) {
            toolResponse.results = [notice, toolResponse.results];
          } else {
            toolResponse.results = [notice, toolResponse.results];
          }
          noticeService.markFirstUseNoticeSent();
        }
      }

      process.stdout.write(JSON.stringify(toolResponse) + '\n');
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      sendErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        `Internal server error: ${error.message}`,
        error.stack
      );
    }
  });

  rl.on('close', () => {
    logger.info('Conduit-MCP Server shutting down.');
  });
})();

process.on('uncaughtException', (error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
