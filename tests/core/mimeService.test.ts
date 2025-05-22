import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
// Removed unused getMimeType import from getMimeType

// Removed unused DEFAULT_MIME_TYPE constant

// Declare the mock variable. It will be initialized in vi.mock.
let mockFileTypeFromFile: ReturnType<typeof vi.fn>;

vi.mock('file-type', async () => {
  // Initialize the mock function here
  mockFileTypeFromFile = vi.fn();
  return {
    fileTypeFromFile: mockFileTypeFromFile,
  };
});

describe('mimeService', () => {
  describe('getMimeType', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
      vi.resetModules();

      // Ensure mockFileTypeFromFile is initialized before trying to clear it
      if (mockFileTypeFromFile) {
        mockFileTypeFromFile.mockClear();
      }
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return correct MIME type for a known file type via fileTypeFromFile', async () => {
      const { getMimeType: currentGetMimeType } = await import('@/core/mimeService');
      const filePath = 'test.png';
      mockFileTypeFromFile.mockResolvedValue({ ext: 'png', mime: 'image/png' });
      const mimeType = await currentGetMimeType(filePath);
      expect(mimeType).toBe('image/png');
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should return undefined if fileTypeFromFile returns undefined (type unknown)', async () => {
      const { getMimeType: currentGetMimeType } = await import('@/core/mimeService');
      const filePath = 'file.unknown';
      mockFileTypeFromFile.mockResolvedValue(undefined);
      const mimeType = await currentGetMimeType(filePath);
      expect(mimeType).toBeUndefined();
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should return undefined if fileTypeFromFile throws an error', async () => {
      const { getMimeType: currentGetMimeType } = await import('@/core/mimeService');
      const filePath = 'error.file';
      mockFileTypeFromFile.mockRejectedValue(new Error('Read error'));
      const mimeType = await currentGetMimeType(filePath);
      expect(mimeType).toBeUndefined();
      expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    });

    it('should behave correctly if file-type module itself fails to load', async () => {
      vi.doMock('file-type', () => {
        throw new Error('Simulated module load failure');
      });

      const { getMimeType: getMimeTypeAfterFail } = await import(
        '@/core/mimeService?bustCache=' + Date.now()
      );

      const filePath = 'any.file';
      const mimeType = await getMimeTypeAfterFail(filePath);
      expect(mimeType).toBeUndefined();

      // mockFileTypeFromFile might be undefined if the vi.mock factory for 'file-type' itself doesn't run
      // due to the vi.doMock throwing an error before it. Or if the test setup has issues.
      // So, we only check its call count if it's defined.
      if (mockFileTypeFromFile) {
        // This check is crucial
        expect(mockFileTypeFromFile).not.toHaveBeenCalled();
      }
    });
  });
});
