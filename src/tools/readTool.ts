import { ReadTool, ConduitServerConfig, ConduitError, ErrorCode, logger } from '@/internal';
import { createMCPErrorStatus } from '@/utils/errorHandler';
import { getContent } from '@/operations/getContentOps';
import { getMetadata } from '@/operations/metadataOps';
import { getDiff } from '@/operations/diffOps';
import { MCPErrorStatus } from '@/types/common';

export const readToolHandler = async (
  params: ReadTool.Parameters,
  config: ConduitServerConfig
): Promise<
  | ReadTool.DefinedContentResponse
  | ReadTool.DefinedMetadataResponse
  | ReadTool.DefinedDiffResponse
  | MCPErrorStatus
> => {
  try {
    switch (params.operation) {
      case 'content': {
        const contentParams = params as ReadTool.ContentParams;
        const allContentResults: ReadTool.ContentResultItem[] = [];
        for (const source of contentParams.sources) {
          const resultItem = await getContent(source, contentParams, config);
          allContentResults.push(resultItem);
        }
        return { tool_name: 'read', results: allContentResults };
      }

      case 'metadata': {
        const metadataParams = params as ReadTool.MetadataParams;
        const allMetadataResults: ReadTool.MetadataResultItem[] = [];
        for (const source of metadataParams.sources) {
          const resultItem = await getMetadata(source, metadataParams, config);
          allMetadataResults.push(resultItem);
        }
        return { tool_name: 'read', results: allMetadataResults };
      }

      case 'diff': {
        const diffParams = params as ReadTool.DiffParams;
        const diffResult = await getDiff(diffParams, config);
        return { tool_name: 'read', results: diffResult };
      }

      default:
        logger.error(`Unknown read operation: ${(params as any).operation}`);
        return createMCPErrorStatus(
          ErrorCode.UNSUPPORTED_OPERATION,
          `Unsupported read operation: ${(params as any).operation}`
        );
    }
  } catch (error: any) {
    logger.error(`Error in read tool: ${error.message}`, error);

    if (error instanceof ConduitError) {
      return createMCPErrorStatus(error.errorCode, error.message);
    } else {
      const message = `An unexpected error occurred in the read tool: ${error.message}${error.stack ? '\nStack: ' + error.stack : ''}`;
      return createMCPErrorStatus(ErrorCode.INTERNAL_ERROR, message);
    }
  }
};
