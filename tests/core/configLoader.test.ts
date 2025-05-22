import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
// Removed unused ConduitServerConfig import
import logger from '@/utils/logger'; // Leverages the global mock from setupTests

import { loadConfig } from '@/core/configLoader';
import os from 'os';

// Use actual home directory instead of mocking
const actualHomeDir = os.homedir();

// Mock fs for package.json reading
vi.mock('fs');

// Mock package.json
vi.mock('../../package.json', () => ({
  version: 'test-version-1.2.3',
}));

describe('configLoader', () => {
  let originalEnv = { ...process.env };
  const mockHomeDir = actualHomeDir; // Use actual home directory
  const mockCwd = '/mock/workspace';

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // Clear npm_package_version to force reading from package.json
    delete process.env.npm_package_version;
    
    // Mock fs.readFileSync for package.json
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (typeof filePath === 'string' && filePath.includes('package.json')) {
        return JSON.stringify({ version: 'test-version-1.2.3' });
      }
      // Call the original implementation for other files
      return vi.importActual('fs').readFileSync(filePath, encoding);
    });

    vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should load default configuration when no environment variables are set', () => {
      const config = loadConfig();

      expect(config.logLevel).toBe('INFO');
      // Check with the mocked homedir
      expect(config.allowedPaths).toEqual([path.join(mockHomeDir, ''), '/tmp']);
      expect(config.httpTimeoutMs).toBe(30000);
      expect(config.maxPayloadSizeBytes).toBe(10485760);
      expect(config.maxFileReadBytes).toBe(52428800);
      expect(config.maxFileReadBytesFind).toBe(524288);
      expect(config.maxUrlDownloadSizeBytes).toBe(20971520);
      expect(config.imageCompressionThresholdBytes).toBe(1048576);
      expect(config.imageCompressionQuality).toBe(75);
      expect(config.defaultChecksumAlgorithm).toBe('sha256');
      expect(config.maxRecursiveDepth).toBe(10);
      expect(config.recursiveSizeTimeoutMs).toBe(60000);
      expect(config.serverVersion).toBe('test-version-1.2.3'); // From package.json mock
      expect(config.workspaceRoot).toBe(mockCwd);
      expect(typeof config.serverStartTimeIso).toBe('string');
      expect(config.serverStartTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // The homedir mock should have been called during path resolution
      expect(logger.info).toHaveBeenCalledWith('Server configuration loaded successfully.');
      expect(logger.debug).toHaveBeenCalledWith(
        { config: expect.any(Object) },
        'Active server configuration'
      );
    });

    // Test cases for LOG_LEVEL
    it('should override logLevel with valid CONDUIT_LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const config = loadConfig();
      expect(config.logLevel).toBe('DEBUG');
    });

    it('should use default logLevel and warn for invalid CONDUIT_LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'INVALID';
      const config = loadConfig();
      expect(config.logLevel).toBe('INFO');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for env var. Received "INVALID"')
      );
    });

    it('should handle lowercase logLevel from env', () => {
      process.env.LOG_LEVEL = 'warn';
      const config = loadConfig();
      expect(config.logLevel).toBe('WARN');
    });

    // Test cases for CONDUIT_ALLOWED_PATHS
    it('should parse CONDUIT_ALLOWED_PATHS with ~ and multiple paths', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '~/data:/another/path:/usr/local/bin';
      const config = loadConfig();
      expect(config.allowedPaths).toEqual([
        path.join(mockHomeDir, 'data'), // Should use mocked homedir
        path.resolve('/another/path'),
        path.resolve('/usr/local/bin'),
      ]);
    });

    it('should handle empty segments and trim whitespace in CONDUIT_ALLOWED_PATHS', () => {
      process.env.CONDUIT_ALLOWED_PATHS = ' ~/docs :: /tmp/logs ';
      const config = loadConfig();
      expect(config.allowedPaths).toEqual([
        path.join(mockHomeDir, 'docs'), // Should use mocked homedir
        path.resolve('/tmp/logs'),
      ]);
    });

    it('should log error if CONDUIT_ALLOWED_PATHS is empty string resulting in no paths', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '';
      const config = loadConfig();
      // When CONDUIT_ALLOWED_PATHS is empty, it should result in an empty array for allowedPaths
      // and not fall back to the default, because an explicit (empty) value was provided.
      expect(config.allowedPaths).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'CONDUIT_ALLOWED_PATHS resolved to an empty list. This is a critical misconfiguration.'
      );
    });

    it('should log error if CONDUIT_ALLOWED_PATHS contains only delimiters resulting in no paths', () => {
      process.env.CONDUIT_ALLOWED_PATHS = ' : : ';
      const config = loadConfig();
      expect(config.allowedPaths).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'CONDUIT_ALLOWED_PATHS resolved to an empty list. This is a critical misconfiguration.'
      );
    });

    // Test cases for various integer parsed values
    const intTestCases = [
      {
        envVar: 'CONDUIT_HTTP_TIMEOUT_MS',
        prop: 'httpTimeoutMs',
        defaultValue: 30000,
        testValue: '15000',
      },
      {
        envVar: 'CONDUIT_MAX_PAYLOAD_SIZE_BYTES',
        prop: 'maxPayloadSizeBytes',
        defaultValue: 10485760,
        testValue: '500000',
      },
      {
        envVar: 'CONDUIT_MAX_FILE_READ_BYTES',
        prop: 'maxFileReadBytes',
        defaultValue: 52428800,
        testValue: '1000000',
      },
      {
        envVar: 'CONDUIT_MAX_FILE_READ_BYTES_FIND',
        prop: 'maxFileReadBytesFind',
        defaultValue: 524288,
        testValue: '200000',
      },
      {
        envVar: 'CONDUIT_MAX_URL_DOWNLOAD_SIZE_BYTES',
        prop: 'maxUrlDownloadSizeBytes',
        defaultValue: 20971520,
        testValue: '10000000',
      },
      {
        envVar: 'CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES',
        prop: 'imageCompressionThresholdBytes',
        defaultValue: 1048576,
        testValue: '500000',
      },
      {
        envVar: 'CONDUIT_IMAGE_COMPRESSION_QUALITY',
        prop: 'imageCompressionQuality',
        defaultValue: 75,
        testValue: '60',
      },
      {
        envVar: 'CONDUIT_MAX_RECURSIVE_DEPTH',
        prop: 'maxRecursiveDepth',
        defaultValue: 10,
        testValue: '5',
      },
      {
        envVar: 'CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS',
        prop: 'recursiveSizeTimeoutMs',
        defaultValue: 60000,
        testValue: '45000',
      },
    ] as const;

    intTestCases.forEach(({ envVar, prop, defaultValue, testValue }) => {
      it(`should override ${prop} with valid ${envVar}`, () => {
        process.env[envVar] = testValue;
        const config = loadConfig();
        expect(config[prop]).toBe(parseInt(testValue, 10));
      });

      it(`should use default ${prop} and warn for non-integer ${envVar}`, () => {
        process.env[envVar] = 'not-an-integer';
        const config = loadConfig();
        expect(config[prop]).toBe(defaultValue);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `Invalid integer value for env var. Using default: ${defaultValue}`
          )
        );
      });

      it(`should use default ${prop} for empty string ${envVar}`, () => {
        process.env[envVar] = '';
        const config = loadConfig();
        expect(config[prop]).toBe(defaultValue);
        // No warning for empty string, it uses default silently
      });
    });

    // Test imageCompressionQuality clamping specifically
    it('should clamp imageCompressionQuality if CONDUIT_IMAGE_COMPRESSION_QUALITY is out of range (1-100) and warn', () => {
      process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '150';
      let config = loadConfig();
      expect(config.imageCompressionQuality).toBe(75); // Clamps to default as per code
      expect(logger.warn).toHaveBeenCalledWith(
        'CONDUIT_IMAGE_COMPRESSION_QUALITY (150) out of range (1-100). Clamping to 75.'
      );

      vi.mocked(logger.warn).mockClear(); // Clear mock for next check
      process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '0';
      config = loadConfig();
      expect(config.imageCompressionQuality).toBe(75);
      expect(logger.warn).toHaveBeenCalledWith(
        'CONDUIT_IMAGE_COMPRESSION_QUALITY (0) out of range (1-100). Clamping to 75.'
      );

      vi.mocked(logger.warn).mockClear();
      process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY = '-10';
      config = loadConfig();
      expect(config.imageCompressionQuality).toBe(75);
      expect(logger.warn).toHaveBeenCalledWith(
        'CONDUIT_IMAGE_COMPRESSION_QUALITY (-10) out of range (1-100). Clamping to 75.'
      );
    });

    it('should override defaultChecksumAlgorithm with valid CONDUIT_DEFAULT_CHECKSUM_ALGORITHM', () => {
      process.env.CONDUIT_DEFAULT_CHECKSUM_ALGORITHM = 'sha1';
      const config = loadConfig();
      expect(config.defaultChecksumAlgorithm).toBe('sha1');
    });

    it('should use default defaultChecksumAlgorithm and warn for invalid CONDUIT_DEFAULT_CHECKSUM_ALGORITHM', () => {
      process.env.CONDUIT_DEFAULT_CHECKSUM_ALGORITHM = 'md4';
      const config = loadConfig();
      expect(config.defaultChecksumAlgorithm).toBe('sha256');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for env var. Received "md4"')
      );
    });
  });
});