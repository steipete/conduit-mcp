import { WriteTool, ConduitServerConfig, ErrorCode, logger, putContent } from '@/internal';

const operationLogger = logger.child({ component: 'putOpsHandler' });

// Main handler for the 'put' action of the 'write' tool
export async function handleWritePut(
  params: WriteTool.PutParams,
  config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse> {
  operationLogger.debug(`Handling write tool 'put' action with params: ${JSON.stringify(params)}`);

  if (!params.entries || params.entries.length === 0) {
    // This case should ideally be caught by initial validation in the tool handler,
    // but as a safeguard, return a global error for the batch.
    // Note: The spec implies individual results. A single error for an empty batch might be an exception.
    // For now, adhering to returning an array, even if it's a single global error item.
    return {
      tool_name: 'write',
      results: [
        {
          status: 'error',
          action_performed: 'put', // Generic action for the batch attempt
          // path is not applicable for a missing entries error
          error_code: ErrorCode.INVALID_PARAMETER,
          error_message: "'entries' array is missing or empty for put operation.",
        },
      ],
    };
  }

  const results: WriteTool.WriteResultItem[] = await Promise.all(
    params.entries.map((entry) => putContent(entry, config))
  );

  return { tool_name: 'write', results };
}
