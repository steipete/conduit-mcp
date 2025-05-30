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
        logger.error(
          `Unknown read operation: ${(params as unknown as { operation: string }).operation}`
        );
        return {
          tool_name: 'read',
          ...createMCPErrorStatus(
            ErrorCode.UNSUPPORTED_OPERATION,
            `Unsupported read operation: ${(params as unknown as { operation: string }).operation}`
          ),
        };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in read tool: ${errorMessage}`, error);

    if (error instanceof ConduitError) {
      return {
        tool_name: 'read',
        ...createMCPErrorStatus(error.errorCode, error.message),
      };
    } else {
      const stack = error instanceof Error && error.stack ? `\nStack: ${error.stack}` : '';
      const message = `An unexpected error occurred in the read tool: ${errorMessage}${stack}`;
      return {
        tool_name: 'read',
        ...createMCPErrorStatus(ErrorCode.INTERNAL_ERROR, message),
      };
    }
  }
};
