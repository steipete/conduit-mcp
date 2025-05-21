import * as fs from 'fs/promises';
import { 
    ReadTool, 
    ConduitServerConfig, 
    ConduitError, 
    ErrorCode, 
    MCPErrorStatus, 
    logger, 
    calculateChecksum, 
    webFetcher, // Namespace for webFetcher functions and types
    fileSystemOps, // Namespace for fileSystemOps functions
    getMimeType, // Direct export (from core/mimeService via internal)
    imageProcessor // Namespace for imageProcessor functions and types
} from '@/internal';

interface BaseResultForError {
    source: string;
    source_type: 'file' | 'url';
    http_status_code?: number;
}

function createErrorContentResultItem(
    source: string, 
    source_type: 'file' | 'url', 
    errorCode: ErrorCode, 
    errorMessage: string,
    http_status_code?: number
): ReadTool.ContentResultItem {
    const errorResult: MCPErrorStatus & BaseResultForError = {
        source,
        source_type,
        status: 'error',
        error_code: errorCode,
        error_message: errorMessage,
    };
    if (http_status_code !== undefined) {
        errorResult.http_status_code = http_status_code;
    }
    return errorResult as ReadTool.ContentResultItem; 
}

export async function getContent(
  source: string,
  params: ReadTool.ContentParams, 
  config: ConduitServerConfig, 
): Promise<ReadTool.ContentResultItem> { 
  const operationLogger = logger.child({component: 'getContentOps'});
  operationLogger.debug(`Getting content for source: ${source} with params: ${JSON.stringify(params)}`);
  try {
    const isUrlSource = source.startsWith('http://') || source.startsWith('https://');
    if (isUrlSource) {
      return await getContentFromUrl(source, params, config);
    } else {
      return await getContentFromFile(source, params, config);
    }
  } catch (error) {
    operationLogger.error(`Error in getContent for source ${source}:`, error);
    const sourceType = source.startsWith('http') ? 'url' : 'file';
    if (error instanceof ConduitError) {
        return createErrorContentResultItem(source, sourceType, error.errorCode, error.message, (error as any).httpStatus);
    }
    return createErrorContentResultItem(source, sourceType, ErrorCode.ERR_INTERNAL_SERVER_ERROR, error instanceof Error ? error.message : 'An unexpected error occurred.');
  }
}

export async function getContentFromFile(
  filePath: string,
  params: ReadTool.ContentParams, 
  config: ConduitServerConfig, 
): Promise<ReadTool.ContentResultItem> { 
  const operationLogger = logger.child({component: 'getContentOps'});
  operationLogger.debug(`Getting content from file: ${filePath} with params: ${JSON.stringify(params)}`);
  
  try {
    const stats = await fileSystemOps.getStats(filePath); 

    if (stats.isDirectory()) {
      return createErrorContentResultItem(filePath, 'file', ErrorCode.ERR_FS_PATH_IS_DIR, `Source is a directory, not a file: ${filePath}`);
    }

    const detectedMimeType = await getMimeType(filePath);
    const format = params.format || 
                   (detectedMimeType?.startsWith('text/') || 
                    detectedMimeType === 'application/json' || 
                    detectedMimeType === 'application/xml' || 
                    detectedMimeType === 'application/javascript' || 
                    detectedMimeType === 'application/svg+xml' 
                    ? 'text' : 'base64');
    
    const offset = params.offset ?? 0;
    let length = params.length ?? -1;

    if (length !== -1 && offset + length > stats.size) {
        operationLogger.warn(`Requested range [${offset}-${offset+length-1}] for ${filePath} exceeds file size ${stats.size}. Adjusting length.`);
        length = stats.size - offset; 
        if (length < 0) length = 0; 
    }
    if (offset >= stats.size && stats.size > 0) { 
        const checksumData = format === 'checksum' ? {
            checksum: await calculateChecksum('', params.checksum_algorithm || config.defaultChecksumAlgorithm),
            checksum_algorithm_used: params.checksum_algorithm || config.defaultChecksumAlgorithm
        } : {};
        return {
            source: filePath,
            source_type: 'file',
            status: 'success',
            output_format_used: format as ReadTool.ContentFormat,
            content: format === 'text' ? '' : (format === 'checksum' ? undefined : Buffer.from('').toString('base64')),
            mime_type: detectedMimeType,
            size_bytes: 0,
            ...checksumData,
        } as ReadTool.ContentResultSuccess;
    }
    if (stats.size === 0) { 
        const checksumData = format === 'checksum' ? {
            checksum: await calculateChecksum('', params.checksum_algorithm || config.defaultChecksumAlgorithm),
            checksum_algorithm_used: params.checksum_algorithm || config.defaultChecksumAlgorithm
        } : {};
        return {
            source: filePath,
            source_type: 'file',
            status: 'success',
            output_format_used: format as ReadTool.ContentFormat,
            content: format === 'text' ? '' : (format === 'checksum' ? undefined : Buffer.from('').toString('base64')),
            mime_type: detectedMimeType,
            size_bytes: 0,
            ...checksumData,
        } as ReadTool.ContentResultSuccess;
    }

    let fileBuffer: Buffer;
    if (format === 'checksum' || format === 'markdown' || (offset === 0 && (length === -1 || length >= stats.size))) {
        if (stats.size > config.maxFileReadBytes) {
             throw new ConduitError(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, `File size ${stats.size} for ${filePath} exceeds max file read bytes ${config.maxFileReadBytes} for full read.`);
        }
        fileBuffer = await fileSystemOps.readFileAsBuffer(filePath, config.maxFileReadBytes);
        if ((offset > 0 || (length !== -1 && length < fileBuffer.length))) {
            const end = length === -1 ? fileBuffer.length : offset + length;
            fileBuffer = fileBuffer.subarray(offset, Math.min(end, fileBuffer.length));
        }
    } else {
        const fileHandle = await fs.open(filePath, 'r');
        try {
            const bytesToRead = length === -1 ? stats.size - offset : length;
            
            if (bytesToRead < 0) { 
                throw new ConduitError(ErrorCode.ERR_FS_READ_FAILED, `Internal inconsistency: Calculated bytesToRead is negative for ${filePath}.`);
            }
            if (bytesToRead > config.maxFileReadBytes) {
                throw new ConduitError(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, `Requested byte range length ${bytesToRead} for ${filePath} exceeds max file read bytes ${config.maxFileReadBytes}.`);
            }

            fileBuffer = Buffer.alloc(Math.max(0, bytesToRead));
            if (bytesToRead > 0) {
                const { bytesRead } = await fileHandle.read(fileBuffer, 0, bytesToRead, offset);
                if (bytesRead < bytesToRead) {
                    fileBuffer = fileBuffer.subarray(0, bytesRead); 
                }
            }
        } finally {
            await fileHandle.close();
        }
    }

    if (format === 'checksum') {
      const algo = params.checksum_algorithm || config.defaultChecksumAlgorithm;
      try {
        const checksum = await calculateChecksum(fileBuffer, algo as string);
        return {
          source: filePath,
          source_type: 'file',
          status: 'success',
          output_format_used: 'checksum',
          checksum: checksum,
          checksum_algorithm_used: algo,
          size_bytes: fileBuffer.length, 
          mime_type: detectedMimeType,
        } as ReadTool.ContentResultSuccess;
      } catch (checksumError: any) {
        operationLogger.error(`Checksum calculation failed for ${filePath}: ${checksumError.message}`);
        throw new ConduitError(ErrorCode.ERR_CHECKSUM_FAILED, `Checksum calculation failed for ${filePath}: ${checksumError.message || 'Unknown error'}`);
      }
    }

    const sourceMimeType = detectedMimeType;

    if (format === 'text') {
      if (sourceMimeType && !sourceMimeType.startsWith('text/') && sourceMimeType !== 'application/json' && sourceMimeType !== 'application/xml' && sourceMimeType !== 'application/javascript' && sourceMimeType !== 'application/svg+xml') {
        return {
          source: filePath,
          source_type: 'file',
          status: 'success',
          output_format_used: 'text',
          content: "[Binary content, request with format: 'base64' to view]",
          mime_type: sourceMimeType,
          size_bytes: fileBuffer.length,
        } as ReadTool.ContentResultSuccess;
      }
      const textContent = fileBuffer.toString('utf8');
      return {
        source: filePath,
        source_type: 'file',
        status: 'success',
        output_format_used: 'text',
        content: textContent,
        mime_type: sourceMimeType,
        size_bytes: fileBuffer.length,
      } as ReadTool.ContentResultSuccess;
    }

    if (format === 'base64') {
      let finalBuffer = fileBuffer;
      let compResult: imageProcessor.CompressionResult | undefined = undefined;
      if (sourceMimeType?.startsWith('image/')) {
        compResult = await imageProcessor.compressImageIfNecessary(fileBuffer, sourceMimeType);
        finalBuffer = compResult.buffer; 
      }
      const base64Content = finalBuffer.toString('base64');
      return {
        source: filePath,
        source_type: 'file',
        status: 'success',
        output_format_used: 'base64',
        content: base64Content,
        mime_type: sourceMimeType,
        size_bytes: finalBuffer.length,
        original_size_bytes: compResult?.original_size_bytes,
        compression_applied: compResult?.compression_applied,
        compression_error_note: compResult?.compression_error_note,
      } as ReadTool.ContentResultSuccess;
    }
    
    if (format === 'markdown') {
        const fileContentForMarkdown = fileBuffer.toString('utf8');
        if (sourceMimeType === 'text/html' || sourceMimeType === 'application/xhtml+xml') {
            try {
                const markdownContent = webFetcher.cleanHtmlToMarkdown(fileContentForMarkdown, `file://${filePath}`);
                return {
                    source: filePath,
                    source_type: 'file',
                    status: 'success',
                    output_format_used: 'markdown',
                    content: markdownContent,
                    mime_type: sourceMimeType, 
                    size_bytes: Buffer.byteLength(markdownContent, 'utf8'),
                    markdown_conversion_status: 'success',
                } as ReadTool.ContentResultSuccess;
            } catch (mdError: any) {
                operationLogger.warn(`Markdown conversion failed for local HTML file ${filePath}: ${mdError.message}`);
                const errorCode = (mdError instanceof ConduitError && 
                                   (mdError.errorCode === ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED || 
                                    mdError.errorCode === ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED)) 
                                  ? mdError.errorCode 
                                  : ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED;
                return createErrorContentResultItem(filePath, 'file', errorCode, `Markdown processing failed for ${filePath}: ${mdError.message}`);
            }
        } else {
            // Not HTML, so attempt to return as 'text' or indicate not convertible
            operationLogger.info(`Markdown format requested for non-HTML file ${filePath} (MIME: ${sourceMimeType}). Returning as text if possible.`);
            if (sourceMimeType && !sourceMimeType.startsWith('text/') && sourceMimeType !== 'application/json' && sourceMimeType !== 'application/xml' && sourceMimeType !== 'application/javascript' && sourceMimeType !== 'application/svg+xml') {
                 return {
                    source: filePath,
                    source_type: 'file',
                    status: 'success',
                    output_format_used: 'text', // Fallback to text
                    content: "[Binary content, cannot convert to Markdown. Request as base64 or original text format.]",
                    mime_type: sourceMimeType,
                    size_bytes: fileBuffer.length,
                    markdown_conversion_status: 'skipped_unsupported_content_type',
                    markdown_conversion_skipped_reason: `Content type ${sourceMimeType} is not HTML and not plain text based. Cannot convert to Markdown.`
                } as ReadTool.ContentResultSuccess;
            }
            return {
                source: filePath,
                source_type: 'file',
                status: 'success',
                output_format_used: 'text', // Fallback from Markdown for non-HTML text files
                content: fileContentForMarkdown,
                mime_type: sourceMimeType,
                size_bytes: fileBuffer.length,
                markdown_conversion_status: 'skipped_unsupported_content_type',
                markdown_conversion_skipped_reason: `Content type ${sourceMimeType} is not HTML. Returned as plain text.`
            } as ReadTool.ContentResultSuccess;
        }
    }

    // Should not be reached if format is one of the above
    operationLogger.error(`getContentFromFile: Unhandled format ${format} for ${filePath}`);
    return createErrorContentResultItem(filePath, 'file', ErrorCode.ERR_INVALID_PARAMETER, `Unsupported format specified: ${format}`);

  } catch (error: any) {
    operationLogger.error(`Error in getContentFromFile for ${filePath}:`, error);
    if (error instanceof ConduitError) {
      return createErrorContentResultItem(filePath, 'file', error.errorCode, error.message);
    }
    if (error.code === 'ENOENT') {
        return createErrorContentResultItem(filePath, 'file', ErrorCode.ERR_FS_NOT_FOUND, `File not found: ${filePath}`);
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
        return createErrorContentResultItem(filePath, 'file', ErrorCode.ERR_FS_ACCESS_DENIED, `Permission denied for file: ${filePath}`);
    }
    return createErrorContentResultItem(filePath, 'file', ErrorCode.ERR_FS_READ_FAILED, `Failed to read file ${filePath}: ${error.message || 'Unknown error'}`);
  }
}


async function getContentFromUrl(
  url: string,
  params: ReadTool.ContentParams, 
  config: ConduitServerConfig, 
): Promise<ReadTool.ContentResultItem> { 
  const operationLogger = logger.child({component: 'getContentOps'});
  operationLogger.info(`Attempting to get content from URL: ${url}`);
  let fetchedData: webFetcher.FetchedContent;
  try {
    // Construct Range header if offset or length is specified
    let rangeHeader: string | undefined = undefined;
    if (params.offset !== undefined || params.length !== undefined) {
        const startByte = params.offset || 0;
        // If length is specified, calculate endByte. Otherwise, server decides (or we rely on maxUrlDownloadBytes elsewhere)
        const endByte = params.length ? startByte + params.length - 1 : undefined;
        rangeHeader = `bytes=${startByte}-${endByte !== undefined ? endByte : ''}`;
    }
    
    fetchedData = await webFetcher.fetchUrlContent(url, false, rangeHeader);
    
    let rangeRequestStatus: ReadTool.ContentResultSuccess['range_request_status'] = undefined;
    if (rangeHeader) {
        if (fetchedData.httpStatus === 206) { // Partial Content
            rangeRequestStatus = 'native';
        } else if (fetchedData.httpStatus === 200) { // Full content returned despite range request
            rangeRequestStatus = 'full_content_returned'; 
        }
    }

    const sourceMimeType = fetchedData.mimeType || 'application/octet-stream';
    const actualFormat = params.format || 
                       (sourceMimeType.startsWith('text/') || 
                        sourceMimeType === 'application/json' || 
                        sourceMimeType === 'application/xml' || 
                        sourceMimeType === 'application/javascript' || 
                        sourceMimeType === 'application/svg+xml' 
                        ? 'text' : 'base64');
    
    let contentBuffer = fetchedData.content;
    let finalRangeStatus = rangeRequestStatus;

    // Simulate range if server returned full content or if no range was initially supported/requested for full checksum/markdown
    if (rangeRequestStatus === 'full_content_returned' || (rangeHeader && rangeRequestStatus !== 'native')) {
        const offset = params.offset || 0;
        let length = params.length;

        if (offset < contentBuffer.length) {
            const end = length !== undefined ? offset + length : contentBuffer.length;
            contentBuffer = contentBuffer.subarray(offset, Math.min(end, contentBuffer.length));
            finalRangeStatus = 'simulated';
        } else {
            contentBuffer = Buffer.alloc(0);
            finalRangeStatus = 'not_applicable_offset_oob';
        }
    } else if (!rangeHeader && (params.offset || params.length)) {
        if (actualFormat !== 'checksum' && actualFormat !== 'markdown') {
            const offset = params.offset || 0;
            let length = params.length;
            if (offset < contentBuffer.length) {
                const end = length !== undefined ? offset + length : contentBuffer.length;
                contentBuffer = contentBuffer.subarray(offset, Math.min(end, contentBuffer.length));
                finalRangeStatus = 'simulated';
            } else {
                contentBuffer = Buffer.alloc(0);
                finalRangeStatus = 'not_applicable_offset_oob';
            }
        }
    }

    if (actualFormat === 'checksum') {
      const algo = params.checksum_algorithm || config.defaultChecksumAlgorithm;
      try {
        const checksum = await calculateChecksum(contentBuffer, algo as string);
        return {
          source: fetchedData.finalUrl,
          source_type: 'url',
          status: 'success',
          output_format_used: 'checksum',
          checksum: checksum,
          checksum_algorithm_used: algo,
          size_bytes: contentBuffer.length,
          mime_type: sourceMimeType,
          http_status_code: fetchedData.httpStatus,
          range_request_status: finalRangeStatus,
        } as ReadTool.ContentResultSuccess;
      } catch (checksumError: any) {
        operationLogger.error(`Checksum calculation failed for URL ${url}: ${checksumError.message}`);
        const conduitChecksumError = new ConduitError(
            ErrorCode.ERR_CHECKSUM_FAILED, 
            `Checksum calculation failed for URL ${url}: ${checksumError.message || 'Unknown error'}`
        );
        (conduitChecksumError as any).httpStatus = fetchedData.httpStatus;
        throw conduitChecksumError;
      }
    }

    let markdownConversionStatus: ReadTool.ContentResultSuccess['markdown_conversion_status'] = undefined;
    let markdownSkippedReason: ReadTool.ContentResultSuccess['markdown_conversion_skipped_reason'] = undefined;

    if (actualFormat === 'text') {
      if (!sourceMimeType.startsWith('text/') && sourceMimeType !== 'application/json' && sourceMimeType !== 'application/xml' && sourceMimeType !== 'application/javascript' && sourceMimeType !== 'application/svg+xml') {
        return {
          source: fetchedData.finalUrl,
          source_type: 'url',
          status: 'success',
          output_format_used: 'text',
          content: "[Binary content, request with format: 'base64' to view]",
          mime_type: sourceMimeType,
          size_bytes: contentBuffer.length,
          http_status_code: fetchedData.httpStatus,
          range_request_status: finalRangeStatus,
        } as ReadTool.ContentResultSuccess;
      }
      const textContent = contentBuffer.toString('utf8');
      return {
        source: fetchedData.finalUrl,
        source_type: 'url',
        status: 'success',
        output_format_used: 'text',
        content: textContent,
        mime_type: sourceMimeType,
        size_bytes: contentBuffer.length,
        http_status_code: fetchedData.httpStatus,
        range_request_status: finalRangeStatus,
      } as ReadTool.ContentResultSuccess;
    }

    if (actualFormat === 'base64') {
      let bufferForBase64 = contentBuffer; 
      let compResult: imageProcessor.CompressionResult | undefined = undefined;
      let originalSizeForCompression = contentBuffer.length; 

      if (sourceMimeType.startsWith('image/')) {
        // If range was natively supported and applied by server, compress the partial data.
        // If range was simulated, or full content was returned, it implies we have the *full* image
        // segment that was requested (or full image). So, compression should be on that segment.
        // However, spec implies compression is on *original* full image. This needs clarification.
        // For now, if range is involved, compression quality might be impacted or less effective.
        // Let's assume compression is on the contentBuffer we have (which might be a segment).
        // OR, if spec wants full image compression then slice, we need original full fetchedData.content
        // This choice has implications if a small segment of a large image is requested.
        // Current: compress what we have in contentBuffer.
        // Alternative: if range was simulated, compress original fetchedData.content then slice again.
        // For simplicity and to avoid re-download or keeping full buffer if only segment needed for base64:
        // Compress the `contentBuffer` (which is already the correct segment).
        // The `original_size_bytes` for compression result should be this segment's size.
        
        if (finalRangeStatus === 'native') {
            // Server sent partial image data, compress this partial data
            compResult = await imageProcessor.compressImageIfNecessary(contentBuffer, sourceMimeType);
            bufferForBase64 = compResult.buffer;
        } else { 
            // Range was simulated OR full content was returned initially. 
            // This means `fetchedData.content` might be the full original image, and `contentBuffer` is the slice.
            // To follow spec logic of compressing *original* then potentially slicing for output:
            // We should compress the *original full* data, then slice IF the user wanted a slice AND base64.
            // This is tricky. If `maxUrlDownloadBytes` is small, `fetchedData.content` might already be truncated.
            
            // Simpler: just compress what `contentBuffer` currently holds (the correct segment for output)
            // The `original_size_bytes` in CompressionResult will refer to `contentBuffer.length` before this compression.
            // This means we are not re-compressing the *entire* original image from the server if only a slice is needed for base64 output.
            // This seems more logical if a slice was requested.
            const fullContentCompResult = await imageProcessor.compressImageIfNecessary(fetchedData.content, sourceMimeType);
            originalSizeForCompression = fetchedData.content.length; // original is the full fetched content

            if (fullContentCompResult.compression_applied) {
                 // Now we need to re-apply the range to the *compressed* full buffer if a range was requested
                const offset = params.offset || 0;
                let length = params.length;
                if (offset < fullContentCompResult.buffer.length) {
                    const end = length !== undefined ? offset + length : fullContentCompResult.buffer.length;
                    bufferForBase64 = fullContentCompResult.buffer.subarray(offset, Math.min(end, fullContentCompResult.buffer.length));
                    compResult = { // Construct a new CompressionResult for the slice of the compressed data
                        buffer: bufferForBase64,
                        original_size_bytes: originalSizeForCompression, // Original was the full image
                        compression_applied: true,
                        compression_error_note: fullContentCompResult.compression_error_note,
                    };
                } else {
                    bufferForBase64 = Buffer.alloc(0);
                     compResult = { buffer: bufferForBase64, original_size_bytes: originalSizeForCompression, compression_applied: true };
                }
            } else {
                // Full compression wasn't beneficial or failed, use original (sliced) contentBuffer
                bufferForBase64 = contentBuffer;
                compResult = { ...fullContentCompResult, buffer: bufferForBase64 }; // Reflect that this segment wasn't from compressed full
            }
        }
      }
      const base64Content = bufferForBase64.toString('base64');
      return {
        source: fetchedData.finalUrl,
        source_type: 'url',
        status: 'success',
        output_format_used: 'base64',
        content: base64Content,
        mime_type: sourceMimeType,
        size_bytes: bufferForBase64.length,
        original_size_bytes: compResult?.original_size_bytes, 
        compression_applied: compResult?.compression_applied,
        compression_error_note: compResult?.compression_error_note,
        http_status_code: fetchedData.httpStatus,
        range_request_status: finalRangeStatus,
      } as ReadTool.ContentResultSuccess;
    }

    if (actualFormat === 'markdown') {
        const htmlContent = contentBuffer.toString('utf8'); // Assume contentBuffer is the correct segment
        if (sourceMimeType === 'text/html' || sourceMimeType === 'application/xhtml+xml') {
            try {
                const markdownContent = webFetcher.cleanHtmlToMarkdown(htmlContent, fetchedData.finalUrl);
                markdownConversionStatus = 'success';
                return {
                    source: fetchedData.finalUrl,
                    source_type: 'url',
                    status: 'success',
                    output_format_used: 'markdown',
                    content: markdownContent,
                    mime_type: sourceMimeType,
                    size_bytes: Buffer.byteLength(markdownContent, 'utf8'),
                    http_status_code: fetchedData.httpStatus,
                    range_request_status: finalRangeStatus,
                    markdown_conversion_status: markdownConversionStatus,
                } as ReadTool.ContentResultSuccess;
            } catch (mdError: any) {
                operationLogger.warn(`Markdown conversion failed for URL ${fetchedData.finalUrl}: ${mdError.message}`);
                const errorCode = (mdError instanceof ConduitError && 
                                   (mdError.errorCode === ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED || 
                                    mdError.errorCode === ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED)) 
                                  ? mdError.errorCode 
                                  : ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED;
                return createErrorContentResultItem(fetchedData.finalUrl, 'url', errorCode, `Markdown processing failed for ${fetchedData.finalUrl}: ${mdError.message}`, fetchedData.httpStatus);
            }
        } else {
            markdownConversionStatus = 'skipped_unsupported_content_type';
            markdownSkippedReason = `Content type ${sourceMimeType} is not HTML. Cannot convert to Markdown.`;
            operationLogger.info(`Markdown format requested for non-HTML URL ${fetchedData.finalUrl} (MIME: ${sourceMimeType}). Cannot convert.`);
             return {
                source: fetchedData.finalUrl,
                source_type: 'url',
                status: 'success',
                output_format_used: 'text', // Fallback to text
                content: "[Non-HTML content, cannot convert to Markdown. Request as base64 or original text format.]",
                mime_type: sourceMimeType,
                size_bytes: contentBuffer.length,
                http_status_code: fetchedData.httpStatus,
                range_request_status: finalRangeStatus,
                markdown_conversion_status: markdownConversionStatus,
                markdown_conversion_skipped_reason: markdownSkippedReason
            } as ReadTool.ContentResultSuccess;
        }
    }
    
    operationLogger.error(`getContentFromUrl: Unhandled format ${actualFormat} for ${url}`);
    return createErrorContentResultItem(url, 'url', ErrorCode.ERR_INVALID_PARAMETER, `Unsupported format specified: ${actualFormat}`);

  } catch (error: any) {
    operationLogger.error(`Error in getContentFromUrl for ${url}:`, error);
    const httpStatus = error instanceof ConduitError ? (error as any).httpStatus : undefined;
    if (error instanceof ConduitError) {
      return createErrorContentResultItem(url, 'url', error.errorCode, error.message, httpStatus);
    }
    return createErrorContentResultItem(url, 'url', ErrorCode.ERR_HTTP_REQUEST_FAILED, `Failed to process URL ${url}: ${error.message || 'Unknown error'}`, httpStatus);
  }
}