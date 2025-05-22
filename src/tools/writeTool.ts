import {
  WriteTool,
  ArchiveTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  logger,
  MCPErrorStatus,
  fileSystemOps,
} from '@/internal';
import { createErrorResponse } from '@/utils/errorHandler';
import { createArchive, extractArchive } from '@/operations/archiveOps';

function createErrorWriteResultItem(
  action: WriteTool.WriteAction,
  errorCode: ErrorCode,
  message: string,
  paths: { path?: string; source_path?: string; destination_path?: string }
): WriteTool.WriteResultItem {
  return {
    status: 'error',
    error_code: errorCode,
    error_message: message,
    action_performed: action,
    ...paths,
  };
}

export async function writeToolHandler(
  params: WriteTool.Parameters,
  config: ConduitServerConfig
): Promise<WriteTool.DefinedBatchResponse | WriteTool.DefinedArchiveResponse | MCPErrorStatus> {
  try {
    switch (params.action) {
      case 'put': {
        const putParams = params as WriteTool.PutParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!putParams.entries || putParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for put action.'
          );
        }

        for (const entry of putParams.entries) {
          try {
            let fsWriteMode: 'overwrite' | 'append' | undefined = undefined;
            if (entry.write_mode === 'overwrite' || entry.write_mode === 'append') {
              fsWriteMode = entry.write_mode;
            } else if (entry.write_mode === 'error_if_exists') {
              if (await fileSystemOps.pathExists(entry.path)) {
                throw new ConduitError(
                  ErrorCode.ERR_FS_ALREADY_EXISTS,
                  `File already exists at ${entry.path} and write_mode is 'error_if_exists'.`
                );
              }
              fsWriteMode = 'overwrite'; // If it doesn't exist, overwrite is fine.
            } else {
              fsWriteMode = 'overwrite'; // Default to overwrite if mode is undefined
            }

            const bytesWritten = await fileSystemOps.writeFile(
              entry.path,
              entry.content,
              entry.input_encoding,
              fsWriteMode
            );

            results.push({
              status: 'success',
              action_performed: 'put',
              path: entry.path,
              bytes_written: bytesWritten,
            });
          } catch (e) {
            const errorCode =
              e instanceof ConduitError ? e.errorCode : ErrorCode.ERR_FS_WRITE_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('put', errorCode, message, { path: entry.path })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
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
          options: undefined,
          metadata: undefined,
        };

        const archiveResult = await createArchive(createArchiveToolParams, config);

        return {
          tool_name: 'write',
          results: [archiveResult],
        };
      }

      case 'mkdir': {
        const mkdirParams = params as WriteTool.MkdirParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!mkdirParams.entries || mkdirParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for mkdir action.'
          );
        }

        for (const entry of mkdirParams.entries) {
          try {
            await fileSystemOps.createDirectory(entry.path, entry.recursive);

            results.push({
              status: 'success',
              action_performed: 'mkdir',
              path: entry.path,
              message: 'Directory created.',
            });
          } catch (e) {
            const errorCode =
              e instanceof ConduitError ? e.errorCode : ErrorCode.ERR_FS_DIR_CREATE_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('mkdir', errorCode, message, { path: entry.path })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
      }

      case 'copy': {
        const copyParams = params as WriteTool.CopyParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!copyParams.entries || copyParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for copy action.'
          );
        }

        for (const entry of copyParams.entries) {
          try {
            await fileSystemOps.copyPath(entry.source_path, entry.destination_path);

            results.push({
              status: 'success',
              action_performed: 'copy',
              source_path: entry.source_path,
              destination_path: entry.destination_path,
              message: 'Path copied.',
            });
          } catch (e) {
            const errorCode =
              e instanceof ConduitError ? e.errorCode : ErrorCode.ERR_FS_COPY_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('copy', errorCode, message, {
                source_path: entry.source_path,
                destination_path: entry.destination_path,
              })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
      }

      case 'move': {
        const moveParams = params as WriteTool.MoveParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!moveParams.entries || moveParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for move action.'
          );
        }

        for (const entry of moveParams.entries) {
          try {
            await fileSystemOps.movePath(entry.source_path, entry.destination_path);

            results.push({
              status: 'success',
              action_performed: 'move',
              source_path: entry.source_path,
              destination_path: entry.destination_path,
              message: 'Path moved.',
            });
          } catch (e) {
            const errorCode =
              e instanceof ConduitError ? e.errorCode : ErrorCode.ERR_FS_MOVE_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('move', errorCode, message, {
                source_path: entry.source_path,
                destination_path: entry.destination_path,
              })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
      }

      case 'delete': {
        const deleteParams = params as WriteTool.DeleteParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!deleteParams.entries || deleteParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for delete action.'
          );
        }

        for (const entry of deleteParams.entries) {
          try {
            await fileSystemOps.deletePath(entry.path, entry.recursive);

            results.push({
              status: 'success',
              action_performed: 'delete',
              path: entry.path,
              message: 'Path deleted.',
            });
          } catch (e) {
            const errorCode =
              e instanceof ConduitError ? e.errorCode : ErrorCode.ERR_FS_DELETE_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('delete', errorCode, message, { path: entry.path })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
      }

      case 'touch': {
        const touchParams = params as WriteTool.TouchParams;
        const results: WriteTool.WriteResultItem[] = [];

        if (!touchParams.entries || touchParams.entries.length === 0) {
          return createErrorResponse(
            ErrorCode.ERR_MISSING_ENTRIES_FOR_BATCH,
            'Entries array cannot be empty for touch action.'
          );
        }

        for (const entry of touchParams.entries) {
          try {
            await fileSystemOps.touchFile(entry.path);

            results.push({
              status: 'success',
              action_performed: 'touch',
              path: entry.path,
              message: 'File touched/created.',
            });
          } catch (e) {
            const errorCode = e instanceof ConduitError ? e.errorCode : ErrorCode.OPERATION_FAILED;
            const message = e instanceof Error ? e.message : String(e);

            results.push(
              createErrorWriteResultItem('touch', errorCode, message, { path: entry.path })
            );
          }
        }

        return {
          tool_name: 'write',
          results: results,
        };
      }

      case 'unarchive': {
        const writeToolUnarchiveParams = params as WriteTool.UnarchiveParams;

        const extractArchiveToolParams: ArchiveTool.ExtractArchiveParams = {
          operation: 'extract',
          archive_path: writeToolUnarchiveParams.archive_path,
          target_path: writeToolUnarchiveParams.destination_path,
          options: undefined,
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
