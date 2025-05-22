export interface ResolvedPath {
  original: string;
  resolved: string;
}

export type ConduitConfigType = 'development' | 'production' | 'test';

export interface ConduitServerConfig {
  logLevel: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  allowedPaths: string[]; // Resolved absolute paths
  workspaceRoot: string; // Added workspace root path
  httpTimeoutMs: number;
  maxPayloadSizeBytes: number;
  maxFileReadBytes: number;
  imageCompressionThresholdBytes: number;
  imageCompressionQuality: number;
  defaultChecksumAlgorithm: 'md5' | 'sha1' | 'sha256' | 'sha512';
  maxRecursiveDepth: number;
  recursiveSizeTimeoutMs: number;
  serverStartTimeIso: string; // Store server start time for info notice
  serverVersion: string; // Store server version for info notice
  maxUrlDownloadSizeBytes: number;
  maxFileReadBytesFind: number; // Max bytes to read from a file for find tool content search
  allowTildeExpansion?: boolean;

  // Additional properties for notice service and other components
  isDefaultPathsUsed?: boolean; // Whether default paths were used
  resolvedDefaultPathsUsed?: string[]; // The actual default paths that were resolved
  userDidSpecifyAllowedPaths: boolean; // Whether user explicitly set CONDUIT_ALLOWED_PATHS
  resolvedAllowedPaths: string[]; // The resolved allowed paths
}
