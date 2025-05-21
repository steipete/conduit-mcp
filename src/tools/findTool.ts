import { conduitConfig } from '@/core/configLoader';
import { FindTool, EntryInfo, MCPErrorStatus, ConduitError, ErrorCode, createMCPErrorStatus } from '@/internal';
import { findEntries } from '@/operations/findOps';
import logger from '@/utils/logger';

const operationLogger = logger.child({ component: 'findToolHandler' });

export async function handleFindTool(
    params: FindTool.Parameters
): Promise<FindTool.FindResponse | MCPErrorStatus> {
    if (!params) {
        return createMCPErrorStatus(ErrorCode.ERR_INVALID_PARAMETER, "Missing parameters for find tool.");
    }
    if (!params.base_path) {
        return createMCPErrorStatus(ErrorCode.ERR_INVALID_PARAMETER, "Missing 'base_path' parameter for find tool.");
    }
    if (!params.match_criteria || params.match_criteria.length === 0) {
        return createMCPErrorStatus(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'match_criteria' parameter for find tool.");
    }

    try {
        const results = await findEntries(params, conduitConfig);
        if (results instanceof ConduitError) {
            return createMCPErrorStatus(results.errorCode, results.message);
        }
        return results; // This is EntryInfo[]
    } catch (error: any) {
        operationLogger.error(`Unhandled error in handleFindTool: ${error.message}`, { errorDetails: error.details, stack: error.stack });
        if (error instanceof ConduitError) {
            return createMCPErrorStatus(error.errorCode, error.message);
        }
        return createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, `Internal server error in find tool: ${error.message || 'Unknown error'}`);
    }
} 