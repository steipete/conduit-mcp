# Development Guide for conduit-mcp

This document provides guidelines for developing and contributing to the `conduit-mcp` server.

## Project Structure

The project is organized as follows:

```
conduit-mcp/
├── dist/                     # Compiled JavaScript output (e.g., after `npm run build`)
├── src/
│   ├── server.ts             # Main server entry point, MCP request/response router
│   ├── tools/                # Implementations for each of the 4 tools (read, write, list, find)
│   │   ├── readTool.ts
│   │   ├── writeTool.ts
│   │   ├── listTool.ts
│   │   └── findTool.ts
│   ├── operations/           # Business logic for complex operations (e.g., archive, find criteria)
│   │   ├── archiveOps.ts
│   │   └── findOps.ts
│   │   └── ... (other specific ops like getContent, putContent, etc. might be here or in tools directly)
│   ├── core/                 # Core functionalities shared across tools
│   │   ├── securityHandler.ts # Path validation (allowed paths, symlink resolution)
│   │   ├── fileSystemOps.ts  # Low-level fs promise wrappers, path manipulation
│   │   ├── webFetcher.ts     # HTTP client wrapper, HTML cleaning pipeline
│   │   ├── imageProcessor.ts # Image compression logic (Sharp)
│   │   ├── configLoader.ts   # Environment variable parsing, config object
│   │   ├── noticeService.ts  # Manages the one-time informational notice
│   │   └── mimeService.ts    # MIME type detection logic
│   ├── utils/                # General utility functions
│   │   ├── logger.ts         # Internal logging setup (Pino)
│   │   ├── errorHandler.ts   # Standardized error object creation, error codes
│   │   └── dateTime.ts       # Date/time formatting (ISO 8601 UTC)
│   └── types/                # TypeScript interface definitions
│       ├── mcp.ts            # General MCP request/response base structures
│       ├── tools.ts          # Specific parameter/return types for each tool
│       ├── config.ts         # Types for the parsed server configuration object
│       └── common.ts         # Common shared types (e.g., EntryInfo)
├── package.json
├── tsconfig.json
├── .env.example              # Example environment file
├── start.sh                  # Script to run locally
├── README.md
├── DEVELOPMENT.md            # This file
└── LICENSE
```

## Prerequisites

*   Node.js (version specified in `package.json` engines, e.g., >=18.0.0)
*   npm (comes with Node.js)

## Getting Started (Local Development)

1.  **Clone the repository:**
    ```bash
    git clone <repository_url_for_conduit-mcp>
    cd conduit-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment (Optional):**
    Copy `.env.example` to `.env` and customize variables as needed:
    ```bash
    cp .env.example .env
    # Edit .env with your preferred settings (e.g., CONDUIT_ALLOWED_PATHS)
    ```
    If `.env` is not present, the server will use default values or values from the MCP client's environment block.

4.  **Running the Server for Development:**
    The `start.sh` script can run the server directly using `tsx` for live reloading of TypeScript code:
    ```bash
    ./start.sh 
    ```
    Alternatively, you can use the npm script for development with `tsx` which often includes watching for file changes:
    ```bash
    npm run dev
    ```
    Configure your MCP client to use the local `start.sh` script or the `npm run dev` command if your client supports that directly (less common for MCP). For `start.sh`, an example client configuration is in `README.md`.

## Building for Production

To compile the TypeScript code to JavaScript (output to `dist/` directory):
```bash
npm run build
```
After building, `start.sh` will automatically prioritize running the compiled version from `dist/server.js`.

## Linting and Formatting

This project uses ESLint for linting and Prettier for code formatting.

*   **Check for linting errors:**
    ```bash
    npm run lint
    ```
*   **Automatically fix formatting issues with Prettier:**
    ```bash
    npm run format
    ```
It's recommended to set up your editor to format on save using Prettier and to show ESLint errors.

## Testing

The project uses Jest for testing. (Test files and more detailed testing strategies will be outlined as per the `TESTING PLAN` in `docs/spec.md`).

*   **Run all tests:**
    ```bash
    npm test
    ```
*   **Run tests in watch mode (reruns on file changes):**
    ```bash
    npm test -- --watch
    ```
*   **Run tests with coverage report:**
    ```bash
    npm test -- --coverage
    ```

Comprehensive tests (unit, integration, E2E) are crucial. Refer to the `Testing Plan` in `docs/spec.md` for the scope of tests to be implemented.

## Contribution Guidelines

1.  **Branching:** Create a new feature branch from `main` (or the current development branch) for your changes (e.g., `feature/my-new-tool` or `fix/some-bug`).
2.  **Commits:** Follow Conventional Commits specification (e.g., `feat: add new parameter to read tool`, `fix: resolve issue with path validation`). This helps in automated changelog generation and semantic versioning.
3.  **Code Style:** Adhere to the existing code style, enforced by ESLint and Prettier. Run `npm run format` and `npm run lint` before committing.
4.  **Testing:** Add relevant tests for your changes. Ensure all tests pass (`npm test`).
5.  **Pull Request (PR):**
    *   Push your feature branch to the remote repository.
    *   Create a PR against the `main` (or relevant development) branch.
    *   Provide a clear description of the changes in your PR.
    *   Ensure any related issues are linked.
    *   Wait for code review and address any feedback.
6.  **Merging:** Once approved and CI checks pass, the PR will be merged by a maintainer.

## Understanding the MCP Protocol

*   The server communicates via standard input (stdin) for requests and standard output (stdout) for responses.
*   Each request and response is a single JSON string per line.
*   The server **must not** write any other data (like logs) to stdout/stderr, as this will break MCP communication. Internal logging should be directed to a file (via `CONDUIT_LOG_PATH`) or be a no-op if not configured.
*   Refer to `docs/spec.md` and `src/types/mcp.ts` for the base MCP request/response structures.
*   Tool-specific parameters and response payloads are defined in `src/types/tools.ts`.

By following these guidelines, we can maintain a clean, consistent, and robust codebase. 