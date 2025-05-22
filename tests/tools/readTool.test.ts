import {
  ReadTool,
  ConduitServerConfig, // Type, not the config object itself from mock
  ConduitError,
  ErrorCode,
  // Import the mocked versions directly:
  logger,
  conduitConfig as mockedConduitConfigFromInternal, // Alias to avoid conflict if conduitConfig is also a var name
  securityHandler,
  fileSystemOps,
  mimeService,
  webFetcher,
  imageProcessor,
  calculateChecksum,
  // Make sure all other necessary exports from @/internal used in this file are imported
} from '@/internal';
import { readToolHandler } from '@/tools/readTool';
import crypto from 'crypto';
import diff from 'diff';
import path from 'path';
import { Mocked, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended'; // mockReset might be an issue later

// Mock @/internal
// The mock factory itself looks reasonable with importOriginal and mockDeep
vi.mock('@/internal', async (importOriginal) => {
  const actualInternal = await importOriginal<typeof import('@/internal')>();
  return {
    ...actualInternal,
    logger: mockDeep<typeof actualInternal.logger>(),
    // Use actual conduitConfig as a base, it's often not fully mocked but overridden in tests
    conduitConfig: actualInternal.conduitConfig,
    securityHandler: mockDeep<typeof actualInternal.securityHandler>(),
    fileSystemOps: mockDeep<typeof actualInternal.fileSystemOps>(),
    mimeService: mockDeep<typeof actualInternal.mimeService>(),
    webFetcher: mockDeep<typeof actualInternal.webFetcher>(),
    imageProcessor: mockDeep<typeof actualInternal.imageProcessor>(),
    calculateChecksum: vi.fn(), // This was vi.fn() directly
    // Other exports like Enums and Classes should be fine as they are not functions to be mocked usually
    ConduitError: actualInternal.ConduitError,
    ErrorCode: actualInternal.ErrorCode,
    // ReadTool is a namespace of types, should be fine
  };
});

// These are fine
vi.mock('crypto');
vi.mock('diff');

// Get the mocked modules - this part is tricky if conduitConfig is also the name of the var from @/internal
// The mockedConduitConfig used in tests should be the one from @/internal (which is `actualInternal.conduitConfig` from the mock factory)
// or a separate deep mock if we intend to control it independently of the one @/internal provides.
// For now, `mockedConduitConfigFromInternal` is imported. Tests use `mockedConduitConfig` as a variable.
// Let's assume `mockedConduitConfig` is a separate mock for test overrides.
const mockedConduitConfig = mockDeep<ConduitServerConfig>(); // This is a common pattern for the config object
const mockedCrypto = crypto as Mocked<typeof crypto>;
const mockedDiff = diff as Mocked<typeof diff>;

describe('ReadTool', () => {
  const mockSourceFile = '/allowed/file.txt';
  const mockSourceUrl = 'http://example.com/page.html';
  const mockImageUrl = 'http://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();
    mockReset(mockedConduitConfig); // Reset the separate config mock

    // Apply default test config values to the separate mock
    // This assumes defaultTestConfig is defined elsewhere or should be defined here.
    // For now, I'll mock some essential properties.
    Object.assign(mockedConduitConfig, {
      maxFileReadBytes: 1024 * 1024,
      maxUrlDownloadSizeBytes: 1024 * 1024,
      // ... other necessary default config properties for readTool tests
    });


    // Use directly imported mocks from @/internal
    securityHandler.validateAndResolvePath.mockImplementation(async (p: string) => p);
    fileSystemOps.readFileAsBuffer.mockResolvedValue(Buffer.from('File content'));
    fileSystemOps.readFileAsString.mockResolvedValue('File content');
    fileSystemOps.getStats.mockResolvedValue({
      size: 100,
      isFile: () => true,
      isDirectory: () => false,
      // Add other Stats properties if they are accessed
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      mode: 0o644,
    } as any); // Cast to any if mock is not a full Stats object
    fileSystemOps.createEntryInfo.mockImplementation(
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

    mimeService.getMimeType.mockResolvedValue('text/plain');

    webFetcher.fetchUrlContent.mockResolvedValue({
      content: Buffer.from('URL content'),
      mimeType: 'text/html',
      httpStatus: 200,
      headers: { 'content-type': 'text/html' },
      finalUrl: mockSourceUrl,
    });
    webFetcher.cleanHtmlToMarkdown.mockReturnValue('# Markdown Content');

    imageProcessor.compressImageIfNecessary.mockImplementation(async (buf: Buffer, _mime: string) => ({
      buffer: buf,
      original_size_bytes: buf.length,
      compression_applied: false,
    }));

    (mockedCrypto.createHash as import('vitest').Mock).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('mockedchecksum-testspecific'),
    });
    (mockedDiff.createPatch as import('vitest').Mock).mockReturnValue('--- a/file1\n+++ b/file2\n');

    // Ensure logger mocks are set up if its methods are called and checked
    // logger is imported from @/internal and is a deep mock.
    // Example: logger.info.mockReturnValue(undefined); logger.error.mockReturnValue(undefined);
  });

  describe('handleContentOperation', () => {
    it('should read text file content correctly', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'text',
      };
      // Pass the mockedConduitConfig (the separate one)
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
      // REMOVED: const internal = require('@/internal');
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      fileSystemOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('Base64Test'));
      const response = await readToolHandler(params, mockedConduitConfig as ConduitServerConfig) as ReadTool.DefinedContentResponse;
      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe(Buffer.from('Base64Test').toString('base64'));
        expect(response.results[0].output_format_used).toBe('base64');
      }
    });

    it('should fetch URL and convert to markdown', async () => {
      // REMOVED: const internal = require('@/internal');
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
      expect(webFetcher.cleanHtmlToMarkdown).toHaveBeenCalledWith(
        'URL content',
        mockSourceUrl
      );
    });

    it('should fallback to text for markdown if URL content is not HTML', async () => {
      // REMOVED: const internal = require('@/internal');
      webFetcher.fetchUrlContent.mockResolvedValueOnce({
        content: Buffer.from('Non-HTML'),
        mimeType: 'application/json', // Changed to application/json to test non-HTML path
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
        expect(response.results[0].content).toBeNull(); // content is null
        expect(response.results[0].output_format_used).toBe('markdown'); // output_format_used is markdown
        expect(response.results[0].detected_format).toBe('application/json');
        expect(response.results[0].user_note).toBe('Content could not be converted to Markdown as it is not HTML.');
        expect(response.results[0].markdown_conversion_status).toBe('skipped_unsupported_content_type');
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
      // REMOVED: const internal = require('@/internal');
      mimeService.getMimeType.mockResolvedValue('image/png'); // Was using internal.mimeService
      imageProcessor.compressImageIfNecessary.mockResolvedValueOnce({ // Was using internal.imageProcessor
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
      // REMOVED: const internal = require('@/internal');
      mimeService.getMimeType.mockResolvedValueOnce('text/plain'); // Was using internal.mimeService
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
      // REMOVED: const internal = require('@/internal');
      mimeService.getMimeType.mockResolvedValueOnce('image/jpeg');
      fileSystemOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('jpegdata'));
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