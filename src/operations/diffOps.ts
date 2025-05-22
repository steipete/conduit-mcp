import {
  ReadTool,
  ConduitServerConfig,
  ConduitError,
  ErrorCode,
  MCPErrorStatus,
  /*readFileAsBuffer,*/ /*getStats,*/ getMimeType,
  fileSystemOps,
  logger,
  webFetcher,
} from '@/internal';
import * as diff from 'diff'; // Using the 'diff' library
// import logger from '@/utils/logger'; // Direct import

function createErrorDiffResultItem(
  // source1: string, // Removed
  // source2: string, // Removed
  errorCode: ErrorCode,
  errorMessage: string
): ReadTool.DiffResult {
  // Changed DiffResultItem to DiffResult
  const errorResult: MCPErrorStatus = {
    // No longer needs BaseResultForError fields
    status: 'error',
    error_code: errorCode,
    error_message: errorMessage,
  };
  // The cast might be problematic if DiffResultItem is more specific than MCPErrorStatus in some way
  // However, DiffResult in tools.ts is DiffResultSuccess | MCPErrorStatus, so this should be fine.
  return errorResult; // No cast needed as DiffResult is a union including MCPErrorStatus
}

async function readFileContentForDiff(
  filePath: string,
  config: ConduitServerConfig,
  operationLogger: import('pino').Logger
): Promise<string> {
  operationLogger.debug(`Reading file source for diff: ${filePath}`);
  const stats = await fileSystemOps.getStats(filePath);
  if (!stats || stats.isDirectory()) {
    throw new ConduitError(
      ErrorCode.ERR_FS_PATH_IS_FILE,
      `Source is not a file or does not exist: ${filePath}`
    ); // Corrected ErrorCode
  }
  const mimeType = await getMimeType(filePath);
  // Allow common text-based formats for diffing
  // Added 'application/octet-stream' as a fallback if mime type detection is generic for text-like files without specific extensions.
  if (
    mimeType &&
    !mimeType.startsWith('text/') &&
    !mimeType.includes('json') &&
    !mimeType.includes('xml') &&
    !mimeType.includes('script') &&
    mimeType !== 'application/octet-stream'
  ) {
    throw new ConduitError(
      ErrorCode.ERR_UNSUPPORTED_MIME_TYPE,
      `Source is not a text-based file: ${filePath} (MIME: ${mimeType})`
    ); // Corrected ErrorCode (ERR_UNSUPPORTED_CONTENT_TYPE -> ERR_UNSUPPORTED_MIME_TYPE)
  }
  const bufferContent = await fileSystemOps.readFileAsBuffer(filePath, config.maxFileReadBytes); // Corrected config property
  return bufferContent.toString('utf8');
}

async function readUrlContentForDiff(
  urlString: string,
  config: ConduitServerConfig,
  operationLogger: import('pino').Logger
): Promise<string> {
  operationLogger.debug(`Reading URL source for diff: ${urlString}`);
  const webContent = await webFetcher.fetchUrlContent(
    urlString,
    false,
    undefined,
    config.maxUrlDownloadSizeBytes // Corrected config property
  );
  // fetchUrlContent now throws ConduitError on HTTP/network issues or returns FetchedContent with potential content:null
  // It no longer has an 'error' property in the success return object.
  if (webContent.content === null || webContent.content === undefined) {
    // Check for null or undefined explicitly
    // This case should ideally be an error thrown by fetchUrlContent if the status was not 2xx or content is truly empty when expected.
    // Assuming fetchUrlContent throws for non-2xx, this handles cases where 2xx was received but content is empty.
    throw new ConduitError(
      ErrorCode.ERR_HTTP_EMPTY_RESPONSE,
      `Empty content from URL: ${urlString}`
    );
  }
  // For URLs, we assume text content for diff. Further MIME type checks could be added if needed.
  return webContent.content.toString('utf8');
}

export async function getDiff(
  params: ReadTool.DiffParams,
  config: ConduitServerConfig
): Promise<ReadTool.DiffResult> {
  // Changed DiffResultItem to DiffResult
  const operationLogger = logger.child({ component: 'diffOps' });
  operationLogger.info(
    `Performing diff for sources: ${params.sources[0]} and ${params.sources[1]}`
  );
  const [source1PathOrUrl, source2PathOrUrl] = params.sources;

  try {
    let strContent1: string;
    let strContent2: string;

    const isUrl1 =
      source1PathOrUrl.startsWith('http://') || source1PathOrUrl.startsWith('https://');
    const isUrl2 =
      source2PathOrUrl.startsWith('http://') || source2PathOrUrl.startsWith('https://');

    if (isUrl1) {
      strContent1 = await readUrlContentForDiff(source1PathOrUrl, config, operationLogger);
    } else {
      strContent1 = await readFileContentForDiff(source1PathOrUrl, config, operationLogger);
    }

    if (isUrl2) {
      strContent2 = await readUrlContentForDiff(source2PathOrUrl, config, operationLogger);
    } else {
      strContent2 = await readFileContentForDiff(source2PathOrUrl, config, operationLogger);
    }

    // Perform diff
    const diffOutput = diff.createTwoFilesPatch(
      source1PathOrUrl,
      source2PathOrUrl,
      strContent1,
      strContent2,
      '',
      '',
      { context: 3 }
    );

    return {
      sources_compared: [source1PathOrUrl, source2PathOrUrl],
      status: 'success',
      diff_format_used: 'unified',
      diff_content: diffOutput,
    } as ReadTool.DiffResultSuccess;
  } catch (error: unknown) {
    operationLogger.error(
      `Error in getDiff for ${source1PathOrUrl} vs ${source2PathOrUrl}:`,
      error
    );
    if (error instanceof ConduitError) {
      // ConduitError constructor is (errorCode, message). HTTP status is not part of its general signature.
      // If fetchUrlContent throws a ConduitError with HTTP status, it needs to be handled or stored differently.
      // For now, just pass errorCode and message.
      return createErrorDiffResultItem(error.errorCode, error.message);
    }
    // Fallback for unexpected errors
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred during diff operation.';
    return createErrorDiffResultItem(ErrorCode.ERR_INTERNAL_SERVER_ERROR, errorMessage);
  }
}
