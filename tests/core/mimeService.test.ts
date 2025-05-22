import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Create a mock function that will be used across all tests
const mockFileTypeFromFile = vi.fn();

vi.mock('file-type', () => ({
  fileTypeFromFile: mockFileTypeFromFile,
}));

describe('mimeService', () => {
  describe('getMimeType', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Clear the mock calls but don't reset modules since it breaks the mock
      mockFileTypeFromFile.mockClear();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return correct MIME type for a known file type via fileTypeFromFile', async () => {
      const { getMimeType } = await import('@/core/mimeService');
      const filePath = 'test.png';
      mockFileTypeFromFile.mockResolvedValue({ ext: 'png', mime: 'image/png' });
      const mimeType = await getMimeType(filePath);
      expect(mimeType).toBe('image/png');
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should return undefined if fileTypeFromFile returns undefined (type unknown)', async () => {
      const { getMimeType } = await import('@/core/mimeService');
      const filePath = 'file.unknown';
      mockFileTypeFromFile.mockResolvedValue(undefined);
      const mimeType = await getMimeType(filePath);
      expect(mimeType).toBeUndefined();
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should return undefined if fileTypeFromFile throws an error', async () => {
      const { getMimeType } = await import('@/core/mimeService');
      const filePath = 'error.file';
      mockFileTypeFromFile.mockRejectedValue(new Error('Read error'));
      const mimeType = await getMimeType(filePath);
      expect(mimeType).toBeUndefined();
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should behave correctly if file-type module itself fails to load', async () => {
      // Simulate module load failure by making the mock throw an error
      mockFileTypeFromFile.mockImplementation(() => {
        throw new Error('Simulated module load failure');
      });

      const { getMimeType } = await import('@/core/mimeService');

      const filePath = 'any.file';
      const mimeType = await getMimeType(filePath);
      expect(mimeType).toBeUndefined();

      // Verify the mock was called (since it threw an error during execution)
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });
  });
});
