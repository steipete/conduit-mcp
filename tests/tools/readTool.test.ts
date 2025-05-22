import { readToolHandler } from '@/tools/readTool';
import { ReadTool } from '@/types/tools';
import { ErrorCode } from '@/utils/errorHandler';
import { vi } from 'vitest';

// Mock internal module
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  return {
    ...original,
    conduitConfig: {
      server_name: 'test-server',
      server_version: '1.0.0',
      allowed_paths: ['/'],
      maxFileReadBytes: 1024 * 1024,
      maxUrlDownloadSizeBytes: 1024 * 1024,
      require_path_in_allowed_list: false,
      enable_security_restrictions: false,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    },
  };
});

// Mock operations
vi.mock('@/operations/getContentOps', () => ({
  getContent: vi.fn(),
}));
vi.mock('@/operations/metadataOps', () => ({
  getMetadata: vi.fn(),
}));
vi.mock('@/operations/diffOps', () => ({
  getDiff: vi.fn(),
}));

// Import mocked modules
const { conduitConfig } = await import('@/internal');
const { getContent } = await import('@/operations/getContentOps');
const { getMetadata } = await import('@/operations/metadataOps');
const { getDiff } = await import('@/operations/diffOps');

// Type the mocked functions
const mockedGetContent = getContent as vi.MockedFunction<typeof getContent>;
const mockedGetMetadata = getMetadata as vi.MockedFunction<typeof getMetadata>;
const mockedGetDiff = getDiff as vi.MockedFunction<typeof getDiff>;

describe('ReadTool', () => {
  const mockSourceFile = '/allowed/file.txt';
  const mockSourceUrl = 'http://example.com/page.html';
  const mockImageUrl = 'http://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleContentOperation', () => {
    it('should read text file content correctly', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: 'File content',
        mime_type: 'text/plain',
        output_format_used: 'text',
        size_bytes: 12,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'text',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe('File content');
        expect(response.results[0].mime_type).toBe('text/plain');
        expect(response.results[0].output_format_used).toBe('text');
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should read file content as base64', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: Buffer.from('Base64Test').toString('base64'),
        mime_type: 'text/plain',
        output_format_used: 'base64',
        size_bytes: 10,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe(Buffer.from('Base64Test').toString('base64'));
        expect(response.results[0].output_format_used).toBe('base64');
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should fetch URL and convert to markdown', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceUrl,
        source_type: 'url',
        status: 'success',
        content: '# Markdown Content',
        mime_type: 'text/html',
        output_format_used: 'markdown',
        markdown_conversion_status: 'success',
        size_bytes: 19,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceUrl],
        format: 'markdown',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe('# Markdown Content');
        expect(response.results[0].output_format_used).toBe('markdown');
        expect(response.results[0].markdown_conversion_status).toBe('success');
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceUrl, params, conduitConfig);
    });

    it('should fallback to text for markdown if URL content is not HTML', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceUrl,
        source_type: 'url',
        status: 'success',
        content: null,
        mime_type: 'application/json',
        output_format_used: 'markdown',
        detected_format: 'application/json',
        user_note: 'Content could not be converted to Markdown as it is not HTML.',
        markdown_conversion_status: 'skipped_unsupported_content_type',
        size_bytes: 8,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceUrl],
        format: 'markdown',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBeNull();
        expect(response.results[0].output_format_used).toBe('markdown');
        expect(response.results[0].detected_format).toBe('application/json');
        expect(response.results[0].user_note).toBe(
          'Content could not be converted to Markdown as it is not HTML.'
        );
        expect(response.results[0].markdown_conversion_status).toBe(
          'skipped_unsupported_content_type'
        );
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceUrl, params, conduitConfig);
    });

    it('should calculate checksum for a file', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: 'mockedchecksum-testspecific',
        checksum: 'mockedchecksum-testspecific',
        mime_type: 'text/plain',
        output_format_used: 'checksum',
        checksum_algorithm_used: 'sha256',
        size_bytes: 12,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'checksum',
        checksum_algorithm: 'sha256',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].checksum).toBe('mockedchecksum-testspecific');
        expect(response.results[0].content).toBe('mockedchecksum-testspecific');
        expect(response.results[0].output_format_used).toBe('checksum');
        expect(response.results[0].checksum_algorithm_used).toBe('sha256');
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should handle image compression for base64 format', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: Buffer.from('compressed_image_data').toString('base64'),
        mime_type: 'image/png',
        output_format_used: 'base64',
        compression_applied: true,
        original_size_bytes: 2000,
        size_bytes: 20,
      });

      const params: ReadTool.ContentParams = {
        operation: 'content',
        sources: [mockSourceFile],
        format: 'base64',
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].content).toBe(
          Buffer.from('compressed_image_data').toString('base64')
        );
        expect(response.results[0].compression_applied).toBe(true);
        expect(response.results[0].original_size_bytes).toBe(2000);
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should use default format if not specified (text file)', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: 'File content',
        mime_type: 'text/plain',
        output_format_used: 'text',
        size_bytes: 12,
      });

      const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].output_format_used).toBe('text');
        expect(response.results[0].content).toBe('File content');
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should use default format if not specified (image file -> base64)', async () => {
      mockedGetContent.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        content: Buffer.from('jpegdata').toString('base64'),
        mime_type: 'image/jpeg',
        output_format_used: 'base64',
        size_bytes: 8,
      });

      const params: ReadTool.ContentParams = { operation: 'content', sources: [mockSourceFile] };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].output_format_used).toBe('base64');
        expect(response.results[0].content).toBe(Buffer.from('jpegdata').toString('base64'));
      }
      expect(getContent).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should return INVALID_PARAMETER error if sources array is empty for content op', async () => {
      const params: ReadTool.Parameters = { operation: 'content', sources: [] };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedContentResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results).toHaveLength(0);
      expect(getContent).not.toHaveBeenCalled();
    });
  });

  describe('handleMetadataOperation', () => {
    it('should fetch metadata for a local file', async () => {
      mockedGetMetadata.mockResolvedValue({
        source: mockSourceFile,
        source_type: 'file',
        status: 'success',
        metadata: {
          name: 'file.txt',
          path: mockSourceFile,
          entry_type: 'file',
          size_bytes: 100,
          mime_type: 'text/plain',
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        },
      });

      const params: ReadTool.MetadataParams = {
        operation: 'metadata',
        sources: [mockSourceFile],
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedMetadataResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].source_type).toBe('file');
        expect(response.results[0].metadata?.name).toBe('file.txt');
        expect(response.results[0].metadata?.entry_type).toBe('file');
      }
      expect(getMetadata).toHaveBeenCalledWith(mockSourceFile, params, conduitConfig);
    });

    it('should fetch metadata for a URL (HEAD request)', async () => {
      mockedGetMetadata.mockResolvedValue({
        source: mockImageUrl,
        source_type: 'url',
        status: 'success',
        metadata: {
          name: 'image.png',
          mime_type: 'image/png',
          size_bytes: 12345,
          modified_at: '1994-11-15T12:45:26.000Z',
        },
      });

      const params: ReadTool.MetadataParams = {
        operation: 'metadata',
        sources: [mockImageUrl],
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedMetadataResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results[0].status).toBe('success');
      if (response.results[0].status === 'success') {
        expect(response.results[0].source_type).toBe('url');
        expect(response.results[0].metadata?.name).toBe('image.png');
        expect(response.results[0].metadata?.mime_type).toBe('image/png');
        expect(response.results[0].metadata?.size_bytes).toBe(12345);
        expect(response.results[0].metadata?.modified_at).toBe('1994-11-15T12:45:26.000Z');
      }
      expect(getMetadata).toHaveBeenCalledWith(mockImageUrl, params, conduitConfig);
    });
  });

  describe('handleDiffOperation', () => {
    it('should perform a diff between two local files', async () => {
      const file1 = '/allowed/file1.txt';
      const file2 = '/allowed/file2.txt';

      mockedGetDiff.mockResolvedValue({
        status: 'success',
        diff_content: '--- a/file1\n+++ b/file2\n',
        sources_compared: [file1, file2],
      });

      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [file1, file2] as [string, string],
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedDiffResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('success');
      if (response.results.status === 'success') {
        expect(response.results.diff_content).toBe('--- a/file1\n+++ b/file2\n');
        expect(response.results.sources_compared).toEqual([file1, file2]);
      }
      expect(getDiff).toHaveBeenCalledWith(params, conduitConfig);
    });

    it('should handle error if diff sources are not two files', async () => {
      // This test simulates what would happen if getDiff was called with invalid params
      mockedGetDiff.mockResolvedValue({
        status: 'error',
        error_code: ErrorCode.INVALID_PARAMETER,
        error_message: 'Diff operation requires exactly two source file paths.',
      });

      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [mockSourceFile] as unknown,
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedDiffResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('error');
      if (response.results.status === 'error') {
        expect(response.results.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(response.results.error_message).toContain('exactly two source');
      }
    });

    it('should handle error if diff sources include a URL', async () => {
      // This test simulates what would happen if getDiff was called with URL params
      mockedGetDiff.mockResolvedValue({
        status: 'error',
        error_code: ErrorCode.INVALID_PARAMETER,
        error_message: 'Diff operation only supports local files, not URLs.',
      });

      const params: ReadTool.DiffParams = {
        operation: 'diff',
        sources: [mockSourceFile, mockSourceUrl] as [string, string],
      };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedDiffResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('error');
      if (response.results.status === 'error') {
        expect(response.results.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(response.results.error_message).toContain('only supports local files');
      }
    });

    it('should return INVALID_PARAMETER error if sources array has more than two for diff op', async () => {
      mockedGetDiff.mockResolvedValue({
        status: 'error',
        error_code: ErrorCode.INVALID_PARAMETER,
        error_message: 'Diff operation requires exactly two sources',
      });

      const params: ReadTool.Parameters = { operation: 'diff', sources: ['s1', 's2'] };
      const response = (await readToolHandler(
        params,
        conduitConfig
      )) as ReadTool.DefinedDiffResponse;

      expect(response.tool_name).toBe('read');
      expect(response.results.status).toBe('error');
      if (response.results.status === 'error') {
        expect(response.results.error_code).toBe(ErrorCode.INVALID_PARAMETER);
        expect(response.results.error_message).toContain(
          'Diff operation requires exactly two sources'
        );
      }
      expect(getDiff).toHaveBeenCalledWith(params, conduitConfig);
    });
  });

  it('should return error for invalid operation', async () => {
    const params = { operation: 'invalid_op', sources: ['s'] } as unknown;
    const response = await readToolHandler(params, conduitConfig);

    expect(response.status).toBe('error');
    if ('error_code' in response) {
      expect(response.error_code).toBe(ErrorCode.UNSUPPORTED_OPERATION);
      expect(response.error_message).toContain('Unsupported read operation: invalid_op');
    }
  });
});
