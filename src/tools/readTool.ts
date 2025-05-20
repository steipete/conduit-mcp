import { conduitConfig } from '@/core/configLoader';
import { validateAndResolvePath } from '@/core/securityHandler';
import * as fsOps from '@/core/fileSystemOps';
import { fetchUrlContent, cleanHtmlToMarkdown, FetchedContent } from '@/core/webFetcher';
import { compressImageIfNecessary, CompressionResult } from '@/core/imageProcessor';
import { getMimeType as getLocalMimeType } from '@/core/mimeService';
import { ReadTool } from '@/types/tools';
import { ConduitError, ErrorCode, createMCPErrorStatus } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import { MCPErrorStatus, EntryInfo } from '@/types/common'; // Added EntryInfo
import * as crypto from 'crypto';
import * as diff from 'diff';
import path from 'path';
import { formatToISO8601UTC } from '@/utils/dateTime';

const BINARY_PLACEHOLDER = "[Binary content, request with format: 'base64' to view]";

function isUrl(source: string): boolean {
  try {
    new URL(source);
    return true;
  } catch (_) {
    return false;
  }
}

async function handleContentOperation(params: ReadTool.ContentParams): Promise<ReadTool.ContentResultItem[]> {
  const results: ReadTool.ContentResultItem[] = [];

  for (const source of params.sources) {
    const baseResultInfo = {
      source,
      source_type: isUrl(source) ? 'url' : 'file',
    } as const;

    try {
      let outputFormatUsed: ReadTool.ContentFormat | 'text' = params.format || 'text';
      let content: string | undefined = undefined;
      let mimeType: string | undefined = undefined;
      let sizeBytes: number | undefined = undefined;
      let originalSizeBytesForImageCompression: number | undefined = undefined;
      let compressionApplied: boolean | undefined = undefined;
      let compressionErrorNote: string | undefined = undefined;
      let checksum: string | undefined = undefined;
      let checksumAlgorithmUsed: ReadTool.ChecksumAlgorithm | string | undefined = params.checksum_algorithm || conduitConfig.defaultChecksumAlgorithm;
      let rangeRequestStatus: ReadTool.ContentResultSuccess['range_request_status'] = undefined;
      let markdownConversionStatus: ReadTool.ContentResultSuccess['markdown_conversion_status'] = undefined;
      let markdownConversionSkippedReason: string | undefined = undefined;

      let rawFileBuffer: Buffer;
      let resolvedPath: string | undefined;
      let fetchedUrlData: FetchedContent | undefined;

      const effectiveOffset = params.offset || 0;
      if (effectiveOffset < 0) throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Offset cannot be negative.");
      let effectiveLength = params.length;
      if (effectiveLength !== undefined && effectiveLength !== -1 && effectiveLength < 0) {
         throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Length cannot be negative (unless -1 for 'to end').");
      }
      const isRangeRequested = params.offset !== undefined || params.length !== undefined;

      if (baseResultInfo.source_type === 'file') {
        resolvedPath = await validateAndResolvePath(source);
        rawFileBuffer = await fsOps.readFileAsBuffer(resolvedPath, conduitConfig.maxFileReadBytes); // Read full buffer first
        mimeType = await getLocalMimeType(resolvedPath) || 'application/octet-stream';

        // Apply offset/length for files
        if (isRangeRequested) {
            if (effectiveOffset >= rawFileBuffer.length) {
                rawFileBuffer = Buffer.alloc(0); // Offset is beyond file length
            } else {
                const end = (effectiveLength === undefined || effectiveLength === -1) ? rawFileBuffer.length : Math.min(rawFileBuffer.length, effectiveOffset + effectiveLength);
                rawFileBuffer = rawFileBuffer.subarray(effectiveOffset, end);
            }
        }
      } else { // URL
        let byteRangeString: string | undefined = undefined;
        if (isRangeRequested) {
            const endByte = (effectiveLength !== undefined && effectiveLength !== -1) ? (effectiveOffset + effectiveLength - 1) : '';
            byteRangeString = `bytes=${effectiveOffset}-${endByte}`;
        }

        fetchedUrlData = await fetchUrlContent(source, false, byteRangeString);
        rawFileBuffer = fetchedUrlData.content; // This is what server sent (could be partial or full)
        mimeType = fetchedUrlData.mimeType || 'application/octet-stream';

        if (byteRangeString) { // A range was explicitly requested via offset/length
          if (fetchedUrlData.httpStatus === 206) {
            rangeRequestStatus = 'native';
            // rawFileBuffer is already the partial content from server
          } else if (fetchedUrlData.httpStatus === 416) {
            rangeRequestStatus = 'not_supported';
            throw new ConduitError(ErrorCode.ERR_HTTP_RANGE_NOT_SATISFIABLE, `HTTP Range Not Satisfiable (416) for ${source} with range ${byteRangeString}`);
          } else if (fetchedUrlData.httpStatus >= 200 && fetchedUrlData.httpStatus < 300) {
            // Server sent some content (likely 200 OK with full body), but not 206.
            // We must slice it to the requested range.
            rangeRequestStatus = 'simulated';
            if (effectiveOffset >= rawFileBuffer.length) {
                rawFileBuffer = Buffer.alloc(0);
            } else {
                const end = (effectiveLength === undefined || effectiveLength === -1) ? rawFileBuffer.length : Math.min(rawFileBuffer.length, effectiveOffset + (effectiveLength || 0)); // Ensure length is number
                rawFileBuffer = rawFileBuffer.subarray(effectiveOffset, end);
            }
          } else {
            // Other HTTP error, fetchUrlContent should have thrown, but as a fallback:
            rangeRequestStatus = 'not_supported'; // Or some other error status
             throw new ConduitError(ErrorCode.ERR_HTTP_STATUS_ERROR, `Unexpected HTTP status ${fetchedUrlData.httpStatus} when requesting range for ${source}`);
          }
        } else {
            // No range explicitly requested via offset/length for URL
            // rangeRequestStatus remains undefined
        }
      }
      
      // Determine actual output format if it was not specified by the user
      if (!params.format) {
        if (mimeType && (mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript', 'application/svg+xml'].includes(mimeType))) {
          outputFormatUsed = 'text';
        } else if (mimeType && mimeType.startsWith('image/')) {
          outputFormatUsed = 'base64'; // Default to base64 for images if format not specified
        } else {
          outputFormatUsed = baseResultInfo.source_type === 'file' ? 'base64' : 'text'; // Default for other file types to base64, other URL types to text
        }
      }

      // Process the (potentially sliced) rawFileBuffer based on outputFormatUsed
      if (outputFormatUsed === 'checksum' || params.format === 'checksum') {
        outputFormatUsed = 'checksum';
        const algo = (checksumAlgorithmUsed || conduitConfig.defaultChecksumAlgorithm).toLowerCase();
        if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo)) {
          throw new ConduitError(ErrorCode.ERR_UNSUPPORTED_CHECKSUM_ALGORITHM, `Unsupported checksum algorithm: ${algo}. Supported: md5, sha1, sha256, sha512.`);
        }
        checksum = crypto.createHash(algo).update(rawFileBuffer).digest('hex');
        checksumAlgorithmUsed = algo as ReadTool.ChecksumAlgorithm;
        sizeBytes = rawFileBuffer.length; 
        content = checksum;
      } else if (outputFormatUsed === 'text' || params.format === 'text') {
        outputFormatUsed = 'text';
        if (mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript', 'application/svg+xml'].includes(mimeType)) {
          content = rawFileBuffer.toString('utf8');
        } else {
          content = BINARY_PLACEHOLDER;
        }
        sizeBytes = content.length;
      } else if (outputFormatUsed === 'base64' || params.format === 'base64') {
        outputFormatUsed = 'base64';
        let bufferToEncode = rawFileBuffer;
        if (mimeType.startsWith('image/')) {
          const compression: CompressionResult = await compressImageIfNecessary(rawFileBuffer, mimeType);
          bufferToEncode = compression.buffer;
          originalSizeBytesForImageCompression = compression.original_size_bytes;
          compressionApplied = compression.compression_applied;
          compressionErrorNote = compression.compression_error_note;
        }
        content = bufferToEncode.toString('base64');
        sizeBytes = content.length;
      } else if (outputFormatUsed === 'markdown' || params.format === 'markdown') {
        outputFormatUsed = 'markdown';
        if (mimeType.startsWith('text/html')) {
          const htmlContent = rawFileBuffer.toString('utf8');
          content = cleanHtmlToMarkdown(htmlContent, source);
          markdownConversionStatus = 'success';
        } else {
          outputFormatUsed = 'text'; 
          markdownConversionStatus = 'skipped_unsupported_content_type';
          markdownConversionSkippedReason = `Original Content-Type '${mimeType}' is not suitable for Markdown conversion; returning raw content.`;
          if (mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript', 'application/svg+xml'].includes(mimeType)) {
            content = rawFileBuffer.toString('utf8');
          } else {
            content = BINARY_PLACEHOLDER;
          }
        }
        sizeBytes = content?.length || 0;
      }

      results.push({
        status: 'success',
        ...baseResultInfo,
        output_format_used: outputFormatUsed,
        content,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        original_size_bytes: originalSizeBytesForImageCompression,
        compression_applied: compressionApplied,
        compression_error_note: compressionErrorNote,
        checksum,
        checksum_algorithm_used: checksumAlgorithmUsed,
        range_request_status: rangeRequestStatus, 
        markdown_conversion_status: markdownConversionStatus,
        markdown_conversion_skipped_reason: markdownConversionSkippedReason,
      });

    } catch (error: any) {
      logger.error(`Read content failed for source ${source}: ${error.message}`);
      results.push({
        ...baseResultInfo,
        ...(error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, error.message))
      } as ReadTool.ContentResultItem);
    }
  }
  return results;
}

async function handleMetadataOperation(params: ReadTool.MetadataParams): Promise<ReadTool.MetadataResultItem[]> {
  const results: ReadTool.MetadataResultItem[] = [];
  for (const source of params.sources) {
    const baseResultInfo = {
      source,
      source_type: isUrl(source) ? 'url' : 'file',
    } as const;
    try {
      if (baseResultInfo.source_type === 'file') {
        const resolvedPath = await validateAndResolvePath(source);
        const stats = await fsOps.getStats(resolvedPath);
        const fileEntryInfo = await fsOps.createEntryInfo(resolvedPath, stats);
        results.push({
          status: 'success',
          ...baseResultInfo,
          metadata: {
            name: fileEntryInfo.name,
            entry_type: stats.isDirectory() ? 'directory' : 'file',
            size_bytes: fileEntryInfo.size_bytes,
            mime_type: fileEntryInfo.mime_type,
            created_at_iso: fileEntryInfo.created_at_iso,
            modified_at_iso: fileEntryInfo.modified_at_iso,
            permissions_octal: fileEntryInfo.permissions_octal,
            permissions_string: fileEntryInfo.permissions_string,
          }
        });
      } else { // URL
        const fetchedData = await fetchUrlContent(source, true); // HEAD request for metadata
        let sizeFromHeader: number | undefined = undefined;
        const contentLengthHeader = fetchedData.headers['content-length'];
        if(contentLengthHeader && typeof contentLengthHeader === 'string') {
            const parsedSize = parseInt(contentLengthHeader, 10);
            if(!isNaN(parsedSize)) sizeFromHeader = parsedSize;
        }

        results.push({
          status: 'success',
          ...baseResultInfo,
          http_status_code: fetchedData.httpStatus,
          metadata: {
            name: path.basename(new URL(fetchedData.finalUrl).pathname) || fetchedData.finalUrl,
            entry_type: 'url',
            size_bytes: sizeFromHeader,
            mime_type: fetchedData.mimeType,
            modified_at_iso: fetchedData.headers['last-modified'] ? formatToISO8601UTC(fetchedData.headers['last-modified' ] as string) : undefined,
            created_at_iso: undefined, // Not typically available from HTTP headers
            permissions_octal: undefined,
            permissions_string: undefined,
            http_headers: fetchedData.headers,
          }
        });
      }
    } catch (error: any) {
      logger.error(`Read metadata failed for source ${source}: ${error.message}`);
      results.push({
        ...baseResultInfo,
        ...(error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_INTERNAL_SERVER_ERROR, error.message))
      } as ReadTool.MetadataResultItem);
    }
  }
  return results;
}

async function handleDiffOperation(params: ReadTool.DiffParams): Promise<ReadTool.DiffResponse> {
  try {
    if (params.sources.length !== 2) {
      throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, 'Diff operation requires exactly two source file paths.');
    }
    const [source1, source2] = params.sources;
    if (isUrl(source1) || isUrl(source2)) {
      throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, 'Diff operation only supports local files, not URLs.');
    }

    const resolvedPath1 = await validateAndResolvePath(source1);
    const resolvedPath2 = await validateAndResolvePath(source2);

    const content1 = await fsOps.readFileAsString(resolvedPath1);
    const content2 = await fsOps.readFileAsString(resolvedPath2);

    const diffFormat = params.diff_format || 'unified';
    if (diffFormat !== 'unified') {
      throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, `Unsupported diff format: ${diffFormat}. Only 'unified' is supported.`);
    }

    const diffResult = diff.createPatch(path.basename(resolvedPath1), content1, content2, '', '', { context: 3 });
    
    return {
      status: 'success',
      sources_compared: [resolvedPath1, resolvedPath2],
      diff_format_used: diffFormat,
      diff_content: diffResult,
    } as ReadTool.DiffResultSuccess; 

  } catch (error: any) {
    logger.error(`Read diff failed: ${error.message}`);
    return (error instanceof ConduitError ? error.MCPPErrorStatus : createMCPErrorStatus(ErrorCode.ERR_DIFF_FAILED, error.message));
  }
}

export async function handleReadTool(params: ReadTool.Parameters): Promise<ReadTool.ContentResponse | ReadTool.MetadataResponse | ReadTool.DiffResponse> {
  if (!params || !params.operation) {
    throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing 'operation' parameter for read tool.");
  }

  switch (params.operation) {
    case 'content':
      if (!params.sources || params.sources.length === 0) {
        throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'sources' parameter for read.content operation.");
      }
      return handleContentOperation(params as ReadTool.ContentParams);
    case 'metadata':
      if (!params.sources || params.sources.length === 0) {
        throw new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, "Missing or empty 'sources' parameter for read.metadata operation.");
      }
      return handleMetadataOperation(params as ReadTool.MetadataParams);
    case 'diff':
      return handleDiffOperation(params as ReadTool.DiffParams);
    default:
      // @ts-expect-error 
      throw new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION, `Unknown operation '${params.operation}' for read tool.`);
  }
} 