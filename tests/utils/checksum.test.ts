import { describe, it, expect } from 'vitest';
import { calculateChecksum } from '@/utils/checksum';
import crypto from 'crypto';

describe('checksum utils', () => {
  describe('calculateChecksum', () => {
    const testString = 'Hello, Conduit!';
    const testBuffer = Buffer.from(testString, 'utf-8');

    it('should calculate SHA256 checksum for a string by default', async () => {
      const expectedChecksum = crypto.createHash('sha256').update(testString).digest('hex');
      const actualChecksum = await calculateChecksum(testString);
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should calculate SHA256 checksum for a Buffer by default', async () => {
      const expectedChecksum = crypto.createHash('sha256').update(testBuffer).digest('hex');
      const actualChecksum = await calculateChecksum(testBuffer);
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should calculate MD5 checksum for a string when specified', async () => {
      const expectedChecksum = crypto.createHash('md5').update(testString).digest('hex');
      const actualChecksum = await calculateChecksum(testString, 'md5');
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should calculate MD5 checksum for a Buffer when specified', async () => {
      const expectedChecksum = crypto.createHash('md5').update(testBuffer).digest('hex');
      const actualChecksum = await calculateChecksum(testBuffer, 'md5');
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should calculate SHA1 checksum for a string when specified', async () => {
      const expectedChecksum = crypto.createHash('sha1').update(testString).digest('hex');
      const actualChecksum = await calculateChecksum(testString, 'sha1');
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should calculate SHA512 checksum for a Buffer when specified', async () => {
      const expectedChecksum = crypto.createHash('sha512').update(testBuffer).digest('hex');
      const actualChecksum = await calculateChecksum(testBuffer, 'sha512');
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should handle empty string input', async () => {
      const expectedChecksum = crypto.createHash('sha256').update('').digest('hex');
      const actualChecksum = await calculateChecksum('');
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should handle empty Buffer input', async () => {
      const expectedChecksum = crypto.createHash('sha256').update(Buffer.from('')).digest('hex');
      const actualChecksum = await calculateChecksum(Buffer.from(''));
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it('should throw an error for an unsupported algorithm', async () => {
      // The underlying crypto.createHash will throw an error.
      // We want to ensure our function propagates this or handles it as expected.
      // Vitest's toThrowError can check for the error message or type.
      await expect(calculateChecksum(testString, 'unsupportedAlgorithm123')).rejects.toThrowError(); // Or more specific error like /Algorithm not supported/ or Error instance
    });
  });
});
