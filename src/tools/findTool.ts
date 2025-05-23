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

    // Validate input parameters
    if (!params.path || typeof params.path !== 'string' || params.path.trim() === '') {
      return {
        tool_name: 'find',
        ...createMCPErrorStatus(ErrorCode.ERR_FS_INVALID_PATH, 'Path must be a non-empty string.'),
      };
    }

    // Validate and resolve the path
    const resolvedPath = await validateAndResolvePath(params.path, {
      isExistenceRequired: true,
      checkAllowed: true,
    });

    // Check if the resolved path is a directory
    const pathStats = await fileSystemOps.getStats(resolvedPath);
    if (!pathStats.isDirectory()) {
      return {
        tool_name: 'find',
        ...createMCPErrorStatus(
          ErrorCode.ERR_FS_PATH_IS_FILE,
          `Provided path is a file, not a directory: ${resolvedPath}`
        ),
      };
    }

    // Create updated params with resolved path
    const updatedParams = { ...params, path: resolvedPath };
    const result = await findEntries(updatedParams, config);

    if (result instanceof ConduitError) {
      return {
        tool_name: 'find',
        ...createMCPErrorStatus(result.errorCode, result.message),
      };
    }

    return { tool_name: 'find', results: result };
  } catch (error) {
    if (error instanceof ConduitError) {
      return {
        tool_name: 'find',
        ...createMCPErrorStatus(error.errorCode, error.message),
      };
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in find tool handler: ${errorMessage}`);
      return {
        tool_name: 'find',
        ...createMCPErrorStatus(ErrorCode.INTERNAL_ERROR, `Internal server error: ${errorMessage}`),
      };
    }
  }
}
