import { vi, Mocked } from 'vitest';
import { compressImageIfNecessary } from '@/core/imageProcessor';
// import { conduitConfig } from '@/core/configLoader'; // Mocked
import sharp from 'sharp';
import logger from '@/utils/logger';

// Mock sharp
vi.mock('sharp');
// The default export of 'sharp' is a function that returns a Sharp instance.
// So, we mock that function.
const mockedSharp = sharp as Mocked<typeof sharp>;

// Mock logger
vi.mock('@/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

// Mock configLoader - avoid top-level variables in factory to prevent hoisting issues
vi.mock('@/core/configLoader', () => {
  const mockConfig = {
    imageCompressionThresholdBytes: 1024, // 1KB
    imageCompressionQuality: 75,
    // Add other minimal required config properties if any are used
    logLevel: 'INFO', // Example of other required properties
    allowedPaths: [],
    httpTimeoutMs: 1000,
    maxPayloadSizeBytes: 1000,
    maxFileReadBytes: 1000,
    maxUrlDownloadBytes: 1000,
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 10,
    recursiveSizeTimeoutMs: 60000,
    serverStartTimeIso: new Date().toISOString(),
    serverVersion: '1.0.0-test',
  };

  return {
    conduitConfig: mockConfig,
    loadConfig: () => mockConfig,
  };
});

// Define constants for use in tests
const mockCompressionThreshold = 1024; // 1KB
const mockCompressionQuality = 75;

describe('imageProcessor', () => {
  let mockSharpInstance: {
    jpeg: vi.MockedFunction<(options?: sharp.JpegOptions) => any>;
    png: vi.MockedFunction<(options?: sharp.PngOptions) => any>;
    webp: vi.MockedFunction<(options?: sharp.WebpOptions) => any>;
    tiff: vi.MockedFunction<(options?: sharp.TiffOptions) => any>;
    gif: vi.MockedFunction<(options?: sharp.GifOptions) => any>;
    avif: vi.MockedFunction<(options?: sharp.AvifOptions) => any>;
    toBuffer: vi.MockedFunction<() => Promise<Buffer>>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSharpInstance = {
      jpeg: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      tiff: vi.fn().mockReturnThis(),
      gif: vi.fn().mockReturnThis(),
      avif: vi.fn().mockReturnThis(),
      toBuffer: vi.fn(),
    };
    // Configure the mocked sharp function to return our mockSharpInstance
    (mockedSharp as unknown as import('vitest').Mock).mockReturnValue(mockSharpInstance as unknown); // Use `as unknown` to satisfy complex Sharp type if needed for mock
  });

  const createDummyImageBuffer = (size: number, content: string = 'a') =>
    Buffer.alloc(size, content);

  it('should not compress if image size is below threshold', async () => {
    const imageBuffer = createDummyImageBuffer(mockCompressionThreshold - 1);
    const result = await compressImageIfNecessary(imageBuffer, 'image/jpeg');

    expect(result.buffer).toBe(imageBuffer);
    expect(result.compression_applied).toBe(false);
    expect(result.original_size_bytes).toBe(imageBuffer.length);
    expect(mockedSharp).not.toHaveBeenCalled();
  });

  it('should not attempt compression for non-image MIME types', async () => {
    const buffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const result = await compressImageIfNecessary(buffer, 'application/pdf');
    expect(result.buffer).toBe(buffer);
    expect(result.compression_applied).toBe(false);
    expect(mockedSharp).not.toHaveBeenCalled();
  });

  it('should not attempt compression for unsupported image MIME types by sharp config', async () => {
    const buffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const result = await compressImageIfNecessary(buffer, 'image/bmp');
    expect(result.buffer).toBe(buffer);
    expect(result.compression_applied).toBe(false);
    expect(mockedSharp).not.toHaveBeenCalled();
  });

  it('should compress JPEG if above threshold and save reduction', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const compressedBuffer = createDummyImageBuffer(mockCompressionThreshold - 100, 'b');
    mockSharpInstance.toBuffer.mockResolvedValue(compressedBuffer);

    const result = await compressImageIfNecessary(originalBuffer, 'image/jpeg');

    expect(mockedSharp).toHaveBeenCalledWith(originalBuffer, { animated: false });
    expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
      quality: mockCompressionQuality,
      mozjpeg: true,
    });
    expect(mockSharpInstance.toBuffer).toHaveBeenCalled();
    expect(result.buffer).toBe(compressedBuffer);
    expect(result.compression_applied).toBe(true);
    expect(result.original_size_bytes).toBe(originalBuffer.length);
  });

  it('should use original image if compression does not reduce size for JPEG', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    mockSharpInstance.toBuffer.mockResolvedValue(
      createDummyImageBuffer(originalBuffer.length, 'b')
    );

    const result = await compressImageIfNecessary(originalBuffer, 'image/jpeg');
    expect(result.buffer).toBe(originalBuffer);
    expect(result.compression_applied).toBe(false);
    expect(result.compression_error_note).toBe('Compressed size was not smaller than original.');
  });

  it('should compress PNG correctly', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const compressedBuffer = createDummyImageBuffer(mockCompressionThreshold - 50, 'c');
    mockSharpInstance.toBuffer.mockResolvedValue(compressedBuffer);

    const result = await compressImageIfNecessary(originalBuffer, 'image/png');
    expect(mockSharpInstance.png).toHaveBeenCalledWith({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
    });
    expect(result.buffer).toBe(compressedBuffer);
    expect(result.compression_applied).toBe(true);
  });

  it('should compress WebP correctly', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const compressedBuffer = createDummyImageBuffer(mockCompressionThreshold - 50, 'd');
    mockSharpInstance.toBuffer.mockResolvedValue(compressedBuffer);

    const result = await compressImageIfNecessary(originalBuffer, 'image/webp');
    expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: mockCompressionQuality });
    expect(result.buffer).toBe(compressedBuffer);
    expect(result.compression_applied).toBe(true);
  });

  it('should return original image and note on sharp processing error', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);
    const error = new Error('Sharp processing failed');
    mockSharpInstance.toBuffer.mockRejectedValue(error);

    const result = await compressImageIfNecessary(originalBuffer, 'image/jpeg');
    expect(result.buffer).toBe(originalBuffer);
    expect(result.compression_applied).toBe(false);
    expect(result.compression_error_note).toBe(`Compression failed: ${error.message}`);
  });

  it('should handle GIF (passes through with debug log in current impl)', async () => {
    const originalBuffer = createDummyImageBuffer(mockCompressionThreshold + 100);

    const result = await compressImageIfNecessary(originalBuffer, 'image/gif');

    // GIF is not in SUPPORTED_MIME_TYPES_FOR_COMPRESSION, so sharp should not be called
    expect(mockedSharp).not.toHaveBeenCalled();
    expect(result.buffer).toBe(originalBuffer);
    expect(result.compression_applied).toBe(false);
    // No compression_error_note should be present since it's not an error, just unsupported
    expect(result.compression_error_note).toBeUndefined();
  });
});
