import { conduitConfig } from '@/core/configLoader';
import { validateAndResolvePath } from '@/core/securityHandler';
import { findEntriesRecursive } from '@/operations/findOps';
import { FindTool } from '@/types/tools';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import { EntryInfo } from '@/types/common';

export async function handleFindTool(params: FindTool.Parameters): Promise<FindTool.FindResponse> {
  if (!params || !params.base_path) {
    throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing 'base_path' parameter for find tool.");
  }
  if (!params.match_criteria || params.match_criteria.length === 0) {
    throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'match_criteria' for find tool.");
  }

  const resolvedBasePath = await validateAndResolvePath(params.base_path, {isExistenceRequired: true});
  const results: EntryInfo[] = [];
  
  const recursive = params.recursive === undefined ? true : params.recursive;
  const maxDepth = recursive ? conduitConfig.maxRecursiveDepth : 0;
  const entryTypeFilter = params.entry_type_filter || 'any';

  try {
    await findEntriesRecursive(
      resolvedBasePath,
      params.match_criteria,
      entryTypeFilter,
      recursive,
      0, // currentDepth starts at 0
      maxDepth,
      results
    );
    return results;
  } catch (error: any) {
    logger.error(`Find operation failed for base_path ${params.base_path}: ${error.message}`);
    // findEntriesRecursive should handle individual errors and not throw for the whole op unless critical.
    // This catch is for unexpected errors from the top-level call itself or if findEntriesRecursive is changed to throw.
    if (error instanceof ConduitError) {
      throw error;
    }
    throw new ConduitError(ErrorCode.ERR_FS_OPERATION_FAILED, `Find operation failed: ${error.message}`);
  }
} 