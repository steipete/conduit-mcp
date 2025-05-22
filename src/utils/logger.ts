import pino, { LoggerOptions, Logger } from 'pino';
import os from 'os';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'INFO';

const pinoOptions: LoggerOptions = {
  level: logLevel.toLowerCase(),
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// By default, pino writes to stdout. For MCP compliance, we need to ensure
// that internal server logging does not interfere with MCP communication.
// The spec states: "The server must not write any operational logs to stdout or stderr."
// "It should be implemented with an internal, configurable logging mechanism (e.g., using pino)
// that can be configured to write to a file, a logging service, or be a no-op logger by default
// if not explicitly configured for output."

// This basic setup will log to stdout if LOG_LEVEL is set. To make it a true no-op
// or file-based logger by default without external config, further changes would be needed here
// (e.g., checking an additional env var for a log file path, or using pino.destination('/dev/null')).
// For now, it adheres to using LOG_LEVEL and standard pino behavior.
// A more robust solution for MCP would be to make 'stream' conditional.

let logger: Logger;

const logFilePathFromEnv = process.env.CONDUIT_LOG_FILE_PATH;

if (logFilePathFromEnv === 'NONE') {
  // Explicitly disable logging
  logger = pino({ ...pinoOptions, enabled: false });
} else if (logFilePathFromEnv) {
  // Log to the specified file path
  logger = pino(pinoOptions, pino.destination(logFilePathFromEnv));
} else if (process.env.NODE_ENV === 'test') {
  // During tests, make it a no-op logger unless a path is specified or "NONE"
  logger = pino({ ...pinoOptions, level: 'silent' }); // Or enabled: false if preferred
} else {
  // Default to logging to [SYSTEM_TEMP_DIR]/conduit-mcp.log
  const defaultLogDir = os.tmpdir();
  const defaultLogFile = path.join(defaultLogDir, 'conduit-mcp.log');
  try {
    logger = pino(pinoOptions, pino.destination(defaultLogFile));
  } catch (error) {
    // Fallback to no-op if default log file creation fails (e.g., permissions)
    console.error(
      `Failed to create default log file at ${defaultLogFile}: ${error instanceof Error ? error.message : String(error)}. Logging will be disabled.`
    );
    logger = pino({ ...pinoOptions, enabled: false });
  }
}

// Initial log to confirm logger setup
if (logFilePathFromEnv === 'NONE') {
  // Log to console because the main logger is disabled.
  console.log(`Internal logger is explicitly disabled via CONDUIT_LOG_FILE_PATH="NONE".`);
} else if (process.env.NODE_ENV === 'test' && pinoOptions.level === 'silent') {
  // No log needed for silent test logger, or it might print if level was overridden by LOG_LEVEL
  // If truly silent, isLevelEnabled('info') would be false.
} else {
  // Check if the logger is actually enabled and configured to log at the default/current level.
  // Use a common level like 'info' for this check, assuming pinoOptions.level is 'info' or more verbose.
  if (logger.isLevelEnabled(pinoOptions.level || 'info')) {
    if (logFilePathFromEnv) {
      logger.info(`Internal logger initialized. Logging to file: ${logFilePathFromEnv}`);
    } else {
      // This case covers the default log file path since "NONE" and explicit path are handled above.
      const defaultLogFile = path.join(os.tmpdir(), 'conduit-mcp.log');
      logger.info(`Internal logger initialized. Logging to default file: ${defaultLogFile}`);
    }
  } else {
    // This case would be unusual if not NODE_ENV=test and not NONE, implies log level is very restrictive e.g. fatal only
    // or some other issue like failed stream, but we have a try-catch for that.
    // For safety, we can log to console if logger seems non-operational for info messages.
    console.log(
      `Internal logger configured, but current log level (${pinoOptions.level}) may prevent initialization messages. Check CONDUIT_LOG_FILE_PATH or LOG_LEVEL.`
    );
  }
}

export default logger;
