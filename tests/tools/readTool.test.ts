import { readToolHandler } from '@/tools/readTool';
import { ReadTool } from '@/types/tools';
import { conduitConfig, ConduitServerConfig } from '@/internal';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';
import path from 'path';
import * as crypto from 'crypto';
import * as diff from 'diff';

// Mock @/internal and external modules
vi.mock('@/internal', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@/internal')>();
  return {
    ...originalModule,
    conduitConfig: {
      allowedPaths: ['/allowed'],
      serverVersion: '1.0.0-test',
      security: {
        validatePaths: true,
        forbiddenPaths: ['/forbidden']
      },
      read: {
        validateAccess: true,
        maxBinaryFileSize: 10485760,
        enableDiff: true
      },
      web: {
        enableUrlFetching: true,
        userAgent: 'test-agent'
      },
      compression: {
        enableImages: true,
        quality: 85,
        maxDimension: 2048
      }
    },
    fileSystemOps: {
      readFileAsBuffer: vi.fn().mockResolvedValue(Buffer.from('File content')),
      readFileAsString: vi.fn().mockResolvedValue('File content'),
      getStats: vi.fn().mockResolvedValue({
        size: 100,
        isFile: () => true,
        isDirectory: () => false,
      }),
      createEntryInfo: vi.fn().mockImplementation(
        async (p: string, stats: any) =>
          ({
            name: path.basename(p),
            path: p,
            type: stats.isDirectory() ? 'directory' : 'file',
            size_bytes: stats.size,
            mime_type: 'text/plain',
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
          }) as any
      ),
    },
    securityHandler: {
      validateAndResolvePath: vi.fn().mockImplementation(async (p: string) => p),
    },
    webFetcher: {
      fetchUrlContent: vi.fn(),
      cleanHtmlToMarkdown: vi.fn().mockReturnValue('# Markdown Content'),
    },
    imageProcessor: {
      compressImageIfNecessary: vi.fn().mockImplementation(async (buf: Buffer, _mime: string) => ({
        buffer: buf,
        original_size_bytes: buf.length,
        compression_applied: false,
      })),
    },
    mimeService: {
      getMimeType: vi.fn().mockResolvedValue('text/plain'),
    }
  };
});

vi.mock('crypto', async (importOriginal) => {
  const actualCrypto = (await importOriginal()) as typeof crypto;
  return {
    ...actualCrypto,
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('mockedchecksum'),
    }),
  };
});

vi.mock('diff');

// Get the mocked modules
const mockedConduitConfig = conduitConfig as Mocked<typeof conduitConfig>;
const mockedCrypto = crypto as Mocked<typeof crypto>;
const mockedDiff = diff as Mocked<typeof diff>;

describe('ReadTool', () => {
  const mockSourceFile = '/allowed/file.txt';
  const mockSourceUrl = 'http://example.com/page.html';
  const mockImageUrl = 'http://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the mocked modules
    const internal = require('@/internal');
    
    // Default mock implementations
    internal.securityHandler.validateAndResolvePath.mockImplementation(async (p: string) => p);
    internal.fileSystemOps.readFileAsBuffer.mockResolvedValue(Buffer.from('File content'));
    internal.fileSystemOps.readFileAsString.mockResolvedValue('File content');
    internal.fileSystemOps.getStats.mockResolvedValue({
      size: 100,
      isFile: () => true,
      isDirectory: () => false,
    });
    internal.fileSystemOps.createEntryInfo.mockImplementation(
      async (p: string, stats: any) =>
        ({
          name: path.basename(p),
          path: p,
          type: stats.isDirectory() ? 'directory' : 'file',
          size_bytes: stats.size,
          mime_type: 'text/plain',
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        }) as any
    );

    internal.mimeService.getMimeType.mockResolvedValue('text/plain');

    internal.webFetcher.fetchUrlContent.mockResolvedValue({
      content: Buffer.from('URL content'),
      mimeType: 'text/html',
      httpStatus: 200,
      headers: { 'content-type': 'text/html' },
      finalUrl: mockSourceUrl,
    });
    internal.webFetcher.cleanHtmlToMarkdown.mockReturnValue('# Markdown Content');

    internal.imageProcessor.compressImageIfNecessary.mockImplementation(async (buf: Buffer, _mime: string) => ({
      buffer: buf,
      original_size_bytes: buf.length,
      compression_applied: false,
    }));

    (mockedCrypto.createHash as import('vitest').Mock).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('mockedchecksum-testspecific'),
    });
    (mockedDiff.createPatch as import('vitest').Mock).mockReturnValue('--- a/file1\n+++ b/file2\n');
  });

  describe('handleContentOperation', () => {
    it('should read text file content correctly', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'text',
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe('File content');
        expect(response.results[0].mime_type).toBe('text/plain');
        expect(response.results[0].output_format_used).toBe('text');
      }
    });

    it('should read file content as base64', async () => {
      const internal = require('@/internal');
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      internal.fileSystemOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('Base64Test'));
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe(Buffer.from('Base64Test').toString('base64'));
        expect(response.results[0].output_format_used).toBe('base64');
      }
    });

    it('should fetch URL and convert to markdown', async () => {
      const internal = require('@/internal');
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceUrl],
        format: 'markdown',
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe('# Markdown Content');
        expect(response.results[0].output_format_used).toBe('markdown');
        expect(response.results[0].markdown_conversion_status).toBe('success');
      }
      expect(internal.webFetcher.cleanHtmlToMarkdown).toHaveBeenCalledWith(
        'URL content',
        mockSourceUrl
      );
    });

    it('should fallback to text for markdown if URL content is not HTML', async () => {
      const internal = require('@/internal');
      internal.webFetcher.fetchUrlContent.mockResolvedValueOnce({
        content: Buffer.from('Non-HTML'),
        mimeType: 'application/json',
        httpStatus: 200,
        headers: { 'content-type': 'application/json' },
        finalUrl: mockSourceUrl,
      });
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceUrl],
        format: 'markdown',
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe('Non-HTML');
        expect(response.results[0].output_format_used).toBe('text');
        expect(response.results[0].markdown_conversion_status).toBe('skipped_unsupported_content_type');
        expect(response.results[0].markdown_conversion_skipped_reason).toBeDefined();
      }
    });

    it('should calculate checksum for a file', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'checksum',
        checksum_algorithm: 'sha256',
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].checksum).toBe('mockedchecksum-testspecific');
        expect(response.results[0].content).toBe('mockedchecksum-testspecific');
        expect(response.results[0].output_format_used).toBe('checksum');
        expect(response.results[0].checksum_algorithm_used).toBe('sha256');
      }
      expect(mockedCrypto.createHash).toHaveBeenCalledWith('sha256');
    });

    it('should handle image compression for base64 format', async () => {
      const internal = require('@/internal');
      internal.mimeService.getMimeType.mockResolvedValue('image/png');
      internal.imageProcessor.compressImageIfNecessary.mockResolvedValueOnce({
        buffer: Buffer.from('compressed_image_data'),
        original_size_bytes: 2000,
        compression_applied: true,
        compression_error_note: undefined,
      });
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe(Buffer.from('compressed_image_data').toString('base64'));
        expect(response.results[0].compression_applied).toBe(true);
        expect(response.results[0].original_size_bytes).toBe(2000);
      }
    });

    it('should use default format if not specified (text file)', async () => {
      const internal = require('@/internal');
      internal.mimeService.getMimeType.mockResolvedValueOnce('text/plain');
      const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].output_format_used).toBe('text');
        expect(response.results[0].content).toBe('File content');
      }
    });

    it('should use default format if not specified (image file -> base64)', async () => {
      const internal = require('@/internal');
      internal.mimeService.getMimeType.mockResolvedValueOnce('image/jpeg');
      internal.fileSystemOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('jpegdata'));
      const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].output_format_used).toBe('base64');
        expect(response.results[0].content).toBe(Buffer.from('jpegdata').toString('base64'));
      }
    });

    it('should return INVALID_PARAMETER error if sources array is empty for content op', async () => {
      const params: ReadTool.Parameters = { operation: 'content', sources: [] };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('error');
      if (response.results[0].status === 'error') {
        expect(response.results[0].error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(response.results[0].error_message).toContain('Sources array cannot be empty');
      }
    });
  });

  describe('handleMetadataOperation', () => {
    it('should fetch metadata for a local file', async () => {
      const params: ReadTool.MetadataParams = {
        operation: 'metadata',
        sources: [mockSourceFile],
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedMetadataResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].source_type).toBe('file');
        expect(response.results[0].metadata?.name).toBe('file.txt');
        expect(response.results[0].metadata?.entry_type).toBe('file');
      }
    });

    it('should fetch metadata for a URL (HEAD request)', async () => {
      const internal = require('@/internal');
      internal.webFetcher.fetchUrlContent.mockResolvedValueOnce({
        content: Buffer.from(''),
        mimeType: 'image/png',
        httpStatus: 200,
        headers: {
          'content-type': 'image/png',
          'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
          'content-length': '12345',
        },
        finalUrl: mockImageUrl,
      });
      const params: ReadTool.MetadataParams = {
        operation: 'metadata',
        sources: [mockImageUrl],
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedMetadataResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].source_type).toBe('url');
        expect(response.results[0].metadata?.name).toBe('image.png');
        expect(response.results[0].metadata?.mime_type).toBe('image/png');
        expect(response.results[0].metadata?.size_bytes).toBe(12345);
        expect(response.results[0].metadata?.modified_at).toBe('1994-11-15T12:45:26.000Z');
      }
      expect(internal.webFetcher.fetchUrlContent).toHaveBeenCalledWith(mockImageUrl, true, undefined);
    });
  });

  describe('handleDiffOperation', () => {
    it('should perform a diff between two local files', async () => {
      const internal = require('@/internal');
      const file1 = '/allowed/file1.txt';
      const file2 = '/allowed/file2.txt';
      internal.fileSystemOps.readFileAsString
        .mockResolvedValueOnce('Content of file1')
        .mockResolvedValueOnce('Content of file2');

      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [file1, file2] as [string, string],
      };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedDiffResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('success');
      if (response.results.status === 'success') {
        expect(response.results.diff_content).toBe('--- a/file1\n+++ b/file2\n');
        expect(response.results.sources_compared).toEqual([file1, file2]);
      }
      expect(mockedDiff.createPatch).toHaveBeenCalledWith(
        'file1.txt',
        'Content of file1',
        'file2.txt',
        'Content of file2',
        '',
        '',
        { context: 3 }
      );
    });

    it('should throw error if diff sources are not two files', async () => {
      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [mockSourceFile] as any, // Invalid
      };
      await expect(readToolHandler(params, mockedConduitConfig as ConduitServerConfig)).rejects.toThrow(
        new ConduitError(
          ErrorCode.INVALID_PARAMETER,
          'Diff operation requires exactly two source file paths.'
        )
      );
    });

    it('should throw error if diff sources include a URL', async () => {
      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [mockSourceFile, mockSourceUrl] as [string, string],
      };
      await expect(readToolHandler(params, mockedConduitConfig as ConduitServerConfig)).rejects.toThrow(
        new ConduitError(
          ErrorCode.INVALID_PARAMETER,
          'Diff operation only supports local files, not URLs.'
        )
      );
    });

    it('should return INVALID_PARAMETER error if sources array has more than two for diff op', async () => {
      const params: ReadTool.Parameters = { operation: 'diff', sources: ['s1', 's2'] };
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedDiffResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('error');
      if (response.results.status === 'error') {
        expect(response.results.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(response.results.error_message).toContain(
          'Diff operation requires exactly two sources'
        );
      }
    });
  });

  it('should throw error for invalid operation', async () => {
    const params = { operation: 'invalid_op', sources: ['s'] } as any;
    await expect(readToolHandler(params, mockedConduitConfig as ConduitServerConfig)).rejects.toThrow(
      new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION)
    );
  });
});