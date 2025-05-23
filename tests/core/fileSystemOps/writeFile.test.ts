import { vi } from 'vitest';
import { mockFs, mockConduitConfig as importedMockConduitConfig } from './helpers'; // Import the raw mock objects

// Mock fs/promises AT THE TOP of the test file
vi.mock('fs/promises', () => ({
  ...mockFs, // Spread all functions from mockFs
  default: mockFs, // Ensure fs from 'fs/promises' in SUT gets these mocks
}));

// Mock @/internal AT THE TOP of the test file
vi.mock('@/internal', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/internal')>();
  return {
    ...original,
    conduitConfig: importedMockConduitConfig, // Use the imported mockConduitConfig
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    getMimeType: vi.fn().mockResolvedValue('application/octet-stream'),
    formatToISO8601UTC: vi.fn((date: Date) => date.toISOString()), // Added Date type for clarity
  };
});

// Now proceed with other imports
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile } from '@/core/fileSystemOps';
// conduitConfig will be imported by the SUT (fileSystemOps) and should pick up the mock above.
// For test logic that needs conduitConfig, we also import it here.
import { conduitConfig } from '@/internal';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import { Buffer } from 'buffer';

describe('writeFile', () => {
  const filePath = 'output.txt';
  const textContent = 'This is a test.';
  const base64Content = Buffer.from(textContent).toString('base64');
  const bufferContent = Buffer.from(textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for fs.writeFile and fs.appendFile to succeed
    mockFs.writeFile.mockImplementation(async () => undefined);
    mockFs.appendFile.mockImplementation(async () => undefined);

    // Also reset logger mocks if they are used by writeFile SUT and need to be checked per test
    // For now, assuming writeFile SUT doesn't directly log in ways that need per-test verification of logger calls.
    // If it did, logger functions (e.g., logger.info, logger.error) would also need .mockClear() or .mockReset().
  });

  it('should write text content in overwrite mode successfully', async () => {
    const bytesWritten = await writeFile(filePath, textContent, 'text', 'overwrite');
    expect(bytesWritten).toBe(bufferContent.length);
    expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent);
    expect(mockFs.appendFile).not.toHaveBeenCalled();
  });

  it('should write base64 encoded content in overwrite mode successfully', async () => {
    const bytesWritten = await writeFile(filePath, base64Content, 'base64', 'overwrite');
    expect(bytesWritten).toBe(bufferContent.length);
    expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent); // Decoded to buffer
  });

  it('should write Buffer content in overwrite mode successfully', async () => {
    const bytesWritten = await writeFile(filePath, bufferContent, undefined, 'overwrite'); // Encoding ignored for buffer
    expect(bytesWritten).toBe(bufferContent.length);
    expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, bufferContent);
  });

  it('should append text content successfully', async () => {
    const bytesWritten = await writeFile(filePath, textContent, 'text', 'append');
    expect(bytesWritten).toBe(bufferContent.length);
    expect(mockFs.appendFile).toHaveBeenCalledWith(filePath, bufferContent);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should append Buffer content successfully', async () => {
    const bytesWritten = await writeFile(filePath, bufferContent, undefined, 'append');
    expect(bytesWritten).toBe(bufferContent.length);
    expect(mockFs.appendFile).toHaveBeenCalledWith(filePath, bufferContent);
  });

  it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if content size is too large', async () => {
    // conduitConfig (mocked) is used by the test to prepare largeTextContent
    // and also by the SUT for its internal check.
    const largeTextContent = 'a'.repeat(conduitConfig.maxFileReadBytes + 1);

    await expect(writeFile(filePath, largeTextContent)).rejects.toThrow(ConduitError);
    try {
      await writeFile(filePath, largeTextContent);
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
      expect(err.message).toContain(
        `Content size ${largeTextContent.length} bytes exceeds maximum allowed write limit of ${conduitConfig.maxFileReadBytes} bytes`
      );
    }
  });

  it('should throw ERR_FS_WRITE_FAILED if fs.writeFile fails', async () => {
    const error = new Error('Disk full');
    mockFs.writeFile.mockImplementation(async () => {
      throw error;
    });
    await expect(writeFile(filePath, textContent, 'text', 'overwrite')).rejects.toThrow(
      ConduitError
    );
    try {
      await writeFile(filePath, textContent, 'text', 'overwrite');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
      expect(err.message).toContain(`Failed to write file: ${filePath}. Error: Disk full`);
    }
  });

  it('should throw ERR_FS_WRITE_FAILED if fs.appendFile fails', async () => {
    const error = new Error('Permission issue');
    mockFs.appendFile.mockImplementation(async () => {
      throw error;
    });
    await expect(writeFile(filePath, textContent, 'text', 'append')).rejects.toThrow(ConduitError);
    try {
      await writeFile(filePath, textContent, 'text', 'append');
    } catch (e) {
      const err = e as ConduitError;
      expect(err.errorCode).toBe(ErrorCode.ERR_FS_WRITE_FAILED);
      expect(err.message).toContain(`Failed to write file: ${filePath}. Error: Permission issue`);
    }
  });
});
