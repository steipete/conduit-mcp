import sharp from 'sharp';
import { conduitConfig, logger } from '@/internal';

const operationLogger = logger.child({ component: 'imageProcessor' });

export interface CompressionResult {
  buffer: Buffer;
  original_size_bytes?: number;
  compression_applied?: boolean;
  compression_error_note?: string;
}

const SUPPORTED_MIME_TYPES_FOR_COMPRESSION = [
  'image/jpeg',
  'image/png',
  'image/webp',
  // 'image/tiff', // Sharp can handle tiff, but compression options might vary
  // 'image/gif',  // Sharp can handle gif, animated gif compression is specific
  // 'image/avif', // Sharp can handle avif
];

export async function compressImageIfNecessary(
  originalBuffer: Buffer,
  mimeType: string
  // config: ConduitServerConfig, // Using imported conduitConfig directly for now as per other core modules
): Promise<CompressionResult> {
  const { imageCompressionThresholdBytes, imageCompressionQuality } = conduitConfig;
  const originalSizeBytes = originalBuffer.length;

  if (originalSizeBytes <= imageCompressionThresholdBytes) {
    operationLogger.debug(
      `Image size ${originalSizeBytes} bytes is below threshold ${imageCompressionThresholdBytes}, no compression attempted.`
    );
    return {
      buffer: originalBuffer,
      original_size_bytes: originalSizeBytes,
      compression_applied: false,
    };
  }

  if (!SUPPORTED_MIME_TYPES_FOR_COMPRESSION.includes(mimeType.toLowerCase())) {
    operationLogger.debug(`MIME type ${mimeType} not configured for compression.`);
    return {
      buffer: originalBuffer,
      original_size_bytes: originalSizeBytes,
      compression_applied: false,
    };
  }

  operationLogger.debug(
    `Attempting compression for ${mimeType}, original size: ${originalSizeBytes} bytes.`
  );

  try {
    let sharpInstance = sharp(originalBuffer, {
      animated: mimeType === 'image/gif' || mimeType === 'image/webp',
    }); // Enable animated for relevant types

    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
        sharpInstance = sharpInstance.jpeg({ quality: imageCompressionQuality, mozjpeg: true });
        break;
      case 'image/png':
        sharpInstance = sharpInstance.png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: true,
        }); // Added palette for potential size win
        break;
      case 'image/webp':
        sharpInstance = sharpInstance.webp({ quality: imageCompressionQuality });
        break;
      // Add cases for tiff, avif if specific settings are desired, otherwise they might use defaults or fail.
      default:
        // Should not be reached if SUPPORTED_MIME_TYPES_FOR_COMPRESSION is accurate
        operationLogger.warn(
          `No specific compression logic for MIME type: ${mimeType}. Returning original.`
        );
        return {
          buffer: originalBuffer,
          original_size_bytes: originalSizeBytes,
          compression_applied: false,
        };
    }

    const compressedBuffer = await sharpInstance.toBuffer();
    operationLogger.debug(
      `Compression result for ${mimeType} - Original: ${originalSizeBytes}, Compressed: ${compressedBuffer.length}`
    );

    if (compressedBuffer.length < originalSizeBytes) {
      return {
        buffer: compressedBuffer,
        original_size_bytes: originalSizeBytes,
        compression_applied: true,
      };
    } else {
      operationLogger.debug(
        `Compressed size not smaller than original for ${mimeType}. Returning original.`
      );
      return {
        buffer: originalBuffer,
        original_size_bytes: originalSizeBytes,
        compression_applied: false, // Technically attempted, but no benefit
        compression_error_note: 'Compressed size was not smaller than original.',
      };
    }
  } catch (error: unknown) {
    operationLogger.error(
      `Error during image compression for ${mimeType}: ${(error as Error).message}`,
      error
    );
    return {
      buffer: originalBuffer,
      original_size_bytes: originalSizeBytes,
      compression_applied: false,
      compression_error_note: `Compression failed: ${(error as Error).message}`,
    };
  }
}
