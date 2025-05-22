import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConduitServerConfig } from '../types/config';
import { getCurrentISO8601UTC } from '../utils/dateTime';
import logger from '../utils/logger';

function parseEnvInt(envVar: string | undefined, defaultValue: number): number {
  if (envVar === undefined || envVar === '') return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (isNaN(parsed)) {
    logger.warn(`Invalid integer value for env var. Using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvString<T extends string>(
  envVar: string | undefined,
  defaultValue: T,
  allowedValues?: ReadonlyArray<T>
): T {
  if (envVar === undefined || envVar === '') return defaultValue;
  if (
    allowedValues &&
    !allowedValues.includes(envVar.toUpperCase() as T) &&
    !allowedValues.includes(envVar.toLowerCase() as T)
  ) {
    logger.warn(
      `Invalid value for env var. Received "${envVar}". Allowed: ${allowedValues.join(', ')}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return envVar as T;
}

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.resolve(os.homedir(), inputPath.substring(1));
  }
  return path.resolve(inputPath);
}

const serverStartTime = getCurrentISO8601UTC();

export function loadConfig(): ConduitServerConfig {
  // Use npm_package_version (available in npm scripts) or fallback to package.json
  const serverVersion =
    process.env.npm_package_version ||
    (() => {
      try {
        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
        const { version } = JSON.parse(packageJsonContent);
        return version;
      } catch {
        logger.warn('Failed to read package.json version, using default: 0.0.0-dev');
        return '0.0.0-dev';
      }
    })();

  const userDidSpecifyAllowedPaths = 'CONDUIT_ALLOWED_PATHS' in process.env;
  const rawAllowedPaths = process.env.CONDUIT_ALLOWED_PATHS || '~:/tmp';
  const resolvedAllowedPaths = rawAllowedPaths
    .split(':')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map(resolvePath);

  if (resolvedAllowedPaths.length === 0) {
    logger.error(
      'CONDUIT_ALLOWED_PATHS resolved to an empty list. This is a critical misconfiguration.'
    );
    // Potentially throw an error here to prevent server startup with no accessible paths
    // For now, it will continue, but securityHandler will block all fs access.
  }
  const currentWorkingDirectory = path.resolve(process.cwd());

  const config: ConduitServerConfig = {
    workspaceRoot: currentWorkingDirectory,
    logLevel: parseEnvString(process.env.LOG_LEVEL, 'INFO', [
      'TRACE',
      'DEBUG',
      'INFO',
      'WARN',
      'ERROR',
      'FATAL',
    ] as const).toUpperCase() as ConduitServerConfig['logLevel'],
    allowedPaths: resolvedAllowedPaths,
    httpTimeoutMs: parseEnvInt(process.env.CONDUIT_HTTP_TIMEOUT_MS, 30000),
    maxPayloadSizeBytes: parseEnvInt(process.env.CONDUIT_MAX_PAYLOAD_SIZE_BYTES, 10485760),
    maxFileReadBytes: parseEnvInt(process.env.CONDUIT_MAX_FILE_READ_BYTES, 52428800),
    maxFileReadBytesFind: parseEnvInt(process.env.CONDUIT_MAX_FILE_READ_BYTES_FIND, 524288),
    maxUrlDownloadSizeBytes: parseEnvInt(process.env.CONDUIT_MAX_URL_DOWNLOAD_SIZE_BYTES, 20971520),
    imageCompressionThresholdBytes: parseEnvInt(
      process.env.CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES,
      1048576
    ),
    imageCompressionQuality: parseEnvInt(process.env.CONDUIT_IMAGE_COMPRESSION_QUALITY, 75),
    defaultChecksumAlgorithm: parseEnvString(
      process.env.CONDUIT_DEFAULT_CHECKSUM_ALGORITHM,
      'sha256',
      ['md5', 'sha1', 'sha256', 'sha512'] as const
    ) as ConduitServerConfig['defaultChecksumAlgorithm'],
    maxRecursiveDepth: parseEnvInt(process.env.CONDUIT_MAX_RECURSIVE_DEPTH, 10),
    recursiveSizeTimeoutMs: parseEnvInt(process.env.CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS, 60000),
    serverStartTimeIso: serverStartTime,
    serverVersion: serverVersion,
    userDidSpecifyAllowedPaths,
    resolvedAllowedPaths,
  };

  // Validate imageCompressionQuality range
  if (config.imageCompressionQuality < 1 || config.imageCompressionQuality > 100) {
    logger.warn(
      `CONDUIT_IMAGE_COMPRESSION_QUALITY (${config.imageCompressionQuality}) out of range (1-100). Clamping to 75.`
    );
    config.imageCompressionQuality = 75;
  }

  logger.info('Server configuration loaded successfully.');
  logger.debug({ config }, 'Active server configuration');

  return config;
}
