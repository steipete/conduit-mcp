import { conduitConfig } from '@/core/configLoader';
import { validateAndResolvePath } from '@/core/securityHandler';
// import * as fsOps from '@/core/fileSystemOps'; // No longer directly needed here for entries
import { ListTool, EntryInfo, MCPErrorStatus, ConduitError, ErrorCode, createMCPErrorStatus } from '@/internal'; // Updated imports
import { listEntries } from '@/operations/listOps'; // Import the new listEntries
import logger from '@/utils/logger';
import checkDiskSpace from 'check-disk-space'; // Added import
// import path from 'path'; // No longer needed here
// import os from 'os'; // For filesystem_stats when no path is given - keep
// import fs from 'fs/promises'; // For checkDiskSpace - keep

// const operationLogger = logger.child({ component: 'listToolHandler' }); // Added logger for the handler

// Removed getDirectoryEntriesRecursive and handleEntriesOperation as their logic is now in listOps.ts

async function handleSystemInfoOperation(params: ListTool.SystemInfoParams): Promise<ListTool.ServerCapabilitiesResponse | ListTool.FilesystemStatsResponse> {
  const operationLogger = logger.child({ component: 'listToolHandler' }); // Moved here
  if (params.info_type === 'server_capabilities') {
    const activeConfigForDisplay: Record<string, any> = { ...conduitConfig };
    return {
      server_version: conduitConfig.serverVersion,
      active_configuration: activeConfigForDisplay,
      supported_checksum_algorithms: ['md5', 'sha1', 'sha256', 'sha512'],
      supported_archive_formats: ['zip', 'tar.gz', 'tgz'],
      default_checksum_algorithm: conduitConfig.defaultChecksumAlgorithm,
      max_recursive_depth: conduitConfig.maxRecursiveDepth,
    } as ListTool.ServerCapabilities;
  } else if (params.info_type === 'filesystem_stats') {
    if (!params.path) {
      return {
        info_type_requested: 'filesystem_stats',
        status_message: "No specific path provided for filesystem_stats. To retrieve statistics for a filesystem volume, please provide a 'path' parameter pointing to a location within one of the configured allowed paths.",
        server_version: conduitConfig.serverVersion,
        server_start_time_iso: conduitConfig.serverStartTimeIso,
        configured_allowed_paths: conduitConfig.allowedPaths, 
      } as ListTool.FilesystemStatsNoPath;
    }
    const resolvedPath = await validateAndResolvePath(params.path, {isExistenceRequired: true});
    try {
       // Use checkDiskSpace library
       const diskSpace = await checkDiskSpace(resolvedPath);
       return {
        path_queried: resolvedPath,
        total_bytes: diskSpace.size,
        free_bytes: diskSpace.free,
        available_bytes: diskSpace.free, // check-disk-space typically shows free as available to user
        used_bytes: diskSpace.size - diskSpace.free,
       } as ListTool.FilesystemStats;
    } catch (error: any) {
        operationLogger.error(`Filesystem stats failed for path ${resolvedPath} using checkDiskSpace: ${error.message}`);
        if (error instanceof ConduitError) throw error; // Re-throw if it's already a ConduitError (e.g. from validateAndResolvePath)
        // Wrap other errors from checkDiskSpace
        throw new ConduitError(ErrorCode.OPERATION_FAILED, `Failed to get filesystem stats for ${resolvedPath}: ${error.message || 'Unknown error from checkDiskSpace'}`);
    }
  }
  // This part should be logically unreachable because the switch in handleListTool covers all known info_type or defaults.
  // However, to satisfy TypeScript's exhaustiveness checks for return paths if new info_types were added without updating the switch:
  throw new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION, `Invalid or unhandled info_type: ${(params as any).info_type}`);
}

export async function handleListTool(
  params: ListTool.Parameters
  ): Promise<ListTool.EntriesResponse | ListTool.ServerCapabilitiesResponse | ListTool.FilesystemStatsResponse | MCPErrorStatus> {
  const operationLogger = logger.child({ component: 'listToolHandler' });

  if (!params || !params.operation) {
    return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'operation' parameter for list tool.");
  }

  try {
    switch (params.operation) {
      case 'entries':
        if (!params.path) {
          return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'path' parameter for list.entries operation.");
        }
        // Assuming listEntries and conduitConfig are correctly imported/available
        const result = await listEntries(params as ListTool.EntriesParams, conduitConfig);
        // Type guard or assertion might be needed if listEntries can return ConduitError directly
        if (result instanceof ConduitError) { // Or check for MCPErrorStatus structure
            return createMCPErrorStatus(result.errorCode, result.message);
        }
        return result as ListTool.EntriesResponse; // Ensure correct type casting
      case 'system_info':
        if (!params.info_type) {
          return createMCPErrorStatus(ErrorCode.INVALID_PARAMETER, "Missing 'info_type' parameter for list.system_info operation.");
        }
        // Assuming handleSystemInfoOperation is correctly imported/available
        return await handleSystemInfoOperation(params as ListTool.SystemInfoParams);
      default:
        // @ts-expect-error If switch is exhaustive, params.operation is never here.
        const exhaustiveCheck: never = params.operation;
        operationLogger.error(`Unknown list operation received: ${exhaustiveCheck as string}`);
        return createMCPErrorStatus(ErrorCode.UNSUPPORTED_OPERATION, `Unknown operation '${exhaustiveCheck as string}' for list tool.`);
    }
  } catch (error: any) {
    operationLogger.error(`Unhandled error in handleListTool: ${error.message}`, { errorDetails: error.details, stack: error.stack });
    if (error instanceof ConduitError) {
        return createMCPErrorStatus(error.errorCode, error.message);
    }
    return createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, `Internal server error in list tool: ${error.message || 'Unknown error'}`);
  }
} 