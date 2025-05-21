import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, Mock } from 'vitest';
import * as fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto'; // Import crypto for checksum calculation
import { getContent } from '../../src/operations/getContentOps'; // calculateChecksum is not exported
import { ConduitServerConfig } from '../../src/types/config';
import { ReadTool } from '../../src/types/tools';
import { ErrorCode } from '../../src/utils/errorHandler';
import { ቀላልWebServer } from '../testUtils/simpleWebServer.js'; // Changed to .js extension
import { createTemporaryDirectory, cleanupTemporaryDirectory } from '../testUtils/tempDirectory';
import { ConduitError } from '../../src/utils/errorHandler';

// Mock core modules that getContentOps depends on
vi.mock('../../src/core/webFetcher');
vi.mock('../../src/core/fileSystemOps');
vi.mock('../../src/core/mimeService');
vi.mock('../../src/core/imageProcessor');
vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(), // Mock child to return the same mock for chaining
  },
}));


// Default config for tests, aligned with ConduitServerConfig definition
const defaultConfig: ConduitServerConfig = {
  logLevel: 'INFO',
  allowedPaths: [], 
  httpTimeoutMs: 5000,
  maxPayloadSizeBytes: 1024 * 1024, // 1MB
  maxFileReadBytes: 1024 * 1024, // 1MB
  maxUrlDownloadBytes: 1024 * 1024, // 1MB
  imageCompressionThresholdBytes: 1024 * 50, // 50KB
  imageCompressionQuality: 80, 
  defaultChecksumAlgorithm: 'sha256',
  maxRecursiveDepth: 10,
  recursiveSizeTimeoutMs: 10000, // 10s
  serverStartTimeIso: new Date().toISOString(),
  serverVersion: "test-version-0.1.0",
};


describe('getContentOps - getContentFromFile', () => {
  let tempDir: string;
  let testConfig: ConduitServerConfig;
  let mockGetStats: Mock<any, any>, mockGetMimeType: Mock<any, any>, mockReadFileAsBuffer: Mock<any, any>, mockFsOpen: any;
  let mockCompressImageIfNecessary: Mock<any, any>; // Added for image tests

  beforeEach(async () => {
    tempDir = await createTemporaryDirectory();
    testConfig = { ...defaultConfig, allowedPaths: [tempDir] };

    const fsOps = await import('../../src/core/fileSystemOps');
    mockGetStats = fsOps.getStats as Mock<any, any>;
    mockReadFileAsBuffer = fsOps.readFileAsBuffer as Mock<any, any>;

    const mimeService = await import('../../src/core/mimeService');
    mockGetMimeType = mimeService.getMimeType as Mock<any, any>;
    
    const nodeFs = await import('fs/promises');
    mockFsOpen = vi.spyOn(nodeFs, 'open');

    const imageProcessor = await import('../../src/core/imageProcessor');
    mockCompressImageIfNecessary = imageProcessor.compressImageIfNecessary as Mock<any, any>;
  });

  afterEach(async () => {
    await cleanupTemporaryDirectory(tempDir);
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it('should read a simple text file', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    const fileContent = 'Hello, world!';
    const fileBuffer = Buffer.from(fileContent);
    await fs.writeFile(filePath, fileContent);

    mockGetStats.mockResolvedValue({ size: fileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain');
    mockReadFileAsBuffer.mockResolvedValue(fileBuffer);

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(filePath, params, testConfig);
    
    expect(result.status).toBe('success');
    if (result.status !== 'success') return; // Type guard
    expect(result.source).toBe(filePath);
    expect(result.source_type).toBe('file');
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(fileContent);
    expect(result.mime_type).toBe('text/plain');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should read a file as base64', async () => {
    const filePath = path.join(tempDir, 'test.bin');
    const fileContent = 'Binary data here';
    const fileBuffer = Buffer.from(fileContent);
    await fs.writeFile(filePath, fileContent);

    mockGetStats.mockResolvedValue({ size: fileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('application/octet-stream');
    mockReadFileAsBuffer.mockResolvedValue(fileBuffer);
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));


    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      format: 'base64',
    };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(fileBuffer.toString('base64'));
    expect(result.mime_type).toBe('application/octet-stream');
  });

  it('should calculate checksum (sha256) for a file', async () => {
    const filePath = path.join(tempDir, 'checksum_test.txt');
    const fileContent = 'Calculate my checksum!';
    const fileBuffer = Buffer.from(fileContent);
    await fs.writeFile(filePath, fileContent);

    mockGetStats.mockResolvedValue({ size: fileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain');
    mockReadFileAsBuffer.mockResolvedValue(fileBuffer);

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'sha256',
    };
    const result = await getContent(filePath, params, testConfig);

    const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('sha256');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should read a partial file (byte range)', async () => {
    const filePath = path.join(tempDir, 'range_test.txt');
    const fullFileContent = 'This is the full content for range testing.';
    const fullFileBuffer = Buffer.from(fullFileContent);
    await fs.writeFile(filePath, fullFileContent);

    const offset = 5;
    const length = 10;
    const expectedPartialContent = fullFileContent.substring(offset, offset + length);

    mockGetStats.mockResolvedValue({ size: fullFileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain');
    mockFsOpen.mockResolvedValue({
      read: vi.fn().mockImplementation((buffer, bufferOffset, len, pos) => {
        const slice = fullFileBuffer.subarray(pos, pos + len);
        slice.copy(buffer, bufferOffset);
        return Promise.resolve({ bytesRead: slice.length, buffer });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      format: 'text',
      offset,
      length,
    };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(expectedPartialContent);
    expect(result.size_bytes).toBe(Buffer.byteLength(expectedPartialContent, 'utf8'));
  });

  it('should handle an empty file correctly', async () => {
    const filePath = path.join(tempDir, 'empty.txt');
    await fs.writeFile(filePath, '');

    mockGetStats.mockResolvedValue({ size: 0, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain'); 
    mockReadFileAsBuffer.mockResolvedValue(Buffer.from('')); 
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));


    const paramsText: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'text' };
    const resultText = await getContent(filePath, paramsText, testConfig);
    expect(resultText.status).toBe('success');
    if (resultText.status === 'success') {
      expect(resultText.content).toBe('');
      expect(resultText.size_bytes).toBe(0);
    }

    const paramsBase64: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'base64' };
    const resultBase64 = await getContent(filePath, paramsBase64, testConfig);
    expect(resultBase64.status).toBe('success');
    if (resultBase64.status === 'success') {
      expect(resultBase64.content).toBe(''); 
      expect(resultBase64.size_bytes).toBe(0);
    }
    
    const paramsChecksum: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'checksum' };
    const resultChecksum = await getContent(filePath, paramsChecksum, testConfig);
    expect(resultChecksum.status).toBe('success');
    if (resultChecksum.status === 'success') {
      expect(resultChecksum.checksum).toBe(crypto.createHash('sha256').update('').digest('hex'));
      expect(resultChecksum.content).toBeUndefined();
      expect(resultChecksum.size_bytes).toBe(0);
    }
  });

  it('should return placeholder for binary file read as text', async () => {
    const filePath = path.join(tempDir, 'binary.dat');
    const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    await fs.writeFile(filePath, binaryData);

    mockGetStats.mockResolvedValue({ size: binaryData.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('application/octet-stream'); 
    mockReadFileAsBuffer.mockResolvedValue(binaryData);

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'text' };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe("[Binary content, request with format: 'base64' to view]");
    expect(result.mime_type).toBe('application/octet-stream');
  });

  it('should read image file, convert to base64, and apply mock compression', async () => {
    const filePath = path.join(tempDir, 'image.jpg');
    const originalImageBuffer = Buffer.from('file raw image data - original');
    const compressedImageBuffer = Buffer.from('file compressed image data');
    await fs.writeFile(filePath, originalImageBuffer);

    mockGetStats.mockResolvedValue({ size: originalImageBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('image/jpeg');
    mockReadFileAsBuffer.mockResolvedValue(originalImageBuffer);
    mockCompressImageIfNecessary.mockResolvedValue({
      buffer: compressedImageBuffer,
      original_size_bytes: originalImageBuffer.length,
      compression_applied: true,
    });

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'base64' };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCompressImageIfNecessary).toHaveBeenCalledWith(originalImageBuffer, 'image/jpeg');
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(compressedImageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/jpeg');
    expect(result.size_bytes).toBe(compressedImageBuffer.length);
    expect(result.original_size_bytes).toBe(originalImageBuffer.length);
    expect(result.compression_applied).toBe(true);
  });

  it('should read image file, convert to base64, no compression (e.g. too small)', async () => {
    const filePath = path.join(tempDir, 'small-image.png');
    const originalImageBuffer = Buffer.from('file small png data');
    await fs.writeFile(filePath, originalImageBuffer);

    mockGetStats.mockResolvedValue({ size: originalImageBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('image/png');
    mockReadFileAsBuffer.mockResolvedValue(originalImageBuffer);
    mockCompressImageIfNecessary.mockResolvedValue({
      buffer: originalImageBuffer,
      original_size_bytes: originalImageBuffer.length,
      compression_applied: false,
    });

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'base64' };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCompressImageIfNecessary).toHaveBeenCalledWith(originalImageBuffer, 'image/png');
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(originalImageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/png');
    expect(result.size_bytes).toBe(originalImageBuffer.length);
    expect(result.original_size_bytes).toBe(originalImageBuffer.length);
    expect(result.compression_applied).toBe(false);
  });

  it('should read HTML file and convert to markdown', async () => {
    const filePath = path.join(tempDir, 'page.html');
    const htmlContent = '<h1>File HTML</h1><p>Content here.</p>';
    const htmlBuffer = Buffer.from(htmlContent);
    const expectedMarkdown = '# File HTML\n\nContent here.';
    await fs.writeFile(filePath, htmlContent);

    mockGetStats.mockResolvedValue({ size: htmlBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/html');
    mockReadFileAsBuffer.mockResolvedValue(htmlBuffer);
    const webFetcher = await import('../../src/core/webFetcher');
    (webFetcher.cleanHtmlToMarkdown as Mock<any, any>).mockReturnValue(expectedMarkdown);

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'markdown' };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(webFetcher.cleanHtmlToMarkdown).toHaveBeenCalledWith(htmlContent, `file://${filePath}`);
    expect(result.output_format_used).toBe('markdown');
    expect(result.content).toBe(expectedMarkdown);
    expect(result.mime_type).toBe('text/html');
    expect(result.markdown_conversion_status).toBe('success');
  });

  it('should read non-HTML file and fallback to text when markdown is requested', async () => {
    const filePath = path.join(tempDir, 'document.txt');
    const textContent = 'Plain text file, not HTML.';
    const textBuffer = Buffer.from(textContent);
    await fs.writeFile(filePath, textContent);

    mockGetStats.mockResolvedValue({ size: textBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain');
    mockReadFileAsBuffer.mockResolvedValue(textBuffer);
    const webFetcher = await import('../../src/core/webFetcher');

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'markdown' };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(webFetcher.cleanHtmlToMarkdown).not.toHaveBeenCalled();
    expect(result.output_format_used).toBe('text'); 
    expect(result.content).toBe(textContent);
    expect(result.mime_type).toBe('text/plain');
    expect(result.markdown_conversion_status).toBe('skipped_unsupported_content_type');
    expect(result.markdown_conversion_skipped_reason).toBe('Original Content-Type \'text/plain\' is not suitable for Markdown conversion; returning raw content.');
  });

  it('should handle file not found', async () => {
    const nonExistentFilePath = path.join(tempDir, 'this-file-does-not-exist.txt');
    
    const enoentError = new Error(`File not found: ${nonExistentFilePath}`);
    // @ts-ignore 
    enoentError.code = 'ENOENT'; 
    mockGetStats.mockRejectedValue(enoentError);

    const params: ReadTool.ContentParams = { sources: [nonExistentFilePath], operation: 'content', format: 'text' };
    const result = await getContent(nonExistentFilePath, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(nonExistentFilePath);
    expect(result.source_type).toBe('file');
    expect(result.error_code).toBe(ErrorCode.ERR_FS_NOT_FOUND);
    expect(result.error_message).toContain(`File not found: ${nonExistentFilePath}`);
  });

  it('should handle access denied for a file', async () => {
    const restrictedFilePath = path.join(tempDir, 'restricted-file.txt');
    await fs.writeFile(restrictedFilePath, 'secret content'); 

    const eaccesError = new Error(`Permission denied: ${restrictedFilePath}`);
    // @ts-ignore
    eaccesError.code = 'EACCES'; 
    mockGetStats.mockRejectedValue(eaccesError);

    const params: ReadTool.ContentParams = { sources: [restrictedFilePath], operation: 'content', format: 'text' };
    const result = await getContent(restrictedFilePath, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(restrictedFilePath);
    expect(result.source_type).toBe('file');
    expect(result.error_code).toBe(ErrorCode.ERR_FS_ACCESS_DENIED);
    expect(result.error_message).toContain(`Permission denied to access file: ${restrictedFilePath}`);
  });

  it('should return error when attempting to read a directory', async () => {
    const directoryPath = path.join(tempDir, 'a-directory');
    await fs.mkdir(directoryPath); 

    mockGetStats.mockResolvedValue({ size: 0, isDirectory: () => true });

    const params: ReadTool.ContentParams = { sources: [directoryPath], operation: 'content', format: 'text' };
    const result = await getContent(directoryPath, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(directoryPath);
    expect(result.source_type).toBe('file'); 
    expect(result.error_code).toBe(ErrorCode.ERR_FS_IS_DIRECTORY);
    expect(result.error_message).toContain(`Path is a directory, not a file: ${directoryPath}`);
  });

  it('should handle max file read bytes exceeded', async () => {
    const filePath = path.join(tempDir, 'large-file.txt');
    const actualFileSize = 200;
    const smallMaxBytes = 100;
    await fs.writeFile(filePath, 'a'.repeat(actualFileSize)); 

    mockGetStats.mockResolvedValue({ size: actualFileSize, isDirectory: () => false });

    const params: ReadTool.ContentParams = { sources: [filePath], operation: 'content', format: 'text' };
    const configForSizeTest = { ...testConfig, maxFileReadBytes: smallMaxBytes };
    const result = await getContent(filePath, params, configForSizeTest);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(filePath);
    expect(result.source_type).toBe('file');
    expect(result.error_code).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
    expect(result.error_message).toContain(`File size (${actualFileSize} bytes) exceeds maximum allowed read size (${smallMaxBytes} bytes) for ${filePath}`);
    expect(mockReadFileAsBuffer).not.toHaveBeenCalled();
  });

  it('should default to text format for a text-like file when format is omitted', async () => {
    const filePath = path.join(tempDir, 'default-text.txt');
    const fileContent = 'This is a text file for default format testing.';
    const fileBuffer = Buffer.from(fileContent);
    await fs.writeFile(filePath, fileContent);

    mockGetStats.mockResolvedValue({ size: fileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('text/plain'); // Text-like MIME
    mockReadFileAsBuffer.mockResolvedValue(fileBuffer);

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(filePath, params, testConfig);
    
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(fileContent);
    expect(result.mime_type).toBe('text/plain');
  });

  it('should default to base64 format for a binary file when format is omitted', async () => {
    const filePath = path.join(tempDir, 'default-binary.dat');
    const fileContent = 'BinaryData';
    const fileBuffer = Buffer.from(fileContent);
    await fs.writeFile(filePath, fileBuffer);

    mockGetStats.mockResolvedValue({ size: fileBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('application/octet-stream'); // Non-text-like MIME
    mockReadFileAsBuffer.mockResolvedValue(fileBuffer);
    // Mock image processor if it were an image, though here it's generic binary
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(fileBuffer.toString('base64'));
    expect(result.mime_type).toBe('application/octet-stream');
  });

  it('should default to base64 format for an image file when format is omitted (no compression)', async () => {
    const filePath = path.join(tempDir, 'default-image.png');
    const imageBuffer = Buffer.from('fake-png-data-for-default-test');
    await fs.writeFile(filePath, imageBuffer);

    mockGetStats.mockResolvedValue({ size: imageBuffer.length, isDirectory: () => false });
    mockGetMimeType.mockResolvedValue('image/png'); // Image MIME
    mockReadFileAsBuffer.mockResolvedValue(imageBuffer);
    mockCompressImageIfNecessary.mockResolvedValue({
      buffer: imageBuffer, // No compression applied in this scenario (e.g., under threshold)
      original_size_bytes: imageBuffer.length,
      compression_applied: false,
    });

    const params: ReadTool.ContentParams = {
      sources: [filePath],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(filePath, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(imageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/png');
    expect(result.compression_applied).toBe(false);
  });

});

describe('getContentOps - getContentFromUrl', () => {
  let server: ቀላልWebServer;
  const testServerPort = 3008; 
  const testServerBaseUrl = `http://localhost:${testServerPort}`;
  let testConfig: ConduitServerConfig;
  let mockFetchUrlContent: Mock<any, any>, mockCleanHtmlToMarkdown: Mock<any, any>, mockCompressImageIfNecessary: Mock<any, any>;


  beforeAll(async () => {
    const webServerModule = await import('../testUtils/simpleWebServer.js');
    server = new webServerModule.ቀላልWebServer();
    await server.start(testServerPort);
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    testConfig = { ...defaultConfig }; 
    server.clearRoutes();

    const webFetcher = await import('../../src/core/webFetcher');
    mockFetchUrlContent = webFetcher.fetchUrlContent as Mock<any, any>;
    mockCleanHtmlToMarkdown = webFetcher.cleanHtmlToMarkdown as Mock<any, any>;

    const imageProcessor = await import('../../src/core/imageProcessor');
    mockCompressImageIfNecessary = imageProcessor.compressImageIfNecessary as Mock<any, any>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch a simple text URL', async () => {
    const urlPath = '/test.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'Hello from URL!';
    const fileBuffer = Buffer.from(fileContent);
    
    server.setContent(urlPath, fileBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source).toBe(fullTestUrl);
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(fileContent);
    expect(result.mime_type).toBe('text/plain');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should fetch URL content as base64', async () => {
    const urlPath = '/test-base64.bin';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'URL Binary data';
    const fileBuffer = Buffer.from(fileContent);

    server.setContent(urlPath, fileBuffer, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'application/octet-stream', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));


    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(fileBuffer.toString('base64'));
    expect(result.mime_type).toBe('application/octet-stream');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should calculate checksum (sha256) for URL content', async () => {
    const urlPath = '/test-checksum.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'URL content for checksum';
    const fileBuffer = Buffer.from(fileContent);

    server.setContent(urlPath, fileBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'sha256',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('sha256');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should handle native byte range request for URL (text)', async () => {
    const urlPath = '/test-range-native.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full content for native range testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const expectedPartialContent = fullContent.substring(offset, offset + length);
    const partialBuffer = Buffer.from(expectedPartialContent);

    server.setContent(urlPath, partialBuffer, 'text/plain', 'GET', {
      'accept-ranges': 'bytes',
      'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`
    }, 206);

    mockFetchUrlContent.mockResolvedValue({
      content: partialBuffer, 
      headers: { 
        'content-type': 'text/plain', 
        'content-length': partialBuffer.length.toString(),
        'accept-ranges': 'bytes',
        'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`
      },
      httpStatus: 206, 
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(expectedPartialContent);
    expect(result.range_request_status).toBe('native');
    expect(result.size_bytes).toBe(partialBuffer.length);
  });

  it('should simulate byte range request for URL if server does not support it (text)', async () => {
    const urlPath = '/test-range-simulated.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full content for simulated range testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const expectedPartialContent = fullContent.substring(offset, offset + length);
    
    server.setContent(urlPath, fullBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValueOnce({
      content: fullBuffer, 
      headers: { 
        'content-type': 'text/plain', 
        'content-length': fullBuffer.length.toString()
      },
      httpStatus: 200, 
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
      offset,
      length,
    };
    
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(expectedPartialContent);
    expect(result.range_request_status).toBe('simulated');
    expect(result.size_bytes).toBe(Buffer.byteLength(expectedPartialContent, 'utf8'));
  });

  it('should handle full content returned when range requested and truncate (text)', async () => {
    const urlPath = '/test-range-full.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'Server returned full content despite range request.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const expectedPartialContent = fullContent.substring(offset, offset + length);

    server.setContent(urlPath, fullBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValue({
      content: fullBuffer, 
      headers: { 
        'content-type': 'text/plain', 
        'content-length': fullBuffer.length.toString(),
      },
      httpStatus: 200, 
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);
    
    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.source_type).toBe('url');
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(expectedPartialContent);
    expect(result.range_request_status).toBe('simulated');
    expect(result.size_bytes).toBe(Buffer.byteLength(expectedPartialContent, 'utf8'));
  });

  it('should handle native byte range request for URL (base64)', async () => {
    const urlPath = '/test-range-native.bin';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full binary for native range testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));

    server.setContent(urlPath, partialBuffer, 'application/octet-stream', 'GET', {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`
    }, 206);

    mockFetchUrlContent.mockResolvedValue({
      content: partialBuffer,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': partialBuffer.length.toString(),
        'accept-ranges': 'bytes',
        'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`,
      },
      httpStatus: 206,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);
    
    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(partialBuffer.toString('base64'));
    expect(result.range_request_status).toBe('native');
    expect(result.size_bytes).toBe(partialBuffer.length);
  });

  it('should simulate byte range request for URL (base64)', async () => {
    const urlPath = '/test-range-simulated.bin';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full binary for simulated range testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));

    server.setContent(urlPath, fullBuffer, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: fullBuffer, 
      headers: { 'content-type': 'application/octet-stream', 'content-length': fullBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);
    
    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(partialBuffer.toString('base64'));
    expect(result.range_request_status).toBe('simulated');
    expect(result.size_bytes).toBe(partialBuffer.length);
  });

  it('should handle full content returned when range requested for URL (base64)', async () => {
    const urlPath = '/test-range-full.bin';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'Server returned full binary despite range request.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));

    server.setContent(urlPath, fullBuffer, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: fullBuffer,
      headers: { 'content-type': 'application/octet-stream', 'content-length': fullBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });
    mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);
    
    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(partialBuffer.toString('base64'));
    expect(result.range_request_status).toBe('simulated');
    expect(result.size_bytes).toBe(partialBuffer.length);
  });

  it('should handle native byte range request for URL (checksum)', async () => {
    const urlPath = '/test-range-native-checksum.dat';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full data for native range checksum testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));
    const expectedChecksum = crypto.createHash('sha256').update(partialBuffer).digest('hex');

    server.setContent(urlPath, partialBuffer, 'application/octet-stream', 'GET', {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`
    }, 206);

    mockFetchUrlContent.mockResolvedValue({
      content: partialBuffer,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': partialBuffer.length.toString(),
        'accept-ranges': 'bytes',
        'content-range': `bytes ${offset}-${offset + length - 1}/${fullBuffer.length}`,
      },
      httpStatus: 206,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'sha256',
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('sha256');
    expect(result.range_request_status).toBe('native');
    expect(result.size_bytes).toBe(partialBuffer.length);
    expect(result.content).toBeUndefined();
  });

  it('should simulate byte range request for URL (checksum)', async () => {
    const urlPath = '/test-range-simulated-checksum.dat';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'This is the full data for simulated range checksum testing.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));
    const expectedChecksum = crypto.createHash('md5').update(partialBuffer).digest('hex');

    server.setContent(urlPath, fullBuffer, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: fullBuffer, 
      headers: { 'content-type': 'application/octet-stream', 'content-length': fullBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'md5', 
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('md5');
    expect(result.range_request_status).toBe('simulated'); 
    expect(result.size_bytes).toBe(partialBuffer.length);
    expect(result.content).toBeUndefined();
  });

  it('should handle full content returned when range requested for URL (checksum)', async () => {
    const urlPath = '/test-range-full-checksum.dat';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fullContent = 'Server returned full data despite range request for checksum.';
    const fullBuffer = Buffer.from(fullContent);
    const offset = 5;
    const length = 10;
    const partialBuffer = Buffer.from(fullContent.substring(offset, offset + length));
    const expectedChecksum = crypto.createHash('sha1').update(partialBuffer).digest('hex');

    server.setContent(urlPath, fullBuffer, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: fullBuffer,
      headers: { 'content-type': 'application/octet-stream', 'content-length': fullBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'sha1', 
      offset,
      length,
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(mockFetchUrlContent).toHaveBeenCalledWith(fullTestUrl, false, `bytes=${offset}-${offset + length - 1}`);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('sha1');
    expect(result.range_request_status).toBe('simulated');
    expect(result.size_bytes).toBe(partialBuffer.length);
    expect(result.content).toBeUndefined();
  });

  it('should fetch image URL, convert to base64, and apply mock compression', async () => {
    const urlPath = '/test-image.jpg';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const originalImageBuffer = Buffer.from('raw image data - original');
    const compressedImageBuffer = Buffer.from('compressed image data');

    server.setContent(urlPath, originalImageBuffer, 'image/jpeg');

    mockFetchUrlContent.mockResolvedValue({
      content: originalImageBuffer,
      headers: { 'content-type': 'image/jpeg', 'content-length': originalImageBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'image/jpeg',
    });

    mockCompressImageIfNecessary.mockResolvedValue({
      buffer: compressedImageBuffer,
      original_size_bytes: originalImageBuffer.length,
      compression_applied: true,
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCompressImageIfNecessary).toHaveBeenCalledWith(originalImageBuffer, 'image/jpeg');
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(compressedImageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/jpeg');
    expect(result.size_bytes).toBe(compressedImageBuffer.length);
    expect(result.original_size_bytes).toBe(originalImageBuffer.length);
    expect(result.compression_applied).toBe(true);
  });

  it('should fetch image URL, convert to base64, no compression applied (e.g. too small)', async () => {
    const urlPath = '/test-small-image.png';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const originalImageBuffer = Buffer.from('small png data'); 

    server.setContent(urlPath, originalImageBuffer, 'image/png');

    mockFetchUrlContent.mockResolvedValue({
      content: originalImageBuffer,
      headers: { 'content-type': 'image/png', 'content-length': originalImageBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'image/png',
    });

    mockCompressImageIfNecessary.mockResolvedValue({
      buffer: originalImageBuffer, 
      original_size_bytes: originalImageBuffer.length,
      compression_applied: false,
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCompressImageIfNecessary).toHaveBeenCalledWith(originalImageBuffer, 'image/png');
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(originalImageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/png');
    expect(result.size_bytes).toBe(originalImageBuffer.length);
    expect(result.original_size_bytes).toBe(originalImageBuffer.length);
    expect(result.compression_applied).toBe(false);
  });

  it('should fetch HTML URL and convert to markdown', async () => {
    const urlPath = '/test-page.html';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const htmlContent = '<h1>Hello World</h1><p>This is HTML.</p>';
    const htmlBuffer = Buffer.from(htmlContent);
    const expectedMarkdown = '# Hello World\n\nThis is HTML.';

    server.setContent(urlPath, htmlBuffer, 'text/html; charset=utf-8');

    mockFetchUrlContent.mockResolvedValue({
      content: htmlBuffer,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': htmlBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/html',
    });

    mockCleanHtmlToMarkdown.mockReturnValue(expectedMarkdown);

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'markdown',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCleanHtmlToMarkdown).toHaveBeenCalledWith(htmlContent, fullTestUrl);
    expect(result.output_format_used).toBe('markdown');
    expect(result.content).toBe(expectedMarkdown);
    expect(result.mime_type).toBe('text/html');
    expect(result.markdown_conversion_status).toBe('success');
  });

  it('should fetch non-HTML URL and fallback to text when markdown is requested', async () => {
    const urlPath = '/test-plain.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const textContent = 'This is plain text, not HTML.';
    const textBuffer = Buffer.from(textContent);

    server.setContent(urlPath, textBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValue({
      content: textBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': textBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'markdown', 
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCleanHtmlToMarkdown).not.toHaveBeenCalled();
    expect(result.output_format_used).toBe('text'); 
    expect(result.content).toBe(textContent);
    expect(result.mime_type).toBe('text/plain');
    expect(result.markdown_conversion_status).toBe('skipped_unsupported_content_type');
    expect(result.markdown_conversion_skipped_reason).toBe('Original Content-Type \'text/plain\' is not suitable for Markdown conversion; returning raw content.');
  });

  it('should handle URL not found (404 error)', async () => {
    const urlPath = '/non-existent-page.html';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;

    // Server will naturally 404 if route not set by setContent

    const httpError = new ConduitError(ErrorCode.ERR_HTTP_STATUS_ERROR, `Request to ${fullTestUrl} failed with HTTP status 404. Message: Not Found`);
    // @ts-ignore 
    httpError.httpStatus = 404;
    mockFetchUrlContent.mockRejectedValue(httpError);

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(fullTestUrl);
    expect(result.source_type).toBe('url');
    expect(result.error_code).toBe(ErrorCode.ERR_HTTP_STATUS_ERROR);
    expect(result.error_message).toContain('Request to http://localhost:3008/non-existent-page.html failed with HTTP status 404');
    expect(result.http_status_code).toBe(404);
  });

  it('should handle a generic connection error for URL', async () => {
    const urlPath = '/unreachable-resource';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;

    const connectionError = new ConduitError(ErrorCode.ERR_HTTP_REQUEST_FAILED, `No response received from ${fullTestUrl}. Error: ECONNREFUSED`);
    mockFetchUrlContent.mockRejectedValue(connectionError);

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(fullTestUrl);
    expect(result.source_type).toBe('url');
    expect(result.error_code).toBe(ErrorCode.ERR_HTTP_REQUEST_FAILED);
    expect(result.error_message).toContain('No response received from http://localhost:3008/unreachable-resource. Error: ECONNREFUSED');
    expect(result.http_status_code).toBeUndefined(); 
  });

  it('should handle max URL download bytes exceeded', async () => {
    const urlPath = '/large-file.dat';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const smallMaxBytes = 50;
    const actualSize = 100;

    const sizeError = new ConduitError(
      ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED, 
      `URL content size (${actualSize} bytes) exceeds maximum allowed download size (${smallMaxBytes} bytes) for ${fullTestUrl}.`
    );
    mockFetchUrlContent.mockRejectedValue(sizeError);

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'base64',
    };
    const configForSizeTest = { ...testConfig, maxUrlDownloadBytes: smallMaxBytes };
    const result = await getContent(fullTestUrl, params, configForSizeTest);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(fullTestUrl);
    expect(result.source_type).toBe('url');
    expect(result.error_code).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED);
    expect(result.error_message).toContain(`URL content size (${actualSize} bytes) exceeds maximum allowed download size (${smallMaxBytes} bytes)`);
  });

  it('should handle request timeout for URL', async () => {
    const urlPath = '/timeout-resource';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const timeoutMs = testConfig.httpTimeoutMs; 

    const timeoutError = new ConduitError(
      ErrorCode.ERR_HTTP_TIMEOUT, 
      `Request to ${fullTestUrl} timed out after ${timeoutMs}ms.`
    );
    mockFetchUrlContent.mockRejectedValue(timeoutError);

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.source).toBe(fullTestUrl);
    expect(result.source_type).toBe('url');
    expect(result.error_code).toBe(ErrorCode.ERR_HTTP_TIMEOUT);
    expect(result.error_message).toContain(`Request to ${fullTestUrl} timed out after ${timeoutMs}ms.`);
  });

  it('should correctly report final URL after redirect', async () => {
    const initialUrlPath = '/redirecting-resource';
    const finalUrlPath = '/final-destination';
    const initialFullTestUrl = `${testServerBaseUrl}${initialUrlPath}`;
    const finalFullTestUrl = `${testServerBaseUrl}${finalUrlPath}`;
    const fileContent = 'Redirected content';
    const fileBuffer = Buffer.from(fileContent);

    // Mock server will not be directly hit in this version as fetchUrlContent is fully mocked
    // server.setContent(finalUrlPath, fileBuffer, 'text/plain'); 
    // server.setContent(initialUrlPath, '', 'text/plain', 'GET', { 'Location': finalFullTestUrl }, 302);

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: finalFullTestUrl, 
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [initialFullTestUrl], 
      operation: 'content',
      format: 'text',
    };
    const result = await getContent(initialFullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockFetchUrlContent).toHaveBeenCalledWith(initialFullTestUrl, false, undefined);
    expect(result.source).toBe(finalFullTestUrl); 
    expect(result.content).toBe(fileContent);
  });

  it('should handle missing Content-Type header from URL (default to octet-stream)', async () => {
    const urlPath = '/missing-content-type';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'Some data with no content type.';
    const fileBuffer = Buffer.from(fileContent);

    server.setContent(urlPath, fileBuffer, '', 'GET', {'content-length': fileBuffer.length.toString()}); // Empty content type

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-length': fileBuffer.length.toString() }, 
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: undefined, 
    });

    const params: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'text' };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.mime_type).toBe('application/octet-stream'); 
    expect(result.content).toBe(fileContent);
  });

  it('should handle unusual Content-Type (e.g., application/xml) and fallback to text for markdown request', async () => {
    const urlPath = '/document.xml';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const xmlContent = '<root><item>Test</item></root>';
    const xmlBuffer = Buffer.from(xmlContent);

    server.setContent(urlPath, xmlBuffer, 'application/xml');

    mockFetchUrlContent.mockResolvedValue({
      content: xmlBuffer,
      headers: { 'content-type': 'application/xml', 'content-length': xmlBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/xml',
    });

    const params: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'markdown' };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(mockCleanHtmlToMarkdown).not.toHaveBeenCalled();
    expect(result.output_format_used).toBe('text'); 
    expect(result.content).toBe(xmlContent);
    expect(result.mime_type).toBe('application/xml');
    expect(result.markdown_conversion_status).toBe('skipped_unsupported_content_type');
    expect(result.markdown_conversion_skipped_reason).toBe('Original Content-Type \'application/xml\' is not suitable for Markdown conversion; returning raw content.');
  });

  it('should handle empty URL content correctly (text, base64, checksum)', async () => {
    const urlPath = '/empty-resource';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const emptyBuffer = Buffer.from('');

    // Common mock setup for all empty content tests
    const setupMockForEmpty = (mimeType: string = 'text/plain') => {
      server.setContent(urlPath, emptyBuffer, mimeType, 'GET', {'content-length': '0'});
      mockFetchUrlContent.mockResolvedValue({
        content: emptyBuffer,
        headers: { 'content-type': mimeType, 'content-length': '0' },
        httpStatus: 200,
        finalUrl: fullTestUrl,
        mimeType,
      });
      // For base64, if it were an image, compression would be called
      mockCompressImageIfNecessary.mockImplementation(async (buffer: Buffer) => ({ buffer, original_size_bytes: buffer.length, compression_applied: false }));
    };

    // Test for format: 'text'
    setupMockForEmpty('text/plain');
    const paramsText: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'text' };
    const resultText = await getContent(fullTestUrl, paramsText, testConfig);
    expect(resultText.status).toBe('success');
    if (resultText.status === 'success') {
      expect(resultText.content).toBe('');
      expect(resultText.size_bytes).toBe(0);
      expect(resultText.mime_type).toBe('text/plain');
    }

    // Test for format: 'base64'
    setupMockForEmpty('application/octet-stream'); 
    const paramsBase64: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'base64' };
    const resultBase64 = await getContent(fullTestUrl, paramsBase64, testConfig);
    expect(resultBase64.status).toBe('success');
    if (resultBase64.status === 'success') {
      expect(resultBase64.content).toBe(''); 
      expect(resultBase64.size_bytes).toBe(0);
      expect(resultBase64.mime_type).toBe('application/octet-stream');
    }

    // Test for format: 'checksum'
    setupMockForEmpty('text/plain');
    const paramsChecksum: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'checksum', checksum_algorithm: 'sha256' };
    const resultChecksum = await getContent(fullTestUrl, paramsChecksum, testConfig);
    expect(resultChecksum.status).toBe('success');
    if (resultChecksum.status === 'success') {
      expect(resultChecksum.checksum).toBe(crypto.createHash('sha256').update('').digest('hex'));
      expect(resultChecksum.checksum_algorithm_used).toBe('sha256');
      expect(resultChecksum.size_bytes).toBe(0);
      expect(resultChecksum.content).toBeUndefined();
      expect(resultChecksum.mime_type).toBe('text/plain');
    }
  });

  it('should return placeholder for binary URL read as text', async () => {
    const urlPath = '/binary-url.dat';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const binaryData = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);

    server.setContent(urlPath, binaryData, 'application/octet-stream');

    mockFetchUrlContent.mockResolvedValue({
      content: binaryData,
      headers: { 'content-type': 'application/octet-stream', 'content-length': binaryData.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/octet-stream', 
    });

    const params: ReadTool.ContentParams = { sources: [fullTestUrl], operation: 'content', format: 'text' };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe("[Binary content, request with format: 'base64' to view]");
    expect(result.mime_type).toBe('application/octet-stream');
    expect(result.size_bytes).toBe(binaryData.length);
  });

  it('should calculate SHA512 checksum for URL content', async () => {
    const urlPath = '/test-sha512-checksum.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'URL content for SHA512 checksum';
    const fileBuffer = Buffer.from(fileContent);

    server.setContent(urlPath, fileBuffer, 'text/plain');

    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      format: 'checksum',
      checksum_algorithm: 'sha512',
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    const expectedChecksum = crypto.createHash('sha512').update(fileContent).digest('hex');

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('checksum');
    expect(result.checksum).toBe(expectedChecksum);
    expect(result.checksum_algorithm_used).toBe('sha512');
    expect(result.size_bytes).toBe(fileBuffer.length);
  });

  it('should default to text format for a text/plain URL when format is omitted', async () => {
    const urlPath = '/default-text-url.txt';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const fileContent = 'URL content, should default to text.';
    const fileBuffer = Buffer.from(fileContent);

    server.setContent(urlPath, fileBuffer, 'text/plain');
    mockFetchUrlContent.mockResolvedValue({
      content: fileBuffer,
      headers: { 'content-type': 'text/plain', 'content-length': fileBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'text/plain',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(fileContent);
    expect(result.mime_type).toBe('text/plain');
  });

  it('should default to base64 format for an image URL when format is omitted (no compression)', async () => {
    const urlPath = '/default-image-url.jpg';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const imageBuffer = Buffer.from('fake-jpg-url-data');

    server.setContent(urlPath, imageBuffer, 'image/jpeg');
    mockFetchUrlContent.mockResolvedValue({
      content: imageBuffer,
      headers: { 'content-type': 'image/jpeg', 'content-length': imageBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'image/jpeg',
    });
    mockCompressImageIfNecessary.mockResolvedValue({ // Assume no compression for simplicity here
      buffer: imageBuffer,
      original_size_bytes: imageBuffer.length,
      compression_applied: false,
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('base64');
    expect(result.content).toBe(imageBuffer.toString('base64'));
    expect(result.mime_type).toBe('image/jpeg');
    expect(result.compression_applied).toBe(false);
  });
  
  it('should default to text format for an application/json URL when format is omitted', async () => {
    const urlPath = '/default-json-url.json';
    const fullTestUrl = `${testServerBaseUrl}${urlPath}`;
    const jsonContent = '{"key": "value", "message": "JSON data, should default to text"}';
    const jsonBuffer = Buffer.from(jsonContent);

    server.setContent(urlPath, jsonBuffer, 'application/json');
    mockFetchUrlContent.mockResolvedValue({
      content: jsonBuffer,
      headers: { 'content-type': 'application/json', 'content-length': jsonBuffer.length.toString() },
      httpStatus: 200,
      finalUrl: fullTestUrl,
      mimeType: 'application/json',
    });

    const params: ReadTool.ContentParams = {
      sources: [fullTestUrl],
      operation: 'content',
      // format is omitted
    };
    const result = await getContent(fullTestUrl, params, testConfig);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output_format_used).toBe('text');
    expect(result.content).toBe(jsonContent);
    expect(result.mime_type).toBe('application/json');
  });

});

// Test utility files (assume they will be created in tests/testUtils/)
// tests/testUtils/simpleWebServer.ts
// tests/testUtils/tempDirectory.ts 