import { conduitConfig } from './configLoader';
import { InfoNotice } from '@/types/common';
import os from 'os';
import path from 'path';

let firstUseMessageSent = false;

// Function to resolve default paths for the notice, mirroring configLoader logic for consistency
function getResolvedDefaultPaths(): string[] {
    const defaultRawPaths = "~:/tmp";
    return defaultRawPaths
        .split(':')
        .map(p => p.trim())
        .filter(p => p !== '')
        .map(inputPath => {
            if (inputPath.startsWith('~')) {
                return path.resolve(os.homedir(), inputPath.substring(1));
            }
            return path.resolve(inputPath);
        });
}

export function hasFirstUseMessageBeenSent(): boolean {
  return firstUseMessageSent;
}

export function markFirstUseMessageSent(): void {
  firstUseMessageSent = true;
}

/**
 * Checks if the CONDUIT_ALLOWED_PATHS environment variable was explicitly set by the user.
 * It assumes that if process.env.CONDUIT_ALLOWED_PATHS is undefined or an empty string,
 * the default was used.
 */
export function wasDefaultPathsUsed(): boolean {
  const envPath = process.env.CONDUIT_ALLOWED_PATHS;
  return envPath === undefined || envPath.trim() === '';
}

export function createInfoNotice(): InfoNotice | null {
  if (wasDefaultPathsUsed()) {
    return {
      type: "info_notice",
      notice_code: "DEFAULT_PATHS_USED",
      message: `INFO [conduit-mcp v${conduitConfig.serverVersion}, Server Started: ${conduitConfig.serverStartTimeIso}]: CONDUIT_ALLOWED_PATHS was not explicitly set by the user. Defaulting to allow access to resolved paths for '~' (home directory) and '/tmp' (system temporary directory). For production environments or enhanced security, it is strongly recommended to set the CONDUIT_ALLOWED_PATHS environment variable explicitly to only the required directories.`,
      details: {
        server_version: conduitConfig.serverVersion,
        server_start_time_iso: conduitConfig.serverStartTimeIso,
        default_paths_used: getResolvedDefaultPaths(),
      }
    };
  }
  return null;
}

/**
 * Prepends the info notice to a tool's response if applicable.
 * Modifies the response in place if it's an array, or wraps it if it's an object.
 * @param response The original tool response.
 * @returns The (potentially modified) response.
 */
export function prependInfoNoticeIfApplicable<T>(response: T): T | [InfoNotice, T] | [InfoNotice, ...any[]] {
    if (!hasFirstUseMessageBeenSent() && wasDefaultPathsUsed()) {
        const notice = createInfoNotice();
        if (notice) {
            markFirstUseMessageSent();
            if (Array.isArray(response)) {
                return [notice, ...response];
            } else {
                return [notice, response];
            }
        }
    }
    return response;
} 