import { InfoNotice, ConduitServerConfig } from '@/internal';

let firstUseNoticeSent: boolean = false;

export function hasFirstUseNoticeBeenSent(): boolean {
  return firstUseNoticeSent;
}

export function markFirstUseNoticeSent(): void {
  firstUseNoticeSent = true;
}

export function generateFirstUseNotice(config: ConduitServerConfig): InfoNotice | null {
  if (config.userDidSpecifyAllowedPaths) {
    return null;
  }

  return {
    type: 'info_notice',
    notice_code: 'DEFAULT_PATHS_USED',
    message: `INFO [conduit-mcp v${config.serverVersion}, Server Started: ${config.serverStartTimeIso}]: CONDUIT_ALLOWED_PATHS was not explicitly set... Defaulting to allow access to resolved paths for '~' and '/tmp'. ...set CONDUIT_ALLOWED_PATHS explicitly...`,
    details: {
      server_version: config.serverVersion,
      server_start_time_iso: config.serverStartTimeIso,
      default_paths_used: config.resolvedAllowedPaths,
    },
  };
}
