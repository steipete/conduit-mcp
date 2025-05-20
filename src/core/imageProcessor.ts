import sharp from 'sharp';
import { conduitConfig } from './configLoader';
import logger from '@/utils/logger';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';

export interface CompressionResult {
  buffer: Buffer;
  original_size_bytes: number;
  compression_applied: boolean;
  compression_error_note?: string;
}

/**
 * Compresses an image if it exceeds the configured threshold.
 * @param imageBuffer The raw image buffer.
 * @param mimeType The MIME type of the image (e.g., "image/jpeg").
 * @returns Promise<CompressionResult>
 */
export async function compressImageIfNecessary(imageBuffer: Buffer, mimeType: string): Promise<CompressionResult> {
  const originalSizeBytes = imageBuffer.length;
  let compressionApplied = false;
  let compressionErrorNote: string | undefined = undefined;
  let finalBuffer = imageBuffer;

  if (!mimeType.startsWith('image/')) {
    return { // Not an image, return original
      buffer: imageBuffer,
      original_size_bytes: originalSizeBytes,
      compression_applied: false,
    };
  }
  
  // Check if sharp supports this image type for processing
  // Sharp typically supports jpeg, png, webp, tiff, gif, avif. Add more if needed based on sharp's capabilities.
  const supportedForCompression = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/gif', 'image/avif'].includes(mimeType.toLowerCase());

  if (supportedForCompression && originalSizeBytes > conduitConfig.imageCompressionThresholdBytes) {
    logger.debug(`Attempting compression for image (${mimeType}, ${originalSizeBytes} bytes) as it exceeds threshold ${conduitConfig.imageCompressionThresholdBytes} bytes.`);
    try {
      let sharpInstance = sharp(imageBuffer);
      const quality = conduitConfig.imageCompressionQuality;

      switch (mimeType.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg': // common alias
          sharpInstance = sharpInstance.jpeg({ quality, progressive: true, optimizeScans: true });
          break;
        case 'image/webp':
          sharpInstance = sharpInstance.webp({ quality });
          break;
        case 'image/png':
          sharpInstance = sharpInstance.png({ compressionLevel: 9, adaptiveFiltering: true }); // Maximize PNG compression
          break;
        case 'image/tiff':
            sharpInstance = sharpInstance.tiff({ quality }); // Sharp supports tiff quality
            break;
        case 'image/gif':
            // GIF compression in sharp might involve converting to animated webp or similar, or simple optimization.
            // For simplicity, we can try to optimize or just pass through if complex handling is not desired.
            // sharpInstance = sharpInstance.gif({ optimisationLevel: 3 }); // Example, check sharp docs
            // For now, let's assume basic optimization or pass-through for GIF if complex settings are not available easily.
            logger.debug('GIF compression with sharp is basic, may not significantly reduce size or might re-encode.');
            break;
        case 'image/avif':
            sharpInstance = sharpInstance.avif({ quality });
            break;
        default:
          // Should not happen due to supportedForCompression check, but as a safeguard:
          logger.warn(`Compression requested for ${mimeType}, but no specific sharp parameters defined. Passing through.`);
          finalBuffer = imageBuffer; // Pass through
          compressionApplied = false; // Mark as not applied if no specific logic
          // Return early instead of trying to call .toBuffer() on an unconfigured sharp instance for these types.
          return {
            buffer: finalBuffer,
            original_size_bytes: originalSizeBytes,
            compression_applied: compressionApplied,
            compression_error_note: compressionErrorNote
          };
      }
      
      // Only apply toBuffer if we have a valid sharp operation for the type
      const compressedBuffer = await sharpInstance.toBuffer();
      
      if (compressedBuffer.length < originalSizeBytes) {
        finalBuffer = compressedBuffer;
        compressionApplied = true;
        logger.info(`Image compression successful for ${mimeType}. Original: ${originalSizeBytes} bytes, Compressed: ${finalBuffer.length} bytes.`);
      } else {
        logger.info(`Compressed image size (${compressedBuffer.length}) is not smaller than original (${originalSizeBytes}). Using original.`);
        compressionApplied = false; // Technically applied, but no benefit
        compressionErrorNote = "Compressed size was not smaller than original.";
      }

    } catch (error: any) {
      logger.error(`Image compression failed for ${mimeType} (size: ${originalSizeBytes} bytes): ${error.message}`);
      compressionApplied = false;
      compressionErrorNote = `Compression failed: ${error.message}`.substring(0, 200); // Limit error message length
      finalBuffer = imageBuffer; // Return original on error
    }
  } else if (supportedForCompression) {
    logger.debug(`Image (${mimeType}, ${originalSizeBytes} bytes) does not exceed compression threshold ${conduitConfig.imageCompressionThresholdBytes} bytes. No compression applied.`);
  } else {
    logger.debug(`Image type ${mimeType} is not configured for compression with sharp. No compression attempted.`);
  }

  return {
    buffer: finalBuffer,
    original_size_bytes: originalSizeBytes,
    compression_applied: compressionApplied,
    compression_error_note: compressionErrorNote
  };
} 