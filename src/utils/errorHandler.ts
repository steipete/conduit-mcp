import { MCPError, MCPErrorStatus, ErrorCode } from '@/types/common';

// Re-export ErrorCode so callers can continue to import from utils/errorHandler via internal barrel.
export { ErrorCode };

/**
 * Creates a standardized MCP error object.
 * @param errorCode The unique error code.
 * @param message A descriptive human-readable error message.
 * @returns MCPError object.
 */
export function createMCPError(errorCode: ErrorCode, message: string): MCPError {
  return {
    error_code: errorCode,
    error_message: message,
  };
}

/**
 * Creates a standardized MCP error status object for tool responses.
 * @param errorCode The unique error code.
 * @param message A descriptive human-readable error message.
 * @returns MCPErrorStatus object.
 */
export function createMCPErrorStatus(errorCode: ErrorCode, message: string): MCPErrorStatus {
  return {
    status: 'error',
    error_code: errorCode,
    error_message: message,
  };
}

/**
 * Utility class for throwing standardized Conduit errors.
 */
export class ConduitError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly MCPPErrorStatus: MCPErrorStatus;
  public readonly isConduitError = true;
  public readonly httpStatus?: number;

  constructor(errorCode: ErrorCode, message?: string, options?: { httpStatus?: number }) {
    let fullMessage: string;
    if (!message && errorCode === ErrorCode.ERR_INTERNAL_SERVER_ERROR) {
      fullMessage = 'An internal server error occurred.';
    } else {
      fullMessage = message || `Conduit operation failed with code: ${errorCode}`;
    }
    super(fullMessage);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.MCPPErrorStatus = createMCPErrorStatus(errorCode, fullMessage);
    this.httpStatus = options?.httpStatus;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Creates a standardized error response for tool handlers.
 * @param errorCode The unique error code.
 * @param message A descriptive human-readable error message.
 * @returns MCPErrorStatus object.
 */
export function createErrorResponse(errorCode: ErrorCode, message: string): MCPErrorStatus {
  return createMCPErrorStatus(errorCode, message);
}

export { MCPErrorStatus, MCPError };
