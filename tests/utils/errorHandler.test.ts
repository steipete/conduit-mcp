import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  createMCPError,
  createMCPErrorStatus,
  ConduitError,
  MCPErrorStatus, // For type checking
  MCPError // For type checking
} from '@/utils/errorHandler';

describe('errorHandler utils', () => {
  describe('createMCPError', () => {
    it('should create an MCPError object with given code and message', () => {
      const errorCode = ErrorCode.ERR_INVALID_PARAMETER;
      const errorMessage = 'Test parameter is missing.';
      const errorObj: MCPError = createMCPError(errorCode, errorMessage);

      expect(errorObj).toEqual({
        error_code: errorCode,
        error_message: errorMessage,
      });
    });
  });

  describe('createMCPErrorStatus', () => {
    it('should create an MCPErrorStatus object with status \'error\' and given code/message', () => {
      const errorCode = ErrorCode.ERR_FS_NOT_FOUND;
      const errorMessage = 'File not found at path.';
      const errorStatusObj: MCPErrorStatus = createMCPErrorStatus(errorCode, errorMessage);

      expect(errorStatusObj).toEqual({
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
      });
    });
  });

  describe('ConduitError', () => {
    it('should create an instance of Error', () => {
      const conduitError = new ConduitError(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(conduitError).toBeInstanceOf(Error);
    });

    it('should have the correct name', () => {
      const conduitError = new ConduitError(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(conduitError.name).toBe('ConduitError');
    });

    it('should store the provided errorCode', () => {
      const errorCode = ErrorCode.ERR_UNKNOWN_TOOL;
      const conduitError = new ConduitError(errorCode);
      expect(conduitError.errorCode).toBe(errorCode);
    });

    it('should use a default message if none is provided', () => {
      const errorCode = ErrorCode.ERR_CONFIG_INVALID;
      const conduitError = new ConduitError(errorCode);
      expect(conduitError.message).toBe(`Conduit operation failed with code: ${errorCode}`);
    });

    it('should use the provided message if one is given', () => {
      const errorCode = ErrorCode.ERR_HTTP_TIMEOUT;
      const customMessage = 'The HTTP request timed out after 30 seconds.';
      const conduitError = new ConduitError(errorCode, customMessage);
      expect(conduitError.message).toBe(customMessage);
    });

    it('should create and store an MCPPErrorStatus object', () => {
      const errorCode = ErrorCode.ERR_FS_ACCESS_DENIED;
      const customMessage = 'Access to the path is denied.';
      const conduitError = new ConduitError(errorCode, customMessage);

      expect(conduitError.MCPPErrorStatus).toEqual({
        status: 'error',
        error_code: errorCode,
        error_message: customMessage,
      });
    });

    it('MCPPErrorStatus message should match default message if no custom message provided', () => {
      const errorCode = ErrorCode.ERR_NOT_IMPLEMENTED;
      const conduitError = new ConduitError(errorCode);
      const expectedMessage = `Conduit operation failed with code: ${errorCode}`;

      expect(conduitError.MCPPErrorStatus).toEqual({
        status: 'error',
        error_code: errorCode,
        error_message: expectedMessage,
      });
    });

    it('should capture stack trace', () => {
      const conduitError = new ConduitError(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(conduitError.stack).toBeDefined();
      expect(conduitError.stack).toContain('ConduitError');
    });
  });
});