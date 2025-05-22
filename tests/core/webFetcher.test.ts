import { vi, Mocked } from 'vitest';
import { fetchUrlContent, cleanHtmlToMarkdown } from '@/core/webFetcher';
import { conduitConfig } from '@/internal';
import logger from '@/utils/logger';
import { ConduitError, ErrorCode, FetchedContent } from '@/internal';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// Mock external dependencies
vi.mock('axios');
vi.mock('jsdom');
vi.mock('@mozilla/readability');
vi.mock('turndown');

// Mock configLoader
const mockHttpTimeoutMs = 10000;
const mockMaxUrlDownloadBytes = 5 * 1024 * 1024;
vi.mock('@/core/configLoader', () => ({
  conduitConfig: {
    httpTimeoutMs: mockHttpTimeoutMs,
    maxUrlDownloadBytes: mockMaxUrlDownloadBytes,
    // Add other config properties if webFetcher uses them
  },
}));

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
        }) as any
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
      } as any);

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
      } as any);
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
      } as any);
      await fetchUrlContent(mockUrl, false, rangeObject);
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { Range: rangeHeaderString } })
      );
    });

    it('should throw HTTP_INVALID_URL for invalid URL format', async () => {
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        request: {},
        message: 'Invalid URL',
        config: {},
        name: '',
      });
      await expect(fetchUrlContent('invalid-url')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_INVALID_URL,
          expect.stringContaining('Invalid URL format')
        )
      );
    });

    it('should throw HTTP_INVALID_URL for unsupported protocol', async () => {
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        request: {},
        message: 'Protocol not supported',
        config: {},
        name: '',
      });
      await expect(fetchUrlContent('ftp://example.com')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_INVALID_URL,
          expect.stringContaining('Unsupported URL protocol')
        )
      );
    });

    it('should throw HTTP_TIMEOUT on timeout', async () => {
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded',
        config: {},
        name: '',
      });
      await expect(fetchUrlContent('http://example.com/timeout')).rejects.toThrow(
        new ConduitError(ErrorCode.ERR_HTTP_TIMEOUT, expect.stringContaining('timed out'))
      );
    });

    it('should throw HTTP_STATUS_ERROR for non-2xx response', async () => {
      const mockUrl = 'http://example.com/notfound';
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        config: {} as any,
        name: 'AxiosError',
        message: 'Request failed with status code 404',
        code: 'ERR_BAD_REQUEST',
        status: 404,
        statusText: 'Not Found',
        request: { res: { responseUrl: mockUrl } },
        response: {
          data: null,
          status: 404,
          statusText: 'Not Found',
          headers: {},
          config: {} as any,
        },
        toJSON: () => ({}),
      } as AxiosError);
      await expect(fetchUrlContent(mockUrl)).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_STATUS_ERROR,
          expect.stringContaining('failed with HTTP status 404')
        )
      );
    });

    it('should throw HTTP_REQUEST_FAILED for no response errors', async () => {
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        request: {},
        message: 'No response received from server',
        config: {} as any,
        name: 'AxiosError',
        code: 'ERR_NETWORK',
      } as AxiosError);
      await expect(fetchUrlContent('http://example.com/noresponse')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_REQUEST_FAILED,
          expect.stringContaining('No response received')
        )
      );
    });

    it('should throw HTTP_REQUEST_FAILED for other network errors', async () => {
      (mockedAxios as unknown as import('vitest').Mock).mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Network Error',
        config: {} as any,
        name: 'AxiosError',
        code: 'ERR_NETWORK',
      });
      await expect(fetchUrlContent('http://example.com/networkerror')).rejects.toThrow(
        new ConduitError(
          ErrorCode.ERR_HTTP_REQUEST_FAILED,
          expect.stringContaining('Network Error')
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
      } as any);

      const result = await fetchUrlContent(mockUrl);
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
    const mockCleanedHtml = '<h1>Title</h1><p>Some text.</p>'; // After our own script/style removal
    const mockMarkdown = '# Title\n\nSome text.';

    beforeEach(() => {
      // Mock JSDOM constructor and its document object
      const mockDom = { window: { document: 'mockDocument' } };
      (mockedJSDOM as unknown as import('vitest').Mock).mockImplementation(() => mockDom as any);

      // Mock Readability constructor and parse method
      const mockReadabilityInstance = { parse: vi.fn() };
      (mockedReadability as unknown as import('vitest').Mock).mockImplementation(
        () => mockReadabilityInstance as any
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
      expect(mockedReadability.prototype.parse).toHaveBeenCalled();
      // Check the JSDOM call for cleaning (this is a bit tricky to mock precisely without deep instance mocks)
      // We'll trust the logic removes scripts/styles and passes the result to turndown
      expect(mockTurndownMethod).toHaveBeenCalledWith(mockCleanedHtml); // Check with the script-cleaned HTML
      expect(result).toBe(mockMarkdown);
    });

    it('should throw ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED if Readability returns no content', () => {
      (mockedReadability.prototype.parse as any).mockReturnValueOnce(null);
      expect(() => cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl)).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED)
      );

      (mockedReadability.prototype.parse as any).mockReturnValueOnce({ content: null });
      expect(() => cleanHtmlToMarkdown(mockHtmlContent, mockPageUrl)).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED)
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
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED)
      );
    });

    it('should throw ConduitError if turndownService.turndown throws an error', () => {
      const htmlContent = '<p>Error case</p>';
      const turndownSpy = vi.spyOn(TurndownService.prototype, 'turndown').mockImplementation(() => {
        throw new Error('Turndown internal error');
      });
      expect(() => cleanHtmlToMarkdown(htmlContent, 'http://example.com')).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED)
      );
      turndownSpy.mockRestore();
    });

    it('should throw ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED if Readability parsing fails', () => {
      const htmlContent = '<p>Test</p>';
      // @ts-ignore
      vi.spyOn(Readability.prototype, 'parse').mockReturnValue(null); // Simulate Readability failure
      expect(() => cleanHtmlToMarkdown(htmlContent, 'http://example.com')).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED)
      );
      vi.restoreAllMocks();
    });

    it('should throw ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED if Readability result has no content', () => {
      const htmlContent = '<p>Test</p>';
      // @ts-ignore
      vi.spyOn(Readability.prototype, 'parse').mockReturnValue({
        textContent: '',
        title: '',
        content: null,
      });
      expect(() => cleanHtmlToMarkdown(htmlContent, 'http://example.com')).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONTENT_EXTRACTION_FAILED)
      );
      vi.restoreAllMocks();
    });

    it('should throw ConduitError if turndownService.turndown throws within main content extraction', () => {
      const htmlContent = '<article><h1>Title</h1><p>Real content.</p></article>';
      // @ts-ignore // Mocking Readability a bit loosely for simplicity
      vi.spyOn(Readability.prototype, 'parse').mockReturnValue({
        textContent: 'Real content.',
        title: 'Title',
        content: '<p>Real content.</p>',
      });
      const turndownSpy = vi.spyOn(TurndownService.prototype, 'turndown').mockImplementation(() => {
        throw new Error('Turndown broke on main content');
      });

      expect(() => cleanHtmlToMarkdown(htmlContent, 'http://example.com')).toThrow(
        new ConduitError(ErrorCode.ERR_MARKDOWN_CONVERSION_FAILED)
      );

      turndownSpy.mockRestore();
      vi.restoreAllMocks();
    });
  });
});
