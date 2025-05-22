import {
  FindTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
  validateAndResolvePath,
  fileSystemOps,
  createMCPErrorStatus,
} from '@/internal';
import { findEntries } from '@/operations/findOps';

export async function findToolHandler(
  params: FindTool.Parameters,
  config: ConduitServerConfig
): Promise<FindTool.DefinedFindResponse | MCPErrorStatus> {
  try {
    logger.info('Find tool operation called');

    // Validate and resolve the base path
    const resolvedBasePath = await validateAndResolvePath(params.base_path, {
      isExistenceRequired: true,
      checkAllowed: true,
    });

    // Check if the resolved path is a directory
    const baseStats = await fileSystemOps.getStats(resolvedBasePath);
    if (!baseStats.isDirectory()) {
      return createMCPErrorStatus(
        ErrorCode.ERR_FS_PATH_IS_FILE,
        `Provided base_path is a file, not a directory: ${resolvedBasePath}`
      );
    }

    // Create updated params with resolved path
    const updatedParams = { ...params, base_path: resolvedBasePath };
    const result = await findEntries(updatedParams, config);

    if (result instanceof ConduitError) {
      return createMCPErrorStatus(result.errorCode, result.message);
    }

    return { tool_name: 'find', results: result };
  } catch (error) {
    if (error instanceof ConduitError) {
      return createMCPErrorStatus(error.errorCode, error.message);
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in find tool handler: ${errorMessage}`);
      return createMCPErrorStatus(
        ErrorCode.INTERNAL_ERROR,
        `Internal server error: ${errorMessage}`
      );
    }
  }
}
