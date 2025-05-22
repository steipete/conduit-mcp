import {
  ListTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
  fileSystemOps,
  conduitConfig,
  validateAndResolvePath,
  createMCPErrorStatus,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';
import { handleListEntries } from '@/operations/listOps';
import path from 'path';

export async function listToolHandler(
  params: ListTool.Parameters,
  config: ConduitServerConfig
): Promise<
  | ListTool.DefinedEntriesResponse
  | ListTool.DefinedServerCapabilitiesResponse
  | ListTool.DefinedFilesystemStatsResponse
  | MCPErrorStatus
> {
  try {
    switch (params.operation) {
      case 'entries': {
        // Type guard params to ListTool.EntriesParams is still good practice
        if (params.operation === 'entries') {
          try {
            const resolvedPath = await validateAndResolvePath(params.path, {
              isExistenceRequired: true,
              checkAllowed: true,
            });

            const baseStats = await fileSystemOps.getStats(resolvedPath);
            if (!baseStats.isDirectory()) {
              return {
                tool_name: 'list',
                ...createMCPErrorStatus(
                  ErrorCode.ERR_FS_PATH_IS_FILE,
                  `Provided path is a file, not a directory: ${resolvedPath}`
                ),
              };
            }

            const entries = await handleListEntries(params /*, config */); // Call the new op handler
            return { tool_name: 'list', results: entries };
          } catch (error) {
            if (error instanceof ConduitError) {
              return {
                tool_name: 'list',
                ...createMCPErrorStatus(error.errorCode, error.message),
              };
            }
            return {
              tool_name: 'list',
              ...createMCPErrorStatus(
                ErrorCode.INTERNAL_ERROR,
                `Path validation failed: ${error instanceof Error ? error.message : String(error)}`
              ),
            };
          }
        }
        // Fallback, though type guard should prevent this
        return {
          tool_name: 'list',
          ...createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Type guard failed for list.entries'),
        };
      }

      case 'system_info': {
        const systemInfoParams = params as ListTool.SystemInfoParams;
        switch (systemInfoParams.info_type) {
          case 'server_capabilities': {
            const capabilities: ListTool.ServerCapabilities = {
              server_version: config.serverVersion,
              active_configuration: {
                HTTP_TIMEOUT_MS: conduitConfig.httpTimeoutMs,
                MAX_PAYLOAD_SIZE_BYTES: conduitConfig.maxPayloadSizeBytes,
                MAX_FILE_READ_BYTES: conduitConfig.maxFileReadBytes,
                MAX_URL_DOWNLOAD_BYTES: conduitConfig.maxUrlDownloadSizeBytes,
                IMAGE_COMPRESSION_THRESHOLD_BYTES: conduitConfig.imageCompressionThresholdBytes,
                IMAGE_COMPRESSION_QUALITY: conduitConfig.imageCompressionQuality,
                DEFAULT_CHECKSUM_ALGORITHM: conduitConfig.defaultChecksumAlgorithm,
                MAX_RECURSIVE_DEPTH: conduitConfig.maxRecursiveDepth,
                RECURSIVE_SIZE_TIMEOUT_MS: conduitConfig.recursiveSizeTimeoutMs,
                ALLOWED_PATHS: config.resolvedAllowedPaths,
              },
              supported_checksum_algorithms: ['md5', 'sha1', 'sha256', 'sha512'],
              supported_archive_formats: ['zip', 'tar.gz', 'tgz'],
              default_checksum_algorithm: conduitConfig.defaultChecksumAlgorithm,
              max_recursive_depth: conduitConfig.maxRecursiveDepth,
            };
            return { tool_name: 'list', results: capabilities };
          }

          case 'filesystem_stats': {
            if (!systemInfoParams.path) {
              return {
                tool_name: 'list',
                results: {
                  info_type_requested: 'filesystem_stats',
                  status_message:
                    "No specific path provided for filesystem_stats. To retrieve statistics for a filesystem volume, please provide a 'path' parameter pointing to a location within one of the configured allowed paths.",
                  server_version: config.serverVersion,
                  server_start_time_iso: config.serverStartTimeIso,
                  configured_allowed_paths: config.resolvedAllowedPaths,
                },
              };
            } else {
              const stats = await fileSystemOps.getFilesystemStats(systemInfoParams.path);
              const resolvedPath = path.resolve(systemInfoParams.path);
              return {
                tool_name: 'list',
                results: {
                  path_queried: resolvedPath,
                  total_bytes: stats.total_bytes,
                  free_bytes: stats.free_bytes,
                  available_bytes: stats.available_bytes,
                  used_bytes: stats.used_bytes,
                },
              };
            }
          }

          default:
            return {
              tool_name: 'list',
              ...createErrorResponse(
                ErrorCode.INVALID_PARAMETER,
                `Unknown info_type: ${(systemInfoParams as unknown as { info_type: string }).info_type}`
              ),
            };
        }
      }

      default:
        return {
          tool_name: 'list',
          ...createErrorResponse(
            ErrorCode.INVALID_PARAMETER,
            `Unknown operation: ${(params as unknown as { operation: string }).operation}`
          ),
        };
    }
  } catch (error) {
    logger.error('Error in listToolHandler:', error);
    if (error instanceof ConduitError) {
      return {
        tool_name: 'list',
        ...createErrorResponse(error.errorCode, error.message),
      };
    }
    return {
      tool_name: 'list',
      ...createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
      ),
    };
  }
}
