import { WriteTool, ConduitServerConfig, ErrorCode, logger, putContent } from '@/internal';

const operationLogger = logger.child({ component: 'putOpsHandler' });

// Main handler for the 'put' action of the 'write' tool
export async function handleWritePut(
    params: WriteTool.PutParams, 
    config: ConduitServerConfig
): Promise<WriteTool.BatchResponse> {
    operationLogger.debug(`Handling write tool 'put' action with params: ${JSON.stringify(params)}`);

    if (!params.entries || params.entries.length === 0) {
        const errorItem: WriteTool.WriteResultItem = {
            status: 'error',
            error_code: ErrorCode.ERR_INVALID_PARAMETER,
            error_message: 'The 'entries' array is required and cannot be empty for the \'put\' action.',
            action_performed: 'put', // General action type for this batch failure
            // path is optional in BaseResult, so omitting it here is fine for a batch-level error
        };
        return { results: [errorItem] }; 
    }
  
    const results: WriteTool.WriteResultItem[] = await Promise.all(
        params.entries.map(entry => putContent(entry, config))
    );
  
    return { results };
} 