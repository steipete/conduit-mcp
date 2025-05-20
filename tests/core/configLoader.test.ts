import { loadConfig } from '@/core/configLoader';
import { ConduitServerConfig } from '@/types/config';
import logger from '@/utils/logger'; // To potentially spy on, or ensure it doesn't break tests
import os from 'os';
import path from 'path';
import { vi } from 'vitest'; // Import vi for mocking

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

// Mock package.json import
const mockServerVersion = '1.0.0-test';
vi.mock('../../package.json', () => ({ version: mockServerVersion }));



describe('configLoader', () => {
  const originalEnv = { ...process.env };
  const originalHomeDir = os.homedir;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
    // Reset mocks
    vi.clearAllMocks();
    // Mock os.homedir for consistent ~ resolution
    // @ts-ignore
    os.homedir = vi.fn(() => '/testhome');
  });

  afterAll(() => {
    // Restore original process.env and os.homedir after all tests
    process.env = originalEnv;
    // @ts-ignore
    os.homedir = originalHomeDir;
  });

  it('should load default configuration correctly', () => {
    delete process.env.CONDUIT_ALLOWED_PATHS; // Ensure it uses default
    const config = loadConfig();
    expect(config.logLevel).toBe('INFO');
    expect(config.allowedPaths).toEqual([path.resolve('/testhome'), path.resolve('/tmp')]);
    expect(config.httpTimeoutMs).toBe(30000);
    expect(config.maxPayloadSizeBytes).toBe(10485760);
    expect(config.maxFileReadBytes).toBe(52428800);
    expect(config.maxUrlDownloadBytes).toBe(20971520);
    expect(config.imageCompressionThresholdBytes).toBe(1048576);
    expect(config.imageCompressionQuality).toBe(75);
    expect(config.defaultChecksumAlgorithm).toBe('sha256');
    expect(config.maxRecursiveDepth).toBe(10);
    expect(config.recursiveSizeTimeoutMs).toBe(60000);
    expect(config.serverVersion).toBe(mockServerVersion);
    expect(config.serverStartTimeIso).toBeDefined();
    expect(config.serverStartTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });

  it('should parse CONDUIT_ALLOWED_PATHS correctly with ~ resolution', () => {
    process.env.CONDUIT_ALLOWED_PATHS = '~/data:/other/path:/tmp/test';
    const config = loadConfig();
    expect(config.allowedPaths).toEqual([
      path.resolve('/testhome/data'),
      path.resolve('/other/path'),
      path.resolve('/tmp/test'),
    ]);
  });

  it('should handle empty segments and trim whitespace in CONDUIT_ALLOWED_PATHS', () => {
    process.env.CONDUIT_ALLOWED_PATHS = ' ~/data : :/another/path ';
    const config = loadConfig();
    expect(config.allowedPaths).toEqual([
      path.resolve('/testhome/data'),
      path.resolve('/another/path'),
    ]);
  });
  
  it('should use default CONDUIT_ALLOWED_PATHS if an empty string is provided', () => {
    process.env.CONDUIT_ALLOWED_PATHS = '';
    const config = loadConfig();
    expect(config.allowedPaths).toEqual([path.resolve('/testhome'), path.resolve('/tmp')]);
  });

  it('should parse all valid environment variables', () => {
    process.env.LOG_LEVEL = 'DEBUG';
    process.env.CONDUIT_ALLOWED_PATHS = '/srv';
    process.env.CONDUIT_HTTP_TIMEOUT_MS = '10000';
    process.env.CONDUIT_MAX_PAYLOAD_SIZE_BYTES = '1000';
    process.env.CONDUIT_MAX_FILE_READ_BYTES = '2000';
    process.env.CONDUIT_MAX_URL_DOWNLOAD_BYTES = '3000';
    process.env.CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES = '4000';
    process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '50';
    process.env.CONDUIT_DEFAULT_CHECKSUM_ALGORITHM = 'sha1';
    process.env.CONDUIT_MAX_RECURSIVE_DEPTH = '5';
    process.env.CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS = '30000';

    const config = loadConfig();

    expect(config.logLevel).toBe('DEBUG');
    expect(config.allowedPaths).toEqual([path.resolve('/srv')]);
    expect(config.httpTimeoutMs).toBe(10000);
    expect(config.maxPayloadSizeBytes).toBe(1000);
    expect(config.maxFileReadBytes).toBe(2000);
    expect(config.maxUrlDownloadBytes).toBe(3000);
    expect(config.imageCompressionThresholdBytes).toBe(4000);
    expect(config.imageCompressionQuality).toBe(50);
    expect(config.defaultChecksumAlgorithm).toBe('sha1');
    expect(config.maxRecursiveDepth).toBe(5);
    expect(config.recursiveSizeTimeoutMs).toBe(30000);
  });

  it('should use default for invalid LOG_LEVEL and warn', () => {
    process.env.LOG_LEVEL = 'INVALID_LEVEL';
    const config = loadConfig();
    expect(config.logLevel).toBe('INFO');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid value for env var. Received "INVALID_LEVEL"'));
  });

  it('should use default for non-numeric CONDUIT_HTTP_TIMEOUT_MS and warn', () => {
    process.env.CONDUIT_HTTP_TIMEOUT_MS = 'not-a-number';
    const config = loadConfig();
    expect(config.httpTimeoutMs).toBe(30000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid integer value for env var. Using default: 30000'));
  });

  it('should clamp CONDUIT_IMAGE_COMPRESSION_QUALITY to range 1-100 and warn if out of range', () => {
    process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '150';
    let config = loadConfig();
    expect(config.imageCompressionQuality).toBe(75); // Clamped to default, as per current logic
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CONDUIT_IMAGE_COMPRESSION_QUALITY (150) out of range (1-100). Clamping to 75.'));
    
    vi.clearAllMocks();
    process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '-10';
    config = loadConfig();
    expect(config.imageCompressionQuality).toBe(75);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CONDUIT_IMAGE_COMPRESSION_QUALITY (-10) out of range (1-100). Clamping to 75.'));
  });

  it('should use default for invalid CONDUIT_DEFAULT_CHECKSUM_ALGORITHM and warn', () => {
    process.env.CONDUIT_DEFAULT_CHECKSUM_ALGORITHM = 'sha3';
    const config = loadConfig();
    expect(config.defaultChecksumAlgorithm).toBe('sha256');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid value for env var. Received "sha3"'));
  });
  
  it('should log an error if CONDUIT_ALLOWED_PATHS resolves to an empty list (e.g. only contains whitespace or colons)', () => {
    process.env.CONDUIT_ALLOWED_PATHS = ' :  : '; // Only separators and whitespace
    loadConfig();
    expect(logger.error).toHaveBeenCalledWith('CONDUIT_ALLOWED_PATHS resolved to an empty list. This is a critical misconfiguration.');
  });

}); 