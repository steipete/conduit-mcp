// Import config early as it's needed by other modules
import { loadConfig } from './core/configLoader';

// Create and export the config instance
const activeConfig = loadConfig();
export { activeConfig as conduitConfig };

// ======= Types Re-exports =======

// From src/types/common.ts - all named exports
export * from './types/common';

// From src/types/config.ts - all named exports
export * from './types/config';

// From src/types/tools.ts - all tool namespaces
export * from './types/tools';

// From src/types/mcp.ts
export * from './types/mcp';

// ======= Utils Re-exports =======

// From src/utils/errorHandler.ts (avoid re-exporting ErrorCode since it's already exported from types/common)
export {
  ConduitError,
  createErrorResponse,
  createMCPError,
  createMCPErrorStatus,
} from './utils/errorHandler';

// From src/utils/logger.ts - the logger instance
export { default as logger } from './utils/logger';

// From src/utils/dateTime.ts - formatToISO8601UTC function
export * from './utils/dateTime';

// From src/utils/checksum.ts - calculateChecksum function
export * from './utils/checksum';

// ======= Core Module Re-exports =======

// From src/core/configLoader.ts
export * as configLoader from './core/configLoader';
export { loadConfig as loadConduitConfig } from './core/configLoader';

// From src/core/securityHandler.ts
export * as securityHandler from './core/securityHandler';
export { validateAndResolvePath, isPathAllowed } from './core/securityHandler';

// From src/core/fileSystemOps.ts - export as namespace
export * as fileSystemOps from './core/fileSystemOps';

// From src/core/mimeService.ts - getMimeType function
export * as mimeService from './core/mimeService';
export { getMimeType } from './core/mimeService';

// From src/core/webFetcher.ts - export as namespace
export * as webFetcher from './core/webFetcher';

// From src/core/imageProcessor.ts - export as namespace
export * as imageProcessor from './core/imageProcessor';
export type { CompressionResult } from './core/imageProcessor';

// From src/core/noticeService.ts
export * as noticeService from './core/noticeService';

// From src/core/pathValidator.ts - new unified path validation system
export { 
  PathValidationStrategy, 
  PathResolver, 
  PathPermissionChecker, 
  PathExistenceChecker 
} from './core/pathValidator';

// ======= Operations Re-exports =======
export * from './operations/getContentOps';
export * from './operations/putContentOps';
export * from './operations/metadataOps';
export * from './operations/archiveOps';
export * from './operations/diffOps';
export * from './operations/mkdirOps';
export * from './operations/listOps';
export * from './operations/findOps';
export * from './operations/batchWriteOps';

// ======= Tool Handlers (as used by server.ts) =======
export { readToolHandler as handleReadTool } from './tools/readTool';
export { writeToolHandler as handleWriteTool } from './tools/writeTool';
export { listToolHandler as handleListTool } from './tools/listTool';
export { findToolHandler as handleFindTool } from './tools/findTool';
export { testToolHandler as handleTestTool } from './tools/testTool';
