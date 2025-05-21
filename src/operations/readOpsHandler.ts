import { ReadTool, ConduitServerConfig, ConduitError, ErrorCode, MCPErrorStatus, getContent, getMetadata, getDiff, logger } from '@/internal';

const operationLogger = logger.child({ component: 'readOpsHandler' });

// Common error creation function for read operations
// Note: This is similar to the one in metadataOps and getContentOps.
// Consider centralizing if they are identical or making them specific if they diverge.
interface BaseResultForError {
    source: string;
    source_type: 'file' | 'url'; // Source type might not always be known for global errors
    http_status_code?: number;
}

function createGenericErrorResultItem(
    source: string, 
    source_type: 'file' | 'url' | 'unknown', // Allow unknown for global errors
    errorCode: ErrorCode, 
    errorMessage: string,
    http_status_code?: number
): ReadTool.ContentResultItem | ReadTool.MetadataResultItem { // Can return either type for flexibility
    const errorResult: MCPErrorStatus & BaseResultForError = {
        source,
        source_type: source_type === 'unknown' ? undefined : source_type, // Omit if unknown
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
    };
    if (http_status_code !== undefined) {
        errorResult.http_status_code = http_status_code;
    }
    return errorResult as ReadTool.ContentResultItem; // Cast to one, structure is compatible
}

// Utility function to check if a source is a URL
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

// Main handler for the 'read' tool
export async function readToolHandler(params: ReadTool.Params, config: ConduitServerConfig): Promise<ReadTool.Response> {
  operationLogger.debug(`Handling read tool request with params: ${JSON.stringify(params)}`);

  if (!params.sources || params.sources.length === 0) {
    const errorItem = createGenericErrorResultItem(
        'global_read_error', 
        'unknown', 
        ErrorCode.ERR_INVALID_PARAMETER, 
        'Sources array cannot be empty for read operation.'
    );
    return { content: [errorItem] }; 
  }
  
  const results: (ReadTool.ContentResultItem | ReadTool.MetadataResultItem)[] = [];

  if (params.operation === 'content') {
    for (const source of params.sources) {
      results.push(await getContent(source, params as ReadTool.ContentParams, config));
    }
  } else if (params.operation === 'metadata') {
    for (const source of params.sources) {
      results.push(await getMetadata(source, params as ReadTool.MetadataParams, config));
    }
  } else if (params.operation === 'diff') {
    if (params.sources.length !== 2) {
      const errorItem = createGenericErrorResultItem(
          params.sources.join(', '), 
          'unknown', 
          ErrorCode.ERR_INVALID_PARAMETER, 
          'Diff operation requires exactly two sources.'
      );
      return { content: [errorItem] };
    }
    // Basic check: spec says diff is only for local files.
    if (isUrl(params.sources[0]) || isUrl(params.sources[1])) {
        const errorItem = createGenericErrorResultItem(
            params.sources.join(', '), 
            'unknown',
            ErrorCode.ERR_INVALID_PARAMETER, 
            'Diff operation currently only supports local files.'
        );
      return { content: [errorItem] };
    }
    // Call getDiff from diffOps.ts
    results.push(await getDiff(params as ReadTool.DiffParams, config));
  } else {
    // Should not happen if ReadTool.Params.operation is a validated union type
    const unknownOpError = createGenericErrorResultItem(
        params.sources.join(', '), 
        'unknown',
        ErrorCode.ERR_INVALID_PARAMETER, 
        `Unsupported read operation: ${(params as any).operation}`
    );
    return { content: [unknownOpError] };
  }

  return { content: results };
} 