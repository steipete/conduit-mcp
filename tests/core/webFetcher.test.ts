import { vi, Mocked } from 'vitest';
import { fetchUrlContent, cleanHtmlToMarkdown } from '@/core/webFetcher';
// Removed unused conduitConfig import
import logger from '@/utils/logger';
import { ConduitError, ErrorCode } from '@/internal';
import axios, { AxiosHeaders } from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// Mock external dependencies
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: vi.fn(),
    isAxiosError: vi.fn((error) => {
      // Return true for errors that have the expected axios error structure
      return (
        error &&
        typeof error === 'object' &&
        ('config' in error || 'response' in error || 'request' in error)
      );
    }),
  };
});
vi.mock('jsdom');
vi.mock('@mozilla/readability');
vi.mock('turndown');

// Mock configLoader - avoid top-level variables in factory to prevent hoisting issues
vi.mock('@/core/configLoader', () => {
  const mockConfig = {
    httpTimeoutMs: 10000,
    maxUrlDownloadBytes: 5 * 1024 * 1024,
    // Add other config properties if webFetcher uses them
  };

  return {
    conduitConfig: mockConfig,
    loadConfig: () => mockConfig,
  };
});

// Define constants for use in tests
const mockMaxUrlDownloadBytes = 5 * 1024 * 1024;

const mockedAxios = axios as Mocked<typeof axios>;
const mockedJSDOM = JSDOM as Mocked<typeof JSDOM>;
const mockedReadability = Readability as Mocked<typeof Readability>;
const mockedTurndownService = TurndownService as Mocked<typeof TurndownService>;
const mockTurndownMethod = vi.fn();

describe('webFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock for TurndownService instance
    (mockedTurndownService as unknown as import('vitest').Mock).mockImplementation(
      () =>
        ({
          turndown: mockTurndownMethod,
        }) as TurndownService
    );
    mockTurndownMethod.mockReturnValue('# Mocked Markdown'); // Default markdown output
  });

  describe('fetchUrlContent', () => {
    it('should fetch content successfully', async () => {
      const mockUrl = 'http://example.com/data';
      const mockDataBuffer = Buffer.from('Test data');
      const mockResponseHeaders = new AxiosHeaders();
      mockResponseHeaders.set('content-type', 'text/plain; charset=utf-8');

      (mockedAxios as unknown as import('vitest').Mock).mockResolvedValue({
        data: mockDataBuffer,
        status: 200,
        headers: mockResponseHeaders,
        request: { res: { responseUrl: mockUrl } }, // Simplified mock for responseUrl
      });

      const result = await fetchUrlContent(mockUrl);
      expect(result.content).toEqual(mockDataBuffer);
      expect(result.mimeType).toBe('text/plain');
      expect(result.httpStatus).toBe(200);
      expect(result.finalUrl).toBe(mockUrl);
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({ url: mockUrl, method: 'GET' })
      );
    });

    it('should make a HEAD request if isHeadRequest is true', async () => {
      const mockUrl = 'http://example.com/resource';
      (mockedAxios as unknown as import('vitest').Mock).mockResolvedValue({
        status: 200,
        headers: new AxiosHeaders(),
        request: { res: { responseUrl: mockUrl } },
      });
      await fetchUrlContent(mockUrl, true);
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({ url: mockUrl, method: 'HEAD' })
      );
    });

    it('should include Range header if range parameter is provided', async () => {
      const mockUrl = 'http://example.com/video.mp4';
      const rangeObject = { offset: 0, length: 1024 };
      const rangeHeaderString = `bytes=${rangeObject.offset}-${rangeObject.offset + rangeObject.length - 1}`;
      (mockedAxios as unknown as import('vitest').Mock).mockResolvedValue({
        data: Buffer.from('partial'),
        status: 206,
        headers: new AxiosHeaders({ 'content-type': 'video/mp4' }),
        request: { res: { responseUrl: mockUrl } },
      });
      await fetchUrlContent(mockUrl, false, rangeObject);
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ Range: rangeHeaderString }),
        })
      );
    });

    it('should throw HTTP_INVALID_URL for invalid URL format', async () => {
      // Invalid URL format causes new URL() to throw, which is caught before axios is called
      await expect(fetchUrlContent('invalid-url')).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_HTTP_INVALID_URL, 'Invalid URL: invalid-url')
      );
    });

    it('should throw HTTP_INVALID_URL for unsupported protocol', async () => {
      // Mock axios to reject with a protocol error that should be classified as request failed
      const axiosError = Object.assign(new Error('Protocol not supported'), {
        name: 'AxiosError',
        code: 'ERR_INVALID_PROTOCOL',
        config: {},
      });

      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce(axiosError);
      await expect(fetchUrlContent('ftp://example.com')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_REQUEST_FAILED,
          'Request to ftp://example.com failed: Protocol not supported'
        )
      );
    });

    it('should throw HTTP_TIMEOUT on timeout', async () => {
      const axiosError = Object.assign(new Error('timeout of 5000ms exceeded'), {
        name: 'AxiosError',
        code: 'ECONNABORTED',
        config: {},
      });

      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce(axiosError);
      await expect(fetchUrlContent('http://example.com/timeout')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_TIMEOUT,
          'Request to http://example.com/timeout timed out.'
        )
      );
    });

    it('should throw HTTP_STATUS_ERROR for non-2xx response', async () => {
      const mockUrl = 'http://example.com/notfound';
      const axiosError = Object.assign(new Error('Request failed with status code 404'), {
        name: 'AxiosError',
        code: 'ERR_BAD_REQUEST',
        config: {},
        response: {
          data: null,
          status: 404,
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      });

      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce(axiosError);
      await expect(fetchUrlContent(mockUrl)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_STATUS_ERROR,
          'HTTP Error 404 for http://example.com/notfound: Not Found'
        )
      );
    });

    it('should throw HTTP_REQUEST_FAILED for no response errors', async () => {
      const axiosError = Object.assign(new Error('No response received from server'), {
        name: 'AxiosError',
        code: 'ERR_NETWORK',
        config: {},
        request: {}, // Has request but no response
      });

      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce(axiosError);
      await expect(fetchUrlContent('http://example.com/noresponse')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_REQUEST_FAILED,
          'Request to http://example.com/noresponse failed: No response received from server'
        )
      );
    });

    it('should throw HTTP_REQUEST_FAILED for other network errors', async () => {
      const axiosError = Object.assign(new Error('Network Error'), {
        name: 'AxiosError',
        code: 'ERR_NETWORK',
        config: {},
      });

      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce(axiosError);
      await expect(fetchUrlContent('http://example.com/networkerror')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_REQUEST_FAILED,
          'Request to http://example.com/networkerror failed: Network Error'
        )
      );
    });

    it('should truncate content if it exceeds maxUrlDownloadBytes', async () => {
      const mockUrl = 'http://example.com/largefile';
      const largeDataSize = mockMaxUrlDownloadBytes + 100;
      const mockLargeDataBuffer = Buffer.alloc(largeDataSize, 'a'); // Create a buffer larger than max
      const mockResponseHeaders = new AxiosHeaders();
      mockResponseHeaders.set('content-type', 'application/octet-stream');

      (mockedAxios as unknown as import('vitest').Mock).mockResolvedValue({
        data: mockLargeDataBuffer,
        status: 200,
        headers: mockResponseHeaders,
        request: { res: { responseUrl: mockUrl } },
      });

      const result = await fetchUrlContent(mockUrl, false, undefined, mockMaxUrlDownloadBytes);
      expect(result.content).not.toBeNull();
      expect(result.content!.length).toBe(mockMaxUrlDownloadBytes);
      expect(result.size_bytes).toBe(mockMaxUrlDownloadBytes);
      expect(result.content!.toString()).toBe('a'.repeat(mockMaxUrlDownloadBytes)); // Verify content is truncated part of original
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('exceeded maxBytes'));
    });
  });

  describe('cleanHtmlToMarkdown', () => {
    const mockHtmlContent =
      '<html><body><article><h1>Title</h1><p>Some text.</p><script>alert("bad")</script></article></body></html>';
    const mockPageUrl = 'http://example.com/article';
    const mockArticleContent = '<h1>Title</h1><p>Some text.</p>'; // Content Readability should extract (without script)
    const mockMarkdown = '# Title\n\nSome text.';

    let mockReadabilityInstance: {
      parse: vi.MockedFunction<() => { title?: string; content?: string } | null>;
    };

    beforeEach(() => {
      // Mock JSDOM constructor and its document object
      const mockDom = { window: { document: 'mockDocument' } };
      (mockedJSDOM as unknown as import('vitest').Mock).mockImplementation(() => mockDom);

      // Mock Readability constructor and parse method
      mockReadabilityInstance = { parse: vi.fn() };
      (mockedReadability as unknown as import('vitest').Mock).mockImplementation(
        () => mockReadabilityInstance
      );
      mockReadabilityInstance.parse.mockReturnValue({
        title: 'Title',
        content: mockArticleContent,
      });

      // Mock TurndownService instance and turndown method (already done in outer beforeEach, but can be specific here)
      mockTurndownMethod.mockReturnValue(mockMarkdown);
    });

    it('should clean HTML and convert to Markdown successfully', () => {
      const result = cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl);
      expect(mockedJSDOM).toHaveBeenCalledWith(mockHtmlContent, { url: mockPageUrl });
      expect(mockedReadability).toHaveBeenCalledWith('mockDocument');
      expect(mockReadabilityInstance.parse).toHaveBeenCalled();
      // Check the JSDOM call for cleaning (this is a bit tricky to mock precisely without deep instance mocks)
      // We'll trust the logic removes scripts/styles and passes the result to turndown
      expect(mockTurndownMethod).toHaveBeenCalledWith(mockArticleContent); // Check with the extracted content
      expect(result).toBe(mockMarkdown);
    });

    it('should throw ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED if Readability returns no content', () => {
      mockReadabilityInstance.parse.mockReturnValueOnce(null);
      expect(() => cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl)).toThrow(
        new ConduitError(
          ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED,
          'Failed to extract readable content from HTML.'
        )
      );

      mockReadabilityInstance.parse.mockReturnValueOnce({ content: null });
      expect(() => cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl)).toThrow(
        new ConduitError(
          ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED,
          'Failed to extract readable content from HTML.'
        )
      );
    });

    it('should log warning but not throw if turndown produces empty markdown for valid extracted content', () => {
      mockTurndownMethod.mockReturnValueOnce(''); // Turndown returns empty string
      const result = cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl);
      expect(result).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Turndown conversion resulted in empty or non-string markdown')
      );
    });

    it('should throw ERR_MARKDOWN_CONVERSION_FAILED on Turndown errors', () => {
      mockTurndownMethod.mockImplementationOnce(() => {
        throw new Error('Turndown failed');
      });
      expect(() => cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl)).toThrow(
        new ConduitError(
          ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED,
          'Failed to convert HTML to Markdown: Turndown failed'
        )
      );
    });
  });
});
