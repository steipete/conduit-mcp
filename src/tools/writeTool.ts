import {
  WriteTool,
  ArchiveTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
  handleBatchPut,
  handleBatchMkdir,
  handleBatchCopy,
  handleBatchMove,
  handleBatchDelete,
  handleBatchTouch,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';
import { createArchive, extractArchive } from '@/operations/archiveOps';

export async function writeToolHandler(
  params: WriteTool.Parameters,
  config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse | WriteTool.DefinedArchiveResponse | MCPErrorStatus> {
  try {
    switch (params.action) {
      case 'put': {
        const putParams = params as WriteTool.PutParams;
        return await handleBatchPut(putParams, config);
      }

      case 'archive': {
        const writeToolArchiveParams = params as WriteTool.ArchiveParams;

        const createArchiveToolParams: ArchiveTool.CreateArchiveParams = {
          operation: 'create',
          source_paths: writeToolArchiveParams.source_paths,
          archive_path: writeToolArchiveParams.archive_path,
          compression:
            writeToolArchiveParams.format === 'tar.gz' || writeToolArchiveParams.format === 'tgz'
              ? 'gzip'
              : writeToolArchiveParams.format === 'zip'
                ? undefined
                : 'none',
          options: writeToolArchiveParams.options,
          metadata: writeToolArchiveParams.metadata,
        };

        const archiveResult = await createArchive(createArchiveToolParams, config);

        return {
          tool_name: 'write',
          results: [archiveResult],
        };
      }

      case 'mkdir': {
        const mkdirParams = params as WriteTool.MkdirParams;
        return await handleBatchMkdir(mkdirParams, config);
      }

      case 'copy': {
        const copyParams = params as WriteTool.CopyParams;
        return await handleBatchCopy(copyParams, config);
      }

      case 'move': {
        const moveParams = params as WriteTool.MoveParams;
        return await handleBatchMove(moveParams, config);
      }

      case 'delete': {
        const deleteParams = params as WriteTool.DeleteParams;
        return await handleBatchDelete(deleteParams, config);
      }

      case 'touch': {
        const touchParams = params as WriteTool.TouchParams;
        return await handleBatchTouch(touchParams, config);
      }

      case 'unarchive': {
        const writeToolUnarchiveParams = params as WriteTool.UnarchiveParams;

        const extractArchiveToolParams: ArchiveTool.ExtractArchiveParams = {
          operation: 'extract',
          archive_path: writeToolUnarchiveParams.archive_path,
          target_path: writeToolUnarchiveParams.destination_path,
          options: writeToolUnarchiveParams.options,
        };

        const unarchiveResult = await extractArchive(extractArchiveToolParams, config);

        return {
          tool_name: 'write',
          results: [unarchiveResult],
        };
      }

      default: {
        return createErrorResponse(
          ErrorCode.UNSUPPORTED_OPERATION,
          `Unsupported action: ${(params as unknown as { action: string }).action}`
        );
      }
    }
  } catch (e) {
    const errorCode = e instanceof ConduitError ? e.errorCode : ErrorCode.INTERNAL_ERROR;
    const message = e instanceof Error ? e.message : String(e);

    logger.error('writeToolHandler error:', e);

    return createErrorResponse(errorCode, message);
  }
}
