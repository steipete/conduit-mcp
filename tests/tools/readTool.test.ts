import { handleReadTool } from '@/tools/readTool';
import { ReadTool } from '@/types/tools';
import { conduitConfig } from '@/core/configLoader';
import * as securityHandler from '@/core/securityHandler';
import * as fsOps from '@/core/fileSystemOps';
import * as webFetcher from '@/core/webFetcher';
import * as imageProcessor from '@/core/imageProcessor';
import * as mimeService from '@/core/mimeService';
import * as crypto from 'crypto';
import * as diff from 'diff';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { vi, Mocked } from 'vitest';
import path from 'path';

// Mock all imported modules from core and operations
vi.mock('@/core/configLoader');
vi.mock('@/core/securityHandler');
vi.mock('@/core/fileSystemOps');
vi.mock('@/core/webFetcher');
vi.mock('@/core/imageProcessor');
vi.mock('@/core/mimeService');
vi.mock('crypto', async (importOriginal) => {
  const actualCrypto = await importOriginal() as typeof crypto;
  return {
    ...actualCrypto,
    createHash: vi.fn().mockReturnValue({ update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('mockedchecksum') }),
  };
});
vi.mock('diff');

// Typed mocks
const mockedConduitConfig = conduitConfig as Mocked<typeof conduitConfig>;
const mockedSecurityHandler = securityHandler as Mocked<typeof securityHandler>;
const mockedFsOps = fsOps as Mocked<typeof fsOps>;
const mockedWebFetcher = webFetcher as Mocked<typeof webFetcher>;
const mockedImageProcessor = imageProcessor as Mocked<typeof imageProcessor>;
const mockedMimeService = mimeService as Mocked<typeof mimeService>;
const mockedCrypto = crypto as Mocked<typeof crypto>;
const mockedDiff = diff as Mocked<typeof diff>;

describe('ReadTool', () => {
  const mockSourceFile = '/allowed/file.txt';
  const mockSourceUrl = 'http://example.com/page.html';
  const mockImageUrl = 'http://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    // @ts-ignore - part of the mock structure
    mockedConduitConfig.defaultChecksumAlgorithm = 'sha256';
    // @ts-ignore
    mockedConduitConfig.maxFileReadBytes = 1024 * 1024;
    // @ts-ignore
    mockedConduitConfig.maxUrlDownloadBytes = 1024 * 1024;

    mockedSecurityHandler.validateAndResolvePath.mockImplementation(async (p) => p); // Pass through validated path
    mockedFsOps.readFileAsBuffer.mockResolvedValue(Buffer.from('File content'));
    mockedFsOps.readFileAsString.mockResolvedValue('File content');
    mockedFsOps.getStats.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false } as any);
    mockedFsOps.createEntryInfo.mockImplementation(async (p, stats) => ({
        name: path.basename(p),
        path: p,
        type: stats.isDirectory() ? 'directory' : 'file',
        size_bytes: stats.size,
        mime_type: 'text/plain',
        created_at_iso: new Date().toISOString(),
        modified_at_iso: new Date().toISOString(),
    }) as any);

    mockedMimeService.getMimeType.mockResolvedValue('text/plain');

    mockedWebFetcher.fetchUrlContent.mockResolvedValue({
      content: Buffer.from('URL content'),
      mimeType: 'text/html',
      httpStatus: 200,
      headers: { 'content-type': 'text/html' },
      finalUrl: mockSourceUrl,
    });
    mockedWebFetcher.cleanHtmlToMarkdown.mockReturnValue('# Markdown Content');

    mockedImageProcessor.compressImageIfNecessary.mockImplementation(async (buf, _mime) => ({
      buffer: buf,
      original_size_bytes: buf.length,
      compression_applied: false,
    }));
    
    (mockedCrypto.createHash as import('vitest').Mock).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue('mockedchecksum-testspecific')
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
      const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].content).toBe('File content');
        expect(result[0].mime_type).toBe('text/plain');
        expect(result[0].output_format_used).toBe('text');
      }
    });

    it('should read file content as base64', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('Base64Test'));
      const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].content).toBe(Buffer.from('Base64Test').toString('base64'));
        expect(result[0].output_format_used).toBe('base64');
      }
    });

    it('should fetch URL and convert to markdown', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceUrl],
        format: 'markdown',
      };
      const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].content).toBe('# Markdown Content');
        expect(result[0].output_format_used).toBe('markdown');
        expect(result[0].markdown_conversion_status).toBe('success');
      }
      expect(mockedWebFetcher.cleanHtmlToMarkdown).toHaveBeenCalledWith('URL content', mockSourceUrl);
    });

    it('should fallback to text for markdown if URL content is not HTML', async () => {
      mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce({
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
      const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].content).toBe('Non-HTML');
        expect(result[0].output_format_used).toBe('text');
        expect(result[0].markdown_conversion_status).toBe('skipped_unsupported_content_type');
        expect(result[0].markdown_conversion_skipped_reason).toBeDefined();
      }
    });

    it('should calculate checksum for a file', async () => {
      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'checksum',
        checksum_algorithm: 'sha256',
      };
      const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].checksum).toBe('mockedchecksum-testspecific');
        expect(result[0].content).toBe('mockedchecksum-testspecific');
        expect(result[0].output_format_used).toBe('checksum');
        expect(result[0].checksum_algorithm_used).toBe('sha256');
      }
      expect(mockedCrypto.createHash).toHaveBeenCalledWith('sha256');
    });

    it('should handle image compression for base64 format', async () => {
        (mockedMimeService.getMimeType as import('vitest').Mock).mockResolvedValue('image/png');
        mockedImageProcessor.compressImageIfNecessary.mockResolvedValueOnce({
            buffer: Buffer.from('compressed_image_data'),
            original_size_bytes: 2000,
            compression_applied: true,
            compression_error_note: undefined
        });
        const params: ReadTool.ContentParams = {
            operation: 'content',
            sources: [mockSourceFile],
            format: 'base64',
        };
        const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
        expect(result[0].status).toBe('success');
        if (result[0].status === 'success') {
            expect(result[0].content).toBe(Buffer.from('compressed_image_data').toString('base64'));
            expect(result[0].compression_applied).toBe(true);
            expect(result[0].original_size_bytes).toBe(2000);
        }
    });

    it('should use default format if not specified (text file)', async () => {
        (mockedMimeService.getMimeType as import('vitest').Mock).mockResolvedValueOnce('text/plain');
        const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
        const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
        expect(result[0].status).toBe('success');
        if (result[0].status === 'success') {
            expect(result[0].output_format_used).toBe('text');
            expect(result[0].content).toBe('File content');
        }
    });

    it('should use default format if not specified (image file -> base64)', async () => {
        (mockedMimeService.getMimeType as import('vitest').Mock).mockResolvedValueOnce('image/jpeg');
        mockedFsOps.readFileAsBuffer.mockResolvedValueOnce(Buffer.from('jpegdata'));
        const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
        const result = await handleReadTool(params) as ReadTool.ContentResultItem[];
        expect(result[0].status).toBe('success');
        if (result[0].status === 'success') {
            expect(result[0].output_format_used).toBe('base64');
            expect(result[0].content).toBe(Buffer.from('jpegdata').toString('base64'));
        }
    });

    it('should return INVALID_PARAMETER error if sources array is empty for content op', async () => {
        const params: ReadTool.Parameters = { operation: 'content', sources: [] };
        mockedReadOpsHandler.handleReadTool.mockResolvedValueOnce({
            status: 'error',
            error_code: ErrorCode.INVALID_PARAMETER,
            error_message: 'Sources array cannot be empty for content operation'
        });
        const result = await handleReadTool(params);
        expect(result.status).toBe('error');
        expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(result.error_message).toBe('Sources array cannot be empty for content operation');
    });
  });

  describe('handleMetadataOperation', () => {
    it('should fetch metadata for a local file', async () => {
      const params: ReadTool.MetadataParams = {
        operation: 'metadata',
        sources: [mockSourceFile],
      };
      const result = await handleReadTool(params) as ReadTool.MetadataResultItem[];
      expect(result[0].status).toBe('success');
      if (result[0].status === 'success') {
        expect(result[0].source_type).toBe('file');
        expect(result[0].metadata?.name).toBe('file.txt');
        expect(result[0].metadata?.entry_type).toBe('file');
      }
    });

    it('should fetch metadata for a URL (HEAD request)', async () => {
        mockedWebFetcher.fetchUrlContent.mockResolvedValueOnce({
            content: Buffer.from(''),
            mimeType: 'image/png',
            httpStatus: 200,
            headers: { 'content-type': 'image/png', 'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT', 'content-length': '12345' },
            finalUrl: mockImageUrl,
        });
        const params: ReadTool.MetadataParams = {
            operation: 'metadata',
            sources: [mockImageUrl],
        };
        const result = await handleReadTool(params) as ReadTool.MetadataResultItem[];
        expect(result[0].status).toBe('success');
        if (result[0].status === 'success') {
            expect(result[0].source_type).toBe('url');
            expect(result[0].metadata?.name).toBe('image.png');
            expect(result[0].metadata?.mime_type).toBe('image/png');
            expect(result[0].metadata?.size_bytes).toBe(12345);
            expect(result[0].metadata?.modified_at_iso).toBe('1994-11-15T12:45:26.000Z');
        }
        expect(mockedWebFetcher.fetchUrlContent).toHaveBeenCalledWith(mockImageUrl, true, undefined);
    });
  });

  describe('handleDiffOperation', () => {
    it('should perform a diff between two local files', async () => {
      const file1 = '/allowed/file1.txt';
      const file2 = '/allowed/file2.txt';
      mockedFsOps.readFileAsString.mockResolvedValueOnce('Content of file1').mockResolvedValueOnce('Content of file2');
      
      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [file1, file2],
      };
      const result = await handleReadTool(params) as ReadTool.DiffResultSuccess;
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.diff_content).toBe('--- a/file1\n+++ b/file2\n');
        expect(result.sources_compared).toEqual([file1, file2]);
      }
      expect(mockedDiff.createPatch).toHaveBeenCalledWith('file1.txt', 'Content of file1', 'file2.txt', 'Content of file2', '', '', { context: 3 });
    });

    it('should throw error if diff sources are not two files', async () => {
        const params: ReadTool.DiffParams = {
            operation: 'diff',
            sources: [mockSourceFile] as any, // Invalid
        };
        await expect(handleReadTool(params)).rejects.toThrow(new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, 'Diff operation requires exactly two source file paths.'));
    });

    it('should throw error if diff sources include a URL', async () => {
        const params: ReadTool.DiffParams = {
            operation: 'diff',
            sources: [mockSourceFile, mockSourceUrl],
        };
        await expect(handleReadTool(params)).rejects.toThrow(new ConduitError(ErrorCode.ERR_INVALID_PARAMETER, 'Diff operation only supports local files, not URLs.'));
    });

    it('should return INVALID_PARAMETER error if sources array has more than two for diff op', async () => {
        const params: ReadTool.Parameters = { operation: 'diff', sources: ['s1', 's2', 's3'] };
        mockedReadOpsHandler.handleReadTool.mockResolvedValueOnce({
            status: 'error',
            error_code: ErrorCode.INVALID_PARAMETER,
            error_message: 'Diff operation requires exactly two sources'
        });
        const result = await handleReadTool(params);
        expect(result.status).toBe('error');
        expect(result.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(result.error_message).toBe('Diff operation requires exactly two sources');
    });
  });

  it('should throw error for invalid operation', async () => {
    const params = { operation: 'invalid_op', sources: ['s'] } as any;
    await expect(handleReadTool(params)).rejects.toThrow(new ConduitError(ErrorCode.ERR_UNKNOWN_OPERATION_ACTION));
  });
}); 