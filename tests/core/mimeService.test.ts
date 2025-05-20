import { getMimeType } from '@/core/mimeService';
import logger from '@/utils/logger';
import { vi } from 'vitest';

// Mock the logger
vi.mock('@/utils/logger', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  return { ...mockLogger, default: mockLogger };
});

// Mock the file-type dynamic import
const mockFileTypeFromFile = vi.fn();
vi.mock('file-type', async (importOriginal) => {
    const originalModule = await importOriginal() as any;
    return {
        ...originalModule, // Spread to keep other exports if any, though we only need one
        fileTypeFromFile: mockFileTypeFromFile,
    };
});

describe('mimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock behavior before each test
    mockFileTypeFromFile.mockReset();
  });

  it('should return the MIME type if file-type resolves successfully', async () => {
    mockFileTypeFromFile.mockResolvedValue({ mime: 'image/png', ext: 'png' });
    const filePath = '/fake/path/image.png';
    const mimeType = await getMimeType(filePath);
    expect(mimeType).toBe('image/png');
    expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
  });

  it('should return undefined if file-type resolves with undefined (type not determined)', async () => {
    mockFileTypeFromFile.mockResolvedValue(undefined);
    const filePath = '/fake/path/unknown.file';
    const mimeType = await getMimeType(filePath);
    expect(mimeType).toBeUndefined();
    expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
  });

  it('should return undefined and log a warning if file-type throws an error', async () => {
    const errorMessage = 'File-type error';
    mockFileTypeFromFile.mockRejectedValue(new Error(errorMessage));
    const filePath = '/fake/path/error.file';
    const mimeType = await getMimeType(filePath);
    expect(mimeType).toBeUndefined();
    expect(mockFileTypeFromFile).toHaveBeenCalledWith(filePath);
    expect(logger.warn).toHaveBeenCalledWith(`Could not determine MIME type for ${filePath} using file-type: ${errorMessage}`);
  });

  // Test for the dynamic import failure itself (though harder to simulate if the mock factory always runs)
  // The current mock setup for file-type might make this specific scenario difficult to test directly
  // as the factory is called once. If the dynamic import within mimeService fails, it logs an error.
  // To test this, one might need to manipulate the mock of the import() call itself if possible
  // or test this scenario by temporarily breaking the 'file-type' module resolution in a controlled way.
}); 