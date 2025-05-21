import { ReadTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, getContent, getMetadata, getDiff, logger } from '@/internal';

const operationLogger = logger.child({ component: 'readOpsHandler' });

// Common error creation function for read operations
// Note: This is similar to the one in metadataOps and getContentOps.
// Consider centralizing if they are identical or making them specific if they diverge.
interface BaseResultForError {
    source: string;
    source_type: 'file' | 'url'; // Ensure this is always one of the two
    http_status_code?: number;
}

function createGenericErrorResultItem(
    source: string, 
    source_type: 'file' | 'url', // Removed 'unknown'
    errorCode: ErrorCode, 
    errorMessage: string,
    http_status_code?: number
): ReadTool.ContentResultItem | ReadTool.MetadataResultItem | ReadTool.DiffResult {
    const errorResult: MCPErrorStatus & BaseResultForError = {
        source,
        source_type: source_type, // Directly assign, should be 'file' or 'url'
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
    };
    if (http_status_code !== undefined) {
        errorResult.http_status_code = http_status_code;
    }
    // It's an MCPErrorStatus, which is part of ContentResultItem, MetadataResultItem, and DiffResult unions
    return errorResult;
}

// Utility function to check if a source is a URL
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

// Combined response type for the handler
export type ReadToolResponse = ReadTool.ContentResponse | ReadTool.MetadataResponse | ReadTool.DiffResponse;

// Main handler for the 'read' tool
export async function readToolHandler(params: ReadTool.Parameters, config: ConduitServerConfig): Promise<ReadToolResponse> {
  operationLogger.debug(`Handling read tool request with params: ${JSON.stringify(params)}`);

  if (!params.sources || params.sources.length === 0) {
    throw new ConduitError(ErrorCode.INVALID_PARAMETER, 'Sources array cannot be empty for read operation.');
  }
  
  if (params.operation === 'content') {
    const results: ReadTool.ContentResultItem[] = [];
    for (const source of params.sources) {
      results.push(await getContent(source, params as ReadTool.ContentParams, config));
    }
    return results;
  } else if (params.operation === 'metadata') {
    const results: ReadTool.MetadataResultItem[] = [];
    for (const source of params.sources) {
      results.push(await getMetadata(source, params as ReadTool.MetadataParams, config));
    }
    return results;
  } else if (params.operation === 'diff') {
    if (params.sources.length !== 2) {
      const errorStatus: MCPErrorStatus = {
          status: 'error',
          error_code: ErrorCode.INVALID_PARAMETER, // Corrected
          error_message: 'Diff operation requires exactly two sources.',
      };
      return errorStatus; // DiffResponse can be a single MCPErrorStatus
    }
    // Basic check: spec says diff is only for local files.
    if (isUrl(params.sources[0]) || isUrl(params.sources[1])) {
        const errorStatus: MCPErrorStatus = {
            status: 'error',
            error_code: ErrorCode.INVALID_PARAMETER, // Corrected
            error_message: 'Diff operation currently only supports local files.',
        };
        return errorStatus; // DiffResponse can be a single MCPErrorStatus
    }
    return getDiff(params as ReadTool.DiffParams, config);
  } else {
    // If switch is exhaustive, params.operation is never here. This line ensures type checking for op.
    const op = (params as any).operation;
    throw new ConduitError(ErrorCode.INVALID_PARAMETER, `Unsupported read operation: ${op}`);
  }
} 