import {
  TestTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';

/**
 * Handler for the test tool operations
 */
export async function testToolHandler(
  params: TestTool.Parameters,
  _config: ConduitServerConfig
): Promise<TestTool.DefinedEchoResponse | MCPErrorStatus> {
  try {
    switch (params.operation) {
      case 'echo': {
        const echoParams = params as TestTool.EchoParams;
        const echoResult: TestTool.EchoResultSuccess = {
          status: 'success',
          echoed_params: echoParams.params_to_echo,
        };
        return { tool_name: 'test', results: echoResult };
      }

      case 'generate_error': {
        const errorParams = params as TestTool.GenerateErrorParams;
        return createErrorResponse(
          errorParams.error_code_to_generate as ErrorCode,
          errorParams.error_message_to_generate
        );
      }

      default:
        logger.error(
          `Unsupported test operation: ${(params as unknown as { operation: string }).operation}`
        );
        return createErrorResponse(
          ErrorCode.UNSUPPORTED_OPERATION,
          `Unsupported test operation: ${(params as unknown as { operation: string }).operation}`
        );
    }
  } catch (error) {
    if (error instanceof ConduitError) {
      return createErrorResponse(error.errorCode, error.message);
    }
    return createErrorResponse(
      ErrorCode.UNKNOWN_ERROR,
      `Unexpected error in test tool: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
