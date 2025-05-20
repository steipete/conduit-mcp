export interface ConduitServerConfig {
  logLevel: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  allowedPaths: string[]; // Resolved absolute paths
  httpTimeoutMs: number;
  maxPayloadSizeBytes: number;
  maxFileReadBytes: number;
  maxUrlDownloadBytes: number;
  imageCompressionThresholdBytes: number;
  imageCompressionQuality: number;
  defaultChecksumAlgorithm: 'md5' | 'sha1' | 'sha256' | 'sha512';
  maxRecursiveDepth: number;
  recursiveSizeTimeoutMs: number;
  serverStartTimeIso: string; // Store server start time for info notice
  serverVersion: string; // Store server version for info notice
} 