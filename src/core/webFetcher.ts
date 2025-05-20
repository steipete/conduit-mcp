import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { conduitConfig } from './configLoader';
import logger from '@/utils/logger';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';

const turndownService = new TurndownService();

export interface FetchedContent {
  content: Buffer;
  mimeType: string | undefined;
  httpStatus: number;
  headers: Record<string, string | string[] | undefined>;
  finalUrl: string;
}

/**
 * Fetches content from a URL.
 * @param urlString The URL to fetch.
 * @param isHeadRequest Whether to make a HEAD request (for metadata only).
 * @param range Optional byte range (e.g., "bytes=0-1023").
 * @returns Promise<FetchedContent>
 */
export async function fetchUrlContent(
  urlString: string,
  isHeadRequest: boolean = false,
  range?: string
): Promise<FetchedContent> {
  let url;
  try {
    url = new URL(urlString);
  } catch (e: any) {
    throw new ConduitError(ErrorCode.ERR_HTTP_INVALID_URL, `Invalid URL format: ${urlString}. ${e.message}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConduitError(ErrorCode.ERR_HTTP_INVALID_URL, `Unsupported URL protocol: ${url.protocol}. Only HTTP and HTTPS are supported.`);
  }

  const requestConfig: AxiosRequestConfig = {
    method: isHeadRequest ? 'HEAD' : 'GET',
    url: urlString,
    timeout: conduitConfig.httpTimeoutMs,
    responseType: 'arraybuffer', // Fetch as arraybuffer to handle all content types
    maxContentLength: conduitConfig.maxUrlDownloadBytes,
    // Follow redirects by default, up to axios' default (5)
    // headers: range ? { 'Range': range } : {},
  };
  if (range && !isHeadRequest) {
    requestConfig.headers = { ...requestConfig.headers, 'Range': range };
  }

  try {
    const response: AxiosResponse<Buffer> = await axios(requestConfig);
    
    // Axios follows redirects, response.request.res.responseUrl contains the final URL
    const finalUrl = response.request?.res?.responseUrl || urlString;

    return {
      content: response.data, // Buffer
      mimeType: response.headers['content-type']?.split(';')[0].trim(), // Get base MIME type
      httpStatus: response.status,
      headers: response.headers as Record<string, string | string[] | undefined>,
      finalUrl: finalUrl,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout')) {
        throw new ConduitError(ErrorCode.ERR_HTTP_TIMEOUT, `Request to ${urlString} timed out after ${conduitConfig.httpTimeoutMs}ms.`);
      }
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        const finalUrl = error.response.request?.res?.responseUrl || urlString;
        throw new ConduitError(
          ErrorCode.ERR_HTTP_STATUS_ERROR, 
          `Request to ${finalUrl} failed with HTTP status ${error.response.status}. Message: ${error.response.statusText}`,
        );
      } else if (error.request) {
        // The request was made but no response was received
        throw new ConduitError(ErrorCode.ERR_HTTP_REQUEST_FAILED, `No response received from ${urlString}. Error: ${error.message}`);
      }
    }
    // Something else happened in setting up the request that triggered an Error
    throw new ConduitError(ErrorCode.ERR_HTTP_REQUEST_FAILED, `Failed to fetch URL ${urlString}. Error: ${error.message}`);
  }
}

/**
 * Cleans HTML content and converts it to Markdown.
 * @param htmlContent The HTML content string.
 * @param pageUrl The original URL of the page (for Readability).
 * @returns Cleaned Markdown string.
 * @throws ConduitError if cleaning or conversion fails.
 */
export function cleanHtmlToMarkdown(htmlContent: string, pageUrl: string): string {
  try {
    const dom = new JSDOM(htmlContent, { url: pageUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new ConduitError(ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED, `Failed to extract main content using Readability from URL: ${pageUrl}.`);
    }

    // Additional cleaning: remove all script and style tags from the extracted content
    // as Readability might sometimes leave them if they are within the main content block.
    const contentDomInstance = new JSDOM(`<body>${article.content}</body>`);
    const documentBody = contentDomInstance.window.document.body;
    documentBody.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((el: InstanceType<typeof contentDomInstance.window.Element>) => el.remove());
    const cleanedHtml = documentBody.innerHTML;

    const markdown = turndownService.turndown(cleanedHtml);
    if (typeof markdown !== 'string' || markdown.trim() === '') {
        logger.warn(`Turndown conversion resulted in empty or non-string markdown for ${pageUrl}. Extracted title: ${article.title}`);
        // Do not throw error here, allow empty markdown if readability was successful but turndown produced nothing.
        // This might happen for pages that are essentially just images or have very little text content.
    }
    return markdown;
  } catch (error: any) {
    if (error instanceof ConduitError) throw error;
    logger.error(`Error during HTML to Markdown conversion for ${pageUrl}: ${error.message}`);
    throw new ConduitError(ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED, `Failed to convert HTML to Markdown for ${pageUrl}. Error: ${error.message}`);
  }
} 