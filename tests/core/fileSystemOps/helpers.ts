import { vi, type MockedFunction } from 'vitest';
import type { Stats } from 'fs';

// Helper to create Dirent-like objects for tests
export const createDirent = (
  name: string,
  isFile: boolean,
  isDirectory: boolean
): import('fs').Dirent<string> =>
  ({
    name,
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  }) as import('fs').Dirent<string>;

// Define the mock functions object that will be used by vi.mock and exported
const fsMockFunctions = {
  access: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  rmdir: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
  cp: vi.fn(),
  rename: vi.fn(),
  utimes: vi.fn(),
  readlink: vi.fn(),
  realpath: vi.fn(),
};

// Export the fs mock functions directly.
// Test files will use this in their own vi.mock('fs/promises', ...) call.
export const mockFs = fsMockFunctions as {
  access: MockedFunction<typeof import('fs/promises').access>;
  stat: MockedFunction<typeof import('fs/promises').stat>;
  lstat: MockedFunction<typeof import('fs/promises').lstat>;
  readFile: MockedFunction<typeof import('fs/promises').readFile>;
  writeFile: MockedFunction<typeof import('fs/promises').writeFile>;
  appendFile: MockedFunction<typeof import('fs/promises').appendFile>;
  mkdir: MockedFunction<typeof import('fs/promises').mkdir>;
  rm: MockedFunction<typeof import('fs/promises').rm>;
  rmdir: MockedFunction<typeof import('fs/promises').rmdir>;
  unlink: MockedFunction<typeof import('fs/promises').unlink>;
  readdir: MockedFunction<
    (path: string, options?: any) => Promise<string[] | import('fs').Dirent[]>
  >;
  cp: MockedFunction<typeof import('fs/promises').cp>;
  rename: MockedFunction<typeof import('fs/promises').rename>;
  utimes: MockedFunction<typeof import('fs/promises').utimes>;
  readlink: MockedFunction<typeof import('fs/promises').readlink>;
  realpath: MockedFunction<typeof import('fs/promises').realpath>;
};

// Define and export the mock conduitConfig object.
// Test files will use this in their own vi.mock('@/internal', ...) call.
export const mockConduitConfig = {
  logLevel: 'INFO',
  allowedPaths: ['/test', '/tmp', '/var/tmp', process.cwd()],
  workspaceRoot: process.cwd(),
  httpTimeoutMs: 5000,
  maxPayloadSizeBytes: 1024 * 1024,
  maxFileReadBytes: 100, // Small enough for testing limits
  imageCompressionThresholdBytes: 1024 * 1024,
  imageCompressionQuality: 75,
  defaultChecksumAlgorithm: 'sha256',
  maxRecursiveDepth: 5, // Small enough for testing depth limits
  recursiveSizeTimeoutMs: 1000, // Small enough for testing timeouts
  serverStartTimeIso: new Date().toISOString(),
  serverVersion: '1.0.0-test',
  maxUrlDownloadSizeBytes: 1024 * 1024,
  maxFileReadBytesFind: 1024 * 10,
  conduitExecutablePath: '/path/to/conduit',
  resultsCachePath: '/tmp/conduit-cache',
  pluginsPath: '/opt/conduit/plugins',
  pluginResultsCacheTTLSec: 3600,
  pluginErrorLogTTLSec: 86400,
  maxFileOpConcurrency: 5,
  maxPluginInvokeConcurrency: 2,
  maxFileSearchPreviewBytes: 2048,
  maxFileChunkSizeBytes: 1024 * 1024 * 4, // 4MB
  maxFileUploadSizeBytes: 1024 * 1024 * 25, // 25MB
  terminalHistoryPath: '/tmp/conduit-terminal-history',
  terminalCols: 80,
  terminalRows: 24,
  enableWebSearchTool: true,
  enableImageAnalysisTool: true,
  enablePlaywrightTool: true,
  enableTerminalTool: true,
  macOsScriptKbPath: '/path/to/kb',
  macOsAutomationTimeoutMs: 10000,
};

// Mocks for @/internal functions, to be used by tests that mock @/internal
export const mockGetMimeType = vi.fn();
export const mockFormatToISO8601UTC = vi.fn((date: Date) => date.toISOString());

// DO NOT mock @/internal here anymore. This will be done in each test file.
