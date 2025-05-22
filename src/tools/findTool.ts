import {
  FindTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';
import { handleFindEntries } from '@/operations/findOps';

export async function findToolHandler(
  params: FindTool.Parameters,
  config: ConduitServerConfig
): Promise<FindTool.DefinedFindResponse | MCPErrorStatus> {
  try {
    logger.info('Find tool operation called');
    const entries = await handleFindEntries(params, config);
    return { tool_name: 'find', results: entries };
  } catch (error) {
    if (error instanceof ConduitError) {
      return createErrorResponse(error.errorCode, error.message);
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in find tool handler: ${errorMessage}`);
      return createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        `Internal server error: ${errorMessage}`
      );
    }
  }
}
