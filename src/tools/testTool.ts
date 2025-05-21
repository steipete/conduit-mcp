import { TestTool, MCPErrorStatus, ErrorCode, createMCPErrorStatus, MCPSuccess } from '@/internal';
import logger from '@/utils/logger';

export async function handleTestTool(
    params: TestTool.Parameters
): Promise<TestTool.EchoResponse | MCPErrorStatus> { // EchoResponse is MCPToolResponse<EchoResultSuccess>
    const operationLogger = logger.child({ component: 'testToolHandler' });
    operationLogger.info(`Handling testTool with operation: ${params.operation}`);

    if (!params.operation) {
        return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'operation' parameter for test tool.");
    }

    switch (params.operation) {
        case 'echo':
            if (!params.hasOwnProperty('params_to_echo')) { // Check for presence, even if null/undefined
                return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'params_to_echo' for echo operation.");
            }
            const successResult: TestTool.EchoResultSuccess = {
                status: 'success',
                echoed_params: params.params_to_echo,
            };
            return successResult; // MCPToolResponse<EchoResultSuccess> will be just EchoResultSuccess here based on type def

        case 'generate_error':
            if (!params.error_code_to_generate) {
                return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'error_code_to_generate' for generate_error operation.");
            }
            if (!params.error_message_to_generate) {
                return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'error_message_to_generate' for generate_error operation.");
            }
            if (Object.values(ErrorCode).includes(params.error_code_to_generate as ErrorCode)) {
                // The createMCPErrorStatus function will correctly type this as MCPErrorStatus
                return createMCPErrorStatus(params.error_code_to_generate as ErrorCode, params.error_message_to_generate);
            }
            // Fallthrough for unknown error codes to be treated as generic operation failed
            return createMCPErrorStatus(ErrorCode.OPERATION_FAILED, 
                `Simulating error: ${params.error_code_to_generate} - ${params.error_message_to_generate}`
                // Removed { simulated: true } as createMCPErrorStatus doesn't take a third arg for details
            );

        default:
            // @ts-expect-error - operation should be one of the known types
            const exhaustiveCheck: never = params.operation;
            operationLogger.error(`Unknown test tool operation: ${exhaustiveCheck}`);
            return createMCPErrorStatus(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION, `Unknown operation '${exhaustiveCheck as string}' for test tool.`);
    }
} 