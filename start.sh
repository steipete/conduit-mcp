#!/bin/bash
# start.sh: Runs the conduit-mcp server, prioritizing compiled build, then source.

# Default LOG_LEVEL to INFO if not set by the environment
# This is for the server's internal logging mechanisms, not for stdout/stderr.
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

# Determine the absolute path to the script's directory, then the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Define paths for compiled and source entry points
DIST_SERVER_JS="$PROJECT_ROOT/dist/src/mcp-server.js" # Anticipated compiled output location
SRC_SERVER_TS="$PROJECT_ROOT/src/mcp-server.ts"   # Main TypeScript source file

# Note: The CONDUIT_ALLOWED_PATHS default and its validation is handled by the server application itself.
# This script no longer needs to check for it, allowing the server to manage the default
# and the one-time informational notice through the MCP response.

# Check if a compiled version exists
if [ -f "$DIST_SERVER_JS" ]; then
  # (Internal server log, if active, would note: "Running compiled version from $DIST_SERVER_JS")
  exec node "$DIST_SERVER_JS"
else
  # (Internal server log, if active, would note: "Compiled version not found. Attempting to run from source $SRC_SERVER_TS using tsx.")
  
  # Check for tsx: first in local node_modules, then global path
  LOCAL_TSX_PATH="$PROJECT_ROOT/node_modules/.bin/tsx"
  TSX_CMD=""

  if [ -f "$LOCAL_TSX_PATH" ]; then
    TSX_CMD="$LOCAL_TSX_PATH"
  elif command -v tsx &> /dev/null; then
    TSX_CMD="tsx"
  fi

  # If tsx is not found after initial checks, attempt to install it locally (dev dependency style).
  # This output to stderr is acceptable as it's a bootstrap/dev environment issue.
  if [ -z "$TSX_CMD" ]; then
    echo "WARN: [conduit-mcp/start.sh] tsx command not found. Attempting to install it locally (will not be saved to package.json)..." >&2
    # Execute npm install in the project root context
    (cd "$PROJECT_ROOT" && npm install tsx --no-save)
    # Re-check for local tsx after attempting install
    if [ -f "$LOCAL_TSX_PATH" ]; then
      TSX_CMD="$LOCAL_TSX_PATH"
    else
      # If still not found, error out.
      echo "ERROR: [conduit-mcp/start.sh] Failed to find or install tsx. Please install tsx globally ('npm install -g tsx') or ensure it's a devDependency and install project dependencies, or build the project first." >&2
      exit 1
    fi
  fi
  
  # (Internal server log, if active, would note: "Executing server with: $TSX_CMD $SRC_SERVER_TS")
  exec "$TSX_CMD" "$SRC_SERVER_TS"
fi 