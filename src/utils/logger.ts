import pino, { LoggerOptions, Logger } from 'pino';

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

if (process.env.CONDUIT_LOG_PATH) {
  logger = pino(pinoOptions, pino.destination(process.env.CONDUIT_LOG_PATH));
} else if (process.env.NODE_ENV === 'test') {
  // During tests, make it a no-op logger unless a path is specified
  logger = pino({ ...pinoOptions, level: 'silent' });
} else {
  // For MCP, default to a no-op logger if no path is specified, to prevent stdout/stderr pollution.
  // The spec is a bit ambiguous here. It says "no-op logger by default if not explicitly configured for output"
  // This interprets "explicitly configured for output" as setting CONDUIT_LOG_PATH.
  // We will use pino's ability to write to an NUL stream equivalent or make it silent.
  const nullStream = {
    write: () => {},
  };
  logger = pino(pinoOptions, nullStream);
  // Alternatively, to make it truly silent and less overhead:
  // logger = pino({ ...pinoOptions,ระดับ: 'silent' });
  // Or, even more simply, if no features of pino are needed when it's no-op:
  // logger = pino({ enabled: false });
}

// Initial log to confirm logger setup, this will only go to file if CONDUIT_LOG_PATH is set.
logger.info(`Internal logger initialized with level: ${pinoOptions.level}`);
if (process.env.CONDUIT_LOG_PATH) {
  logger.info(`Logging to file: ${process.env.CONDUIT_LOG_PATH}`);
} else {
  logger.info(
    'Internal logging to stdout/stderr is disabled for MCP compliance (defaulting to no-op). Set CONDUIT_LOG_PATH to enable file logging.'
  );
}

export default logger;
