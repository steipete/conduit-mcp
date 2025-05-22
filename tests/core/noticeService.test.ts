import {
  generateFirstUseNotice,
  hasFirstUseNoticeBeenSent,
  markFirstUseNoticeSent,
} from '@/core/noticeService';
import os from 'os';
import path from 'path';
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// Mock configLoader.conduitConfig
const mockServerVersion = '1.0.0-test';
const mockServerStartTimeIso = new Date().toISOString();
const mockResolvedHomeDir = path.resolve('/test-home');
const mockResolvedTmpDir = path.resolve('/test-tmp');

const mockConduitConfigValues = {
  serverVersion: mockServerVersion,
  serverStartTimeIso: mockServerStartTimeIso,
  allowedPaths: [mockResolvedHomeDir, mockResolvedTmpDir],
  workspaceRoot: '/test-workspace',
  logLevel: 'INFO' as const,
  httpTimeoutMs: 30000,
  maxPayloadSizeBytes: 1024,
  maxFileReadBytes: 1024,
  maxUrlDownloadSizeBytes: 1024,
  maxFileReadBytesFind: 1024,
  imageCompressionThresholdBytes: 1024,
  imageCompressionQuality: 75,
  defaultChecksumAlgorithm: 'sha256' as const,
  maxRecursiveDepth: 10,
  recursiveSizeTimeoutMs: 60000,
  userDidSpecifyAllowedPaths: false,
  resolvedAllowedPaths: [mockResolvedHomeDir, path.resolve('/tmp')],
};

vi.mock('@/core/configLoader', () => ({
  get conduitConfig() {
    return mockConduitConfigValues;
  },
}));

// Mock os.homedir() for consistent default path resolution in tests
const originalHomeDir = os.homedir;
// Removed unused mockFsStore variable

describe('noticeService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.clearAllMocks();
    // mockFsStore = {}; // Removed unused assignment

    os.homedir = vi.fn(() => '/mock/home');

    // Mock fs-extra functions
  });

  afterAll(() => {
    process.env = originalEnv;
    os.homedir = originalHomeDir;
    vi.resetModules();
  });

  describe('hasFirstUseNoticeBeenSent', () => {
    beforeEach(async () => {
      vi.resetModules();
    });

    it('should return false initially', () => {
      expect(hasFirstUseNoticeBeenSent()).toBe(false);
    });

    it('should return true after markFirstUseNoticeSent is called', () => {
      markFirstUseNoticeSent();
      expect(hasFirstUseNoticeBeenSent()).toBe(true);
    });
  });

  describe('markFirstUseNoticeSent', () => {
    beforeEach(async () => {
      vi.resetModules();
    });

    it('should mark the notice as sent', () => {
      expect(hasFirstUseNoticeBeenSent()).toBe(false);
      markFirstUseNoticeSent();
      expect(hasFirstUseNoticeBeenSent()).toBe(true);
    });
  });

  describe('generateFirstUseNotice', () => {
    it('should return a valid InfoNotice if user did not specify allowed paths', () => {
      const configWithDefaults = {
        ...mockConduitConfigValues,
        userDidSpecifyAllowedPaths: false,
      };
      const notice = generateFirstUseNotice(configWithDefaults);
      expect(notice).not.toBeNull();
      expect(notice?.type).toBe('info_notice');
      expect(notice?.notice_code).toBe('DEFAULT_PATHS_USED');
      expect(notice?.details.server_version).toBe(mockServerVersion);
      expect(notice?.details.server_start_time_iso).toBe(mockServerStartTimeIso);
      expect(notice?.details.default_paths_used).toEqual([
        mockResolvedHomeDir,
        path.resolve('/tmp'),
      ]);
    });

    it('should return null if user specified allowed paths', () => {
      const configWithCustomPaths = {
        ...mockConduitConfigValues,
        userDidSpecifyAllowedPaths: true,
      };
      const notice = generateFirstUseNotice(configWithCustomPaths);
      expect(notice).toBeNull();
    });
  });
});
