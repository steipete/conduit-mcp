import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import {
  ConduitError,
  ErrorCode,
  FetchedContent,
  conduitConfig,
  logger,
  RangeRequestStatus,
} from '@/internal';

const operationLogger = logger.child({ component: 'webFetcher' });

export async function fetchUrlContent(
  urlString: string,
  isMetadataRequest: boolean = false, // If true, only fetches headers (HEAD request)
  range?: { offset: number; length: number },
  maxBytes: number = conduitConfig.maxUrlDownloadSizeBytes
): Promise<FetchedContent> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(urlString);
  } catch (e) {
    operationLogger.error(`Invalid URL string: ${urlString}`, e);
    throw new ConduitError(ErrorCode.ERR_HTTP_INVALID_URL, `Invalid URL: ${urlString}`);
  }

  const axiosConfig: AxiosRequestConfig = {
    timeout: conduitConfig.httpTimeoutMs,
    responseType: isMetadataRequest ? 'stream' : 'arraybuffer', // stream for HEAD to close quick, arraybuffer for GET
    maxRedirects: 5,
    headers: {
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': `ConduitMCP/${conduitConfig.serverVersion || '1.0.0'}`, // Use actual server version
    },
    maxContentLength: -1, // We will handle maxBytes manually with a stream if needed
  };

  if (range && !isMetadataRequest) {
    axiosConfig.headers!['Range'] = `bytes=${range.offset}-${range.offset + range.length - 1}`;
  }

  let response: AxiosResponse<any>;
  try {
    operationLogger.debug(
      `Fetching URL (${isMetadataRequest ? 'HEAD' : 'GET'}): ${requestUrl.href}`
    );
    response = await axios({
      ...axiosConfig,
      method: isMetadataRequest ? 'HEAD' : 'GET',
      url: requestUrl.href,
      // Add a transformResponse to intercept the stream for byte counting for GET requests
      // This is tricky with arraybuffer directly. If responseType is 'stream', we can pipe it.
      // For now, rely on Axios behavior with arraybuffer and check length later, or switch to stream and buffer it with limit.
    });

    if (isMetadataRequest && response.request?.socket) {
      response.request.socket.destroy(); // Ensure connection for HEAD is closed quickly
    }
  } catch (error: any) {
    operationLogger.error(`Axios error fetching ${urlString}: ${error.message}`);
    if (isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new ConduitError(ErrorCode.ERR_HTTP_TIMEOUT, `Request to ${urlString} timed out.`);
      }
      if (error.response) {
        throw new ConduitError(
          ErrorCode.ERR_HTTP_STATUS_ERROR,
          `HTTP Error ${error.response.status} for ${urlString}: ${error.response.statusText}`
        );
      }
      throw new ConduitError(
        ErrorCode.ERR_HTTP_REQUEST_FAILED,
        `Request to ${urlString} failed: ${error.message}`
      );
    }
    throw new ConduitError(
      ErrorCode.ERR_HTTP_REQUEST_FAILED,
      `Unexpected error fetching ${urlString}: ${error.message}`
    );
  }

  const finalUrl = response.request?.res?.responseUrl || response.config.url || urlString;
  const httpStatus = response.status;
  const responseHeaders = response.headers as Record<string, string | string[] | undefined>; // AxiosHeaders can be complex
  const contentTypeHeader = responseHeaders['content-type'] || '';
  const mimeType =
    typeof contentTypeHeader === 'string' ? contentTypeHeader.split(';')[0].trim() : '';

  let contentBuffer: Buffer | null = null;
  let actualSizeBytes = 0;
  let rangeStatus: RangeRequestStatus | undefined = undefined;

  if (!isMetadataRequest && response.data) {
    if (!(response.data instanceof Buffer)) {
      // This shouldn't happen with responseType: 'arraybuffer', but as a safeguard
      contentBuffer = Buffer.from(response.data.toString());
    } else {
      contentBuffer = response.data as Buffer;
    }
    actualSizeBytes = contentBuffer.length;

    if (actualSizeBytes > maxBytes) {
      operationLogger.warn(
        `URL content from ${finalUrl} exceeded maxBytes (${actualSizeBytes} > ${maxBytes}). Truncating.`
      );
      contentBuffer = contentBuffer.subarray(0, maxBytes);
      actualSizeBytes = contentBuffer.length;
      // Note: This is post-hoc truncation. True streaming limit is more complex with Axios unless using responseType: 'stream'.
      // Consider this a functional limit for now.
      // Also, if this happens, range_request_status needs to reflect that we might not have the full requested range if range was used.
      // This interaction is complex.
    }

    if (range) {
      if (httpStatus === 206) {
        rangeStatus = 'native';
      } else if (httpStatus === 200) {
        // Server sent full content, we might need to simulate the range if our post-hoc truncation didn't already do it.
        // This part is tricky. If server ignored Range and sent 200 OK, we have full content (or truncated by maxBytes).
        // The contentBuffer is already potentially truncated by maxBytes.
        // If original range.offset + range.length is within contentBuffer, it was effectively simulated.
        // This needs more precise logic if we want to slice here based on original range params.
        // For now, if it's 200 and range was requested, mark as 'full_content_returned' (and client might slice).
        // Or, if we *do* slice it here based on original range, it's 'simulated'.
        // Let's assume for now client handles slicing if 200 is received for a range req.
        rangeStatus = 'full_content_returned'; // Simplification for now
      } else {
        rangeStatus = 'not_supported';
      }
    } else {
      rangeStatus = 'not_applicable_offset_oob'; // Or just undefined if no range was requested
    }
  }

  return {
    finalUrl,
    httpStatus,
    headers: responseHeaders,
    mimeType: mimeType || undefined,
    content: contentBuffer,
    size_bytes: actualSizeBytes,
    range_request_status: rangeStatus,
  };
}

export function cleanHtmlToMarkdown(html: string, baseUrl?: string): string {
  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    operationLogger.warn('Attempted to clean empty or invalid HTML string.');
    return ''; // Return empty for empty input
  }
  const dom = new JSDOM(html, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    operationLogger.error('Readability failed to extract main content from HTML.');
    throw new ConduitError(
      ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED,
      'Failed to extract readable content from HTML.'
    );
  }

  const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  // Add any custom Turndown rules if needed, e.g., for tables, specific tags.
  const markdown = turndownService.turndown(article.content);
  return markdown;
}
