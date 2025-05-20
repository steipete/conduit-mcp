import {
  hasFirstUseMessageBeenSent,
  markFirstUseMessageSent,
  wasDefaultPathsUsed,
  createInfoNotice,
  prependInfoNoticeIfApplicable
} from '@/core/noticeService';
// import * as configLoader from '@/core/configLoader'; // Not directly needed due to mock
import { InfoNotice } from '@/types/common';
import os from 'os';
import path from 'path';
import { vi } from 'vitest'; // Import vi

// Mock configLoader.conduitConfig
const mockServerVersion = '1.0.0-test';
const mockServerStartTimeIso = new Date().toISOString();
const mockResolvedHomeDir = path.resolve('/test-home');
const mockResolvedTmpDir = path.resolve('/test-tmp');

const mockConduitConfigValues = {
  serverVersion: mockServerVersion,
  serverStartTimeIso: mockServerStartTimeIso,
  allowedPaths: [mockResolvedHomeDir, mockResolvedTmpDir], // Default resolved paths for this test
  // Add other minimal required properties for conduitConfig if any are accessed by noticeService
  logLevel: 'INFO',
  httpTimeoutMs: 30000,
  maxPayloadSizeBytes: 1024,
  maxFileReadBytes: 1024,
  maxUrlDownloadBytes: 1024,
  imageCompressionThresholdBytes: 1024,
  imageCompressionQuality: 75,
  defaultChecksumAlgorithm: 'sha256',
  maxRecursiveDepth: 10,
  recursiveSizeTimeoutMs: 60000,
};

vi.mock('@/core/configLoader', () => ({
  get conduitConfig() { return mockConduitConfigValues; }
}));

// Mock os.homedir() for consistent default path resolution in tests
const originalHomeDir = os.homedir;

describe('noticeService', () => {
  const originalEnv = { ...process.env };
  // To reset module state, we can use vi.resetModules() or re-import strategy

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules(); // Resets module cache, ensuring noticeService is fresh for firstUseMessageSent
    // Re-import or re-require noticeService if its internal state needs to be clean for each test
    // For simple boolean like firstUseMessageSent, direct reset might be tricky without exporting a resetter.
    // vi.resetModules() should handle this by providing a fresh module when it's next imported.
    // However, for this test structure where functions are imported at top-level, need to re-evaluate how to reset 'firstUseMessageSent'
    // Simplest for now: keep the previous manual reset if vi.resetModules() doesn't catch the top-level imported functions' internal state easily.
    // The previous solution using require inside beforeEach might still be more direct for module-level state variables.
    
    // Let's try a robust way to reset module state for firstUseMessageSent
    vi.doMock('@/core/noticeService', async (importOriginal) => {
      const originalModule = await importOriginal() as any;
      return {
        ...originalModule,
        // Override or reset specific exports if needed, or ensure new instance behavior
        // For a simple boolean, the cleanest might be to ensure the module is re-evaluated
        // or provide an explicit reset function from the module itself (not done here).
        // Since `firstUseMessageSent` is a let variable, it will be reset if the module is truly re-evaluated.
        hasFirstUseMessageBeenSent: vi.fn(() => originalModule.actualFirstUseMessageSentState), // If we had exported state for testing
        markFirstUseMessageSent: vi.fn(originalModule.markFirstUseMessageSent), // mock to spy
        // For now, we rely on the higher level describe/beforeEach to manage state or test prependInfoNoticeIfApplicable which calls mark internally.
      };
    });
    // The above doMock is complex for just one boolean. Let's stick to simpler if test works:
    // Test `prependInfoNoticeIfApplicable` which internally manages the flag for its scope of test.

    vi.clearAllMocks();
    // @ts-ignore
    os.homedir = vi.fn(() => '/test-home'); 
  });

  afterAll(() => {
    process.env = originalEnv;
    // @ts-ignore
    os.homedir = originalHomeDir;
    vi.resetModules(); // Clean up module cache after tests
  });

  describe('wasDefaultPathsUsed', () => {
    it('should return true if CONDUIT_ALLOWED_PATHS is undefined', () => {
      delete process.env.CONDUIT_ALLOWED_PATHS;
      expect(wasDefaultPathsUsed()).toBe(true);
    });

    it('should return true if CONDUIT_ALLOWED_PATHS is an empty string', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '';
      expect(wasDefaultPathsUsed()).toBe(true);
    });

    it('should return true if CONDUIT_ALLOWED_PATHS is whitespace', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '   ';
      expect(wasDefaultPathsUsed()).toBe(true);
    });

    it('should return false if CONDUIT_ALLOWED_PATHS is set', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '/custom/path';
      expect(wasDefaultPathsUsed()).toBe(false);
    });
  });

  describe('createInfoNotice', () => {
    it('should return a valid InfoNotice if default paths were used', () => {
      delete process.env.CONDUIT_ALLOWED_PATHS;
      const notice = createInfoNotice();
      expect(notice).not.toBeNull();
      expect(notice?.type).toBe('info_notice');
      expect(notice?.notice_code).toBe('DEFAULT_PATHS_USED');
      expect(notice?.details.server_version).toBe(mockServerVersion);
      expect(notice?.details.server_start_time_iso).toBe(mockServerStartTimeIso);
      // Check resolved default paths. path.resolve is mocked by implication of os.homedir mock for '~'
      expect(notice?.details.default_paths_used).toEqual([
        path.resolve('/test-home'), 
        path.resolve('/tmp') // /tmp is usually absolute already
      ]);
    });

    it('should return null if CONDUIT_ALLOWED_PATHS was set', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '/custom/path';
      const notice = createInfoNotice();
      expect(notice).toBeNull();
    });
  });

  describe('prependInfoNoticeIfApplicable', () => {
    let noticeService: typeof import('@/core/noticeService');

    beforeEach(async () => {
      // Reset modules to get a fresh state for firstUseMessageSent
      vi.resetModules(); 
      noticeService = await import('@/core/noticeService');
      delete process.env.CONDUIT_ALLOWED_PATHS; // Default paths used scenario
    });

    it('should prepend notice to an array response if default paths used and message not sent', () => {
      const originalResponse = [{ data: 'item1' }, { data: 'item2' }];
      const newResponse = noticeService.prependInfoNoticeIfApplicable([...originalResponse]);
      expect(Array.isArray(newResponse)).toBe(true);
      expect(newResponse.length).toBe(originalResponse.length + 1);
      const notice = newResponse[0] as InfoNotice;
      expect(notice.type).toBe('info_notice');
      expect(noticeService.hasFirstUseMessageBeenSent()).toBe(true);
    });

    it('should prepend notice and wrap an object response if default paths used and message not sent', () => {
      const originalResponse = { data: 'single_item' };
      const newResponse = noticeService.prependInfoNoticeIfApplicable({ ...originalResponse });

      expect(Array.isArray(newResponse)).toBe(true);
      // Type guard to assert it's an array before accessing length or elements
      if (Array.isArray(newResponse)) {
        expect(newResponse.length).toBe(2);
        const notice = newResponse[0] as InfoNotice;
        expect(notice.type).toBe('info_notice');
        const originalData = newResponse[1] as typeof originalResponse;
        expect(originalData.data).toBe('single_item');
      }
      expect(noticeService.hasFirstUseMessageBeenSent()).toBe(true);
    });

    it('should not prepend notice if default paths NOT used', () => {
      process.env.CONDUIT_ALLOWED_PATHS = '/custom/path';
      const originalResponse = [{ data: 'item1' }];
      // Re-import after env change and reset to get correct wasDefaultPathsUsed behavior for this test
      vi.resetModules(); 
      noticeService = require('@/core/noticeService'); // Using require for synchronous re-import here if needed, or await import
      const newResponse = noticeService.prependInfoNoticeIfApplicable([...originalResponse]);
      expect(newResponse).toEqual(originalResponse);
      expect(noticeService.hasFirstUseMessageBeenSent()).toBe(false);
    });

    it('should not prepend notice if message has already been sent', async () => {
      // Initial call to send the message
      noticeService.prependInfoNoticeIfApplicable([]); 
      expect(noticeService.hasFirstUseMessageBeenSent()).toBe(true);

      const originalResponse = [{ data: 'item1' }];
      const newResponse = noticeService.prependInfoNoticeIfApplicable([...originalResponse]);
      expect(newResponse).toEqual(originalResponse); 
    });

    it('should handle empty array response correctly', () => {
        const originalResponse: any[] = [];
        const newResponse = noticeService.prependInfoNoticeIfApplicable([...originalResponse]);
        expect(Array.isArray(newResponse)).toBe(true);
        expect(newResponse.length).toBe(1); // Only the notice
        const notice = newResponse[0] as InfoNotice;
        expect(notice.type).toBe('info_notice');
        expect(noticeService.hasFirstUseMessageBeenSent()).toBe(true);
    });
  });
}); 