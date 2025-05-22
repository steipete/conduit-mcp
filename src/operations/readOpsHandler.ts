import {
  ReadTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  MCPErrorStatus,
  getContent,
  getMetadata,
  getDiff,
  logger,
} from '@/internal';

const operationLogger = logger.child({ component: 'readOpsHandler' });

// Common error creation types for read operations - keeping for reference
// Note: This is similar to the one in metadataOps and getContentOps.
// Consider centralizing if they are identical or making them specific if they diverge.

// Utility function to check if a source is a URL
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

// Combined response type for the handler
export type ReadToolResponse =
  | ReadTool.DefinedContentResponse
  | ReadTool.DefinedMetadataResponse
  | ReadTool.DefinedDiffResponse;

// Main handler for the 'read' tool
export async function readToolHandler(
  params: ReadTool.Parameters,
  config: ConduitServerConfig
): Promise<ReadToolResponse> {
  operationLogger.debug(`Handling read tool request with params: ${JSON.stringify(params)}`);

  if (!params.sources || params.sources.length === 0) {
    throw new ConduitError(
      ErrorCode.INVALID_PARAMETER,
      'Sources array cannot be empty for read operation.'
    );
  }

  if (params.operation === 'content') {
    const results: ReadTool.ContentResultItem[] = [];
    for (const source of params.sources) {
      results.push(await getContent(source, params as ReadTool.ContentParams, config));
    }
    return { tool_name: 'read', results };
  } else if (params.operation === 'metadata') {
    const results: ReadTool.MetadataResultItem[] = [];
    for (const source of params.sources) {
      results.push(await getMetadata(source, params as ReadTool.MetadataParams, config));
    }
    return { tool_name: 'read', results };
  } else if (params.operation === 'diff') {
    if (params.sources.length !== 2) {
      const errorStatus: MCPErrorStatus = {
        status: 'error',
        error_code: ErrorCode.INVALID_PARAMETER, // Corrected
        error_message: 'Diff operation requires exactly two sources.',
      };
      return { tool_name: 'read', results: errorStatus };
    }
    // Basic check: spec says diff is only for local files.
    if (isUrl(params.sources[0]) || isUrl(params.sources[1])) {
      const errorStatus: MCPErrorStatus = {
        status: 'error',
        error_code: ErrorCode.INVALID_PARAMETER, // Corrected
        error_message: 'Diff operation currently only supports local files.',
      };
      return { tool_name: 'read', results: errorStatus };
    }
    const diffResult = await getDiff(params as ReadTool.DiffParams, config);
    return { tool_name: 'read', results: diffResult };
  } else {
    // If switch is exhaustive, params.operation is never here. This line ensures type checking for op.
    const unknownParams = params as Record<string, unknown>;
    const op = unknownParams.operation;
    throw new ConduitError(ErrorCode.INVALID_PARAMETER, `Unsupported read operation: ${op}`);
  }
}
