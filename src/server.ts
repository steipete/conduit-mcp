import readline from 'readline';
import {
    MCPRequest,
    MCPResponse,
    configLoader,
    handleReadTool,
    handleWriteTool,
    handleListTool,
    handleFindTool,
    ConduitError,
    ErrorCode,
    createMCPErrorStatus,
    logger,
    prependInfoNoticeIfApplicable,
} from '@/internal';

logger.info(`conduit-mcp server v${configLoader.conduitConfig.serverVersion} starting... Log level: ${configLoader.conduitConfig.logLevel}`);
logger.info(`Allowed paths: ${configLoader.conduitConfig.allowedPaths.join(', ')}`);
logger.info(`Default checksum algorithm: ${configLoader.conduitConfig.defaultChecksumAlgorithm}`);
logger.debug('Full configuration:', configLoader.conduitConfig); 

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false // Ensure it works with piped input
});

async function processRequest(line: string): Promise<void> {
  let request: MCPRequest;
  let responsePayload: any;

  try {
    if (line.length > configLoader.conduitConfig.maxPayloadSizeBytes) {
        throw new ConduitError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, `Incoming MCP request payload size (${line.length} bytes) exceeds CONDUIT_MAX_PAYLOAD_SIZE_BYTES (${configLoader.conduitConfig.maxPayloadSizeBytes} bytes).`);
    }
    request = JSON.parse(line) as MCPRequest;
    logger.debug(`Received MCP Request (ID: ${request.requestId}): Tool='${request.toolName}', Params='${JSON.stringify(request.parameters).substring(0,200)}...'`);

    switch (request.toolName) {
      case 'read':
        responsePayload = await handleReadTool(request.parameters as any);
        break;
      case 'write':
        responsePayload = await handleWriteTool(request.parameters as any);
        break;
      case 'list':
        responsePayload = await handleListTool(request.parameters as any);
        break;
      case 'find':
        responsePayload = await handleFindTool(request.parameters as any);
        break;
      default:
        throw new ConduitError(ErrorCode.ERR_UNKNOWN_TOOL, `Unknown tool name: ${request.toolName}`);
    }
    
    // Prepend info notice if applicable. This modifies responsePayload.
    responsePayload = prependInfoNoticeIfApplicable(responsePayload);

  } catch (error: any) {
    const mcpError = error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_MCP_INVALID_REQUEST, error.message);
    responsePayload = mcpError; // For single errors, response becomes the error object directly
    // If the error occurred before request parsing, requestId might be undefined
    const reqId = typeof request! !== 'undefined' && request!?.requestId ? request!.requestId : undefined;
    logger.error(`Error processing MCP Request (ID: ${reqId}): ${error.message}`, error.stack);
  }
  
  const mcpResponse: MCPResponse = {
    requestId: typeof request! !== 'undefined' && request!?.requestId ? request!.requestId : undefined,
    response: responsePayload
  };

  const responseString = JSON.stringify(mcpResponse);
  process.stdout.write(responseString + '\n');
  logger.debug(`Sent MCP Response (ID: ${mcpResponse.requestId}): '${responseString.substring(0,300)}...'`);
}

rl.on('line', (line) => {
  if (line.trim() === '') return; // Ignore empty lines
  processRequest(line).catch(err => {
    // This catch is for unhandled promise rejections within processRequest itself, though most errors should be caught internally.
    const errorResponse: MCPResponse = {
      response: createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, `Critical unhandled error: ${err.message}`)
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    logger.fatal('Critical unhandled error in processRequest:', err);
  });
});

rl.on('close', () => {
  logger.info('Input stream closed. Server shutting down.');
  process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Received SIGINT. Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Shutting down...');
    process.exit(0);
}); 