import crypto from 'crypto';

/**
 * Calculates a checksum for the given content using the specified algorithm.
 * @param content The content to checksum (Buffer or string).
 * @param algorithm The hashing algorithm to use (e.g., 'sha256', 'md5'). Defaults to 'sha256'.
 * @returns A Promise that resolves to the hex-encoded checksum string.
 */
export async function calculateChecksum(
  content: Buffer | string,
  algorithm: string = 'sha256'
): Promise<string> {
  const hash = crypto.createHash(algorithm);
  hash.update(content);
  return hash.digest('hex');
}
