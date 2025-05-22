import {
  ListTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
  EntryInfo,
  fileSystemOps,
  conduitConfig,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';
import { handleListEntries } from '@/operations/listOps'; // Add this import
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
          const entries = await handleListEntries(params /*, config */); // Call the new op handler
          return { tool_name: 'list', results: entries };
        }
        // Fallback, though type guard should prevent this
        return createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Type guard failed for list.entries');
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
            return createErrorResponse(
              ErrorCode.INVALID_PARAMETER,
              `Unknown info_type: ${(systemInfoParams as any).info_type}`
            );
        }
      }

      default:
        return createErrorResponse(
          ErrorCode.INVALID_PARAMETER,
          `Unknown operation: ${(params as any).operation}`
        );
    }
  } catch (error) {
    logger.error('Error in listToolHandler:', error);
    if (error instanceof ConduitError) {
      return createErrorResponse(error.errorCode, error.message);
    }
    return createErrorResponse(
      ErrorCode.INTERNAL_ERROR,
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
