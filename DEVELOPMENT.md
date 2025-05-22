# Development Guide for conduit-mcp

This document provides guidelines for developing and contributing to the `conduit-mcp` server.

## Project Structure

The project follows a typical Node.js/TypeScript server architecture with clear separation of concerns:

- **`src/`** - TypeScript source code
  - **`server.ts`** - Main server entry point and MCP request/response router
  - **`tools/`** - Tool implementations (`readTool.ts`, `writeTool.ts`, `listTool.ts`, `findTool.ts`, `testTool.ts`)
  - **`operations/`** - Business logic for complex operations
    - `getContentOps.ts` - URL fetching, partial reads, content type handling
    - `putContentOps.ts` - File writing and appending logic
    - `metadataOps.ts` - Metadata fetching and formatting
    - `archiveOps.ts` - ZIP/TAR.GZ creation and extraction
    - `diffOps.ts` - File comparison logic
    - `findOps.ts` - Core find logic and criteria matching
  - **`core/`** - Core shared functionalities
    - `securityHandler.ts` - Path validation and symlink resolution
    - `fileSystemOps.ts` - Low-level filesystem operations
    - `webFetcher.ts` - HTTP client and HTML cleaning pipeline
    - `imageProcessor.ts` - Image compression using Sharp
    - `configLoader.ts` - Environment variable parsing and configuration
    - `noticeService.ts` - First-use informational notice management
    - `mimeService.ts` - MIME type detection
  - **`utils/`** - General utility functions
    - `logger.ts` - Internal logging setup (Pino)
    - `errorHandler.ts` - Standardized error handling and mapping
    - `dateTime.ts` - ISO 8601 UTC date/time formatting
  - **`types/`** - TypeScript interface definitions
    - `mcp.ts` - MCP request/response structures
    - `tools.ts` - Tool-specific parameter and return types
    - `config.ts` - Configuration object types
    - `common.ts` - Shared types (e.g., EntryInfo)
- **`tests/`** - Test suites mirroring the src structure
- **`docs/`** - Technical specification and documentation
- **`dist/`** - Compiled JavaScript output (after `npm run build`)

## Prerequisites

- **Node.js** - Version 18.x or 20.x LTS (as specified in `package.json` engines field)
- **npm** - Comes with Node.js installation

## Getting Started / Local Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd conduit-mcp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

The server is configured via environment variables with sensible defaults. For local development, you can:

**Option A: Set environment variables directly**

```bash
export CONDUIT_ALLOWED_PATHS="~:/tmp:/your/project/path"
export LOG_LEVEL="DEBUG"
export CONDUIT_MAX_FILE_READ_BYTES="104857600"
```

**Option B: Create a `.env` file** (recommended for development)

If an `.env.example` file exists, copy it to `.env` to get started:

```bash
# cp .env.example .env (if .env.example exists)
```

Then edit `.env` with your preferred settings. Key variables include:

- `CONDUIT_ALLOWED_PATHS="~:/tmp:/your/development/paths"`
- `LOG_LEVEL="DEBUG"`
- `CONDUIT_HTTP_TIMEOUT_MS="30000"`

Refer to `README.md` or `docs/spec.md` for a full list of `CONDUIT_*` environment variables and their descriptions.

**Important Configuration Notes:**

- **`CONDUIT_ALLOWED_PATHS`**: Colon-separated list of directories the server can access. Defaults to `~:/tmp` if not set. Use `~` for home directory (automatically resolved). Example: `"~/projects:/workspace:/tmp"`.
- **Security**: Always set `CONDUIT_ALLOWED_PATHS` explicitly for production use.
- **First-run notice**: If using defaults for allowed paths, the server sends a one-time informational message in the first MCP response.

### 4. Running the Server

**For Development (with hot reload):**

```bash
npm run dev
```

This typically uses `tsx` to run `src/server.ts` and watches for changes.

**Using the `start.sh` script:**

```bash
./start.sh
```

This script attempts to run the compiled version from `dist/server.js` first, and falls back to using `tsx` with `src/server.ts` if the compiled version isn't found. It also handles a local `tsx` installation if needed.

**Build for Production:**

```bash
npm run build
```

This compiles the TypeScript source to JavaScript in the `dist/` directory.

**Run Compiled Production Version:**

```bash
node dist/server.js
```

### 5. Using with an MCP Client

When running the server locally (either via `npm run dev` or `./start.sh`), configure your MCP client (e.g., in its `mcp.json`) to connect to your local instance. If using `./start.sh`, the command would be the absolute path to the script:

```json
{
  "mcpServers": {
    "conduit_mcp_local": {
      "command": "/absolute/path/to/your/cloned/conduit-mcp/start.sh",
      "env": {
        "LOG_LEVEL": "DEBUG",
        "CONDUIT_ALLOWED_PATHS": "~/your/development/paths:/another/path"
        // Add other CONDUIT_* variables as needed
      }
    }
  }
}
```

If running directly with `npm run dev`, the client would need to know how to invoke that (which might be more complex if `npm run dev` involves `tsx watch`). Using `start.sh` is generally more straightforward for client configuration pointing to a local dev version.

## Building for Production

To compile the TypeScript code to JavaScript for production deployment:

```bash
npm run build
```

This command compiles all TypeScript files in the `src/` directory to JavaScript files in the `dist/` directory using the TypeScript compiler (`tsc`). The compiled output (`dist/server.js`) can then be run directly with Node.js:

```bash
node dist/server.js
```

The `start.sh` script automatically prioritizes running the compiled version from `dist/server.js` when available, making it suitable for production use.

## Running Tests

The project uses Vitest as the testing framework with comprehensive test coverage goals as specified in `docs/spec.md` Section 8.

- **Run all tests:**

  ```bash
  npm test
  ```

- **Run tests in watch mode (reruns on file changes):**

  ```bash
  npm run test:watch
  ```

- **Run tests with coverage report:**
  ```bash
  npm run coverage
  ```

The test suite includes unit tests, integration tests, and end-to-end testing to ensure reliability and correctness of all functionality. Test files are organized in the `tests/` directory, mirroring the structure of the `src/` directory.

## End-to-End (E2E) Testing

The project includes a comprehensive E2E testing suite that validates the complete MCP server functionality by running real scenarios against the actual server implementation.

### How to Run E2E Tests

```bash
npm run test:e2e
```

This command runs all E2E tests in the `e2e/` directory using Vitest with a specialized configuration (`vitest.config.e2e.ts`).

### Directory Structure

- **`e2e/`** - Root directory for all E2E tests
- **`e2e/*.e2e.test.ts`** - Test files for each tool/functional area:
  - `archive.e2e.test.ts` - Tests for archive operations (ZIP/TAR.GZ creation and extraction)
  - `find.e2e.test.ts` - Tests for the find tool functionality
  - `list.e2e.test.ts` - Tests for directory listing operations
  - `read.e2e.test.ts` - Tests for file reading and content retrieval
  - `testTool.e2e.test.ts` - Tests for the test tool functionality
  - `write.e2e.test.ts` - Tests for file writing and creation operations
- **`e2e/scenarios/`** - Directory containing JSON scenario definitions:
  - `*.scenarios.json` - JSON files defining specific test scenarios with payloads, expected outcomes, and filesystem setup requirements
  - `README.md` - Documentation explaining the scenario file format and structure
- **`e2e/utils/`** - Utility modules supporting E2E test execution:
  - `e2eTestRunner.ts` - Core script for executing the Conduit MCP server and capturing results
  - `scenarioLoader.ts` - Utility for loading and parsing scenario files
  - `tempFs.ts` - Utilities for managing temporary files and directories during tests

### Writing E2E Tests

E2E tests are scenario-driven, using JSON scenario files to define inputs and expected outputs:

1. **Define scenarios**: Create or update `*.scenarios.json` files in `e2e/scenarios/` with test cases that specify:
   - MCP request payloads
   - Expected response structures
   - Filesystem setup requirements
   - Validation criteria

2. **Implement test logic**: Add corresponding test implementations in the appropriate `*.e2e.test.ts` file that:
   - Load scenarios using `scenarioLoader.ts`
   - Execute tests using `e2eTestRunner.ts`
   - Validate results against expected outcomes

3. **Manage test data**: Use `tempFs.ts` utilities to create and clean up temporary files and directories needed for test scenarios.

This approach ensures that E2E tests validate real-world usage patterns while maintaining consistency and reusability across different test scenarios.

## Linting and Formatting

This project uses ESLint for linting and Prettier for code formatting to maintain consistent code quality and style.

- **Check for linting errors:**

  ```bash
  npm run lint
  ```

- **Automatically fix formatting issues with Prettier:**
  ```bash
  npm run format
  ```

The configuration includes TypeScript-specific ESLint rules (`@typescript-eslint/eslint-plugin`) and Prettier integration (`eslint-config-prettier`, `eslint-plugin-prettier`). It's recommended to configure your editor to format on save using Prettier and display ESLint errors inline for the best development experience.

## Contribution Guidelines

### General Principles

We welcome contributions to `conduit-mcp`! To ensure a smooth collaboration process:

- **Open communication**: Please open an issue before starting work on significant features or bug fixes to discuss the approach and avoid duplicated effort.
- **Coding style**: Follow the project's established coding conventions enforced by ESLint and Prettier configurations.
- **Quality first**: Prioritize clear, maintainable code with appropriate test coverage.

### Branching Strategy

We use a simple branching model centered around the `main` branch:

- **`main`**: Contains stable, production-ready code and serves as the target for releases.
- **Feature branches**: Create feature branches from `main` using descriptive names:
  - `feat/new-tool-name` for new features
  - `fix/issue-description` for bug fixes
  - `docs/update-readme` for documentation updates
  - `chore/dependency-updates` for maintenance tasks
- **Pull requests**: Submit PRs back to `main` branch for review and integration.

### Committing Code

#### Conventional Commits

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. Use these commit prefixes:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `test:` for adding or updating tests
- `chore:` for maintenance tasks, dependency updates, or build configuration changes
- `refactor:` for code restructuring without functional changes

**Examples:**

```
feat: add compression support to archive operations
fix: resolve path traversal vulnerability in file operations
docs: update API examples in README
test: add integration tests for web fetcher
chore: update dependencies to latest versions
```

**Benefits:** Conventional commits enable automated changelog generation, semantic versioning, and better project history tracking.

#### Commit Message Guidelines

- Write clear, concise commit messages in the imperative mood
- Keep the first line under 72 characters
- Provide additional context in the commit body if needed
- Reference relevant issue numbers (e.g., "Closes #123" or "Fixes #456")

### Pull Requests (PRs)

#### Before Submitting

Ensure your code meets quality standards:

1. **Tests pass**: Run `npm test` and verify all tests pass
2. **Code is linted**: Run `npm run lint` and fix any issues
3. **Code is formatted**: Run `npm run format` to ensure consistent styling
4. **Build succeeds**: Run `npm run build` to verify TypeScript compilation

#### PR Requirements

- **Target branch**: Submit PRs against the `main` branch
- **Clear description**: Provide a comprehensive description of your changes, including:
  - What problem the PR solves
  - How the solution works
  - Any breaking changes or migration steps
- **Link issues**: Reference related issues using GitHub's linking syntax (e.g., "Closes #123")
- **Test coverage**: Include appropriate tests for new functionality or bug fixes
- **Documentation**: Update relevant documentation if your changes affect the API or usage

#### Code Review Process

- **Peer review**: All PRs require at least one approving review from a project maintainer
- **Feedback**: Address review feedback promptly and be open to suggestions
- **CI checks**: Ensure all automated checks (tests, linting, building) pass before requesting review
- **Merge strategy**: Maintainers will merge approved PRs using squash-and-merge to maintain a clean commit history

### Coding Style

The project maintains consistent code style through automated tooling:

- **ESLint**: Enforces TypeScript-specific linting rules and best practices
- **Prettier**: Handles code formatting automatically
- **Configuration files**: `.eslintrc.json` and `.prettierrc` define the project's style rules

**Editor setup**: Configure your editor to:

- Format on save using Prettier
- Display ESLint errors inline
- Use the project's TypeScript configuration for accurate IntelliSense

For the best development experience, run `npm run format` and `npm run lint` regularly during development, and consider setting up pre-commit hooks to automate these checks.

## Understanding the MCP Protocol

- The server communicates via standard input (stdin) for requests and standard output (stdout) for responses.
- Each request and response is a single JSON string per line.
- The server **must not** write any other data (like logs) to stdout/stderr, as this will break MCP communication. Internal logging should be directed to a file (via `CONDUIT_LOG_PATH`) or be a no-op if not configured.
- Refer to `docs/spec.md` and `src/types/mcp.ts` for the base MCP request/response structures.
- Tool-specific parameters and response payloads are defined in `src/types/tools.ts`.

By following these guidelines, we can maintain a clean, consistent, and robust codebase.
