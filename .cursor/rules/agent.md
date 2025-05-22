# Conduit MCP Development Guidelines

This document provides comprehensive guidelines for developing and maintaining the `conduit-mcp` project, an MCP (Model Context Protocol) server for rich file system operations, web content fetching, image processing, search, diff, and archives.

## Project Overview & Structure

### Purpose

`conduit-mcp` is an MCP server that provides secure, validated file system operations and content processing through a JSON-RPC interface. It serves as a bridge between AI agents and system resources with built-in security controls.

### Key Directories Structure

```
conduit-mcp/
├── src/                    # Main source code
│   ├── core/              # Core functionality
│   ├── operations/        # Business logic operations
│   ├── tools/             # MCP tool handlers
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── server.ts          # Main server entry point
├── tests/                 # Unit tests (mirrors src/ structure)
├── e2e/                   # End-to-end tests
│   ├── scenarios/         # JSON test scenario definitions
│   ├── utils/             # E2E testing utilities
│   └── *.e2e.test.ts     # E2E test files
└── docs/                  # Documentation
    └── spec.md            # Primary specification
```

### Server Entry Point

- **Source**: `src/server.ts`
- **Compiled**: `dist/src/server.js` (after `npm run build`)
- **Startup**: `./start.sh` script

## Security First - Core Principle

### Mandatory Path Validation

**CRITICAL**: ALL file/path operations MUST use `validateAndResolvePath` from `src/core/securityHandler.ts:37`. This is the single most important security requirement.

```typescript
import { validateAndResolvePath } from '@/core/securityHandler';

// Required usage pattern:
const validatedPath = await validateAndResolvePath(userInputPath, {
  isExistenceRequired: true, // true if file must exist
  checkAllowed: true, // true (default) to check against allowed paths
  forCreation: false, // true if creating new file/directory
});
```

#### Path Validation Options

- `isExistenceRequired`: Throws `ERR_FS_NOT_FOUND` if path doesn't exist
- `checkAllowed`: Validates path is within `CONDUIT_ALLOWED_PATHS` (default: true)
- `forCreation`: Validates parent directory for file/directory creation operations

### Configuration Security

Environment variables control security boundaries:

- `CONDUIT_ALLOWED_PATHS`: Colon-separated list of allowed path prefixes (default: `~:/tmp`)
- `CONDUIT_TEMP_DIR`: Temporary directory for operations
- `CONDUIT_MAX_PAYLOAD_SIZE`: Maximum request payload size

## Error Handling Standards

### Consistent JSON Response Structure

ALL tool responses MUST follow this structure:

```typescript
{
  tool_name: string,
  status: 'success' | 'error',
  results?: any,           // Present on success
  error_code?: string,     // Present on error
  error_message?: string   // Present on error
}
```

### Server Exit Code Convention

**CRITICAL**: Server always exits with code 0 if it can produce a JSON response. Error conditions are signaled _within_ the JSON response, not through process exit codes.

This means:

- E2E tests check `response.status` for logical success/error
- Process `exitCode` is used only for startup/parsing failures
- Tool errors are communicated via JSON `error_code` and `error_message`

## Development Workflow & Conventions

### TypeScript Guidelines

- Use strict TypeScript configurations (`strict: true`)
- Prefer specific types over `any` (ESLint warns on `@typescript-eslint/no-explicit-any`)
- Prefix intentionally unused variables with `_` (e.g., `_unusedParam`)
- Import types from `src/types/` for consistency

### Module Resolution

- Use path alias `@/*` for `src/*` imports
- Module system: CommonJS output (`"module": "commonjs"` in tsconfig)
- Remove `"type": "module"` from package.json to avoid conflicts

### Code Style

- Follow existing patterns in the codebase
- Use consistent naming conventions
- Leverage existing utilities (e.g., `fs-extra` for file operations)
- Always check imports and dependencies before using libraries

## Testing Strategy

### Unit Tests

- **Location**: `tests/` directory (mirrors `src/` structure)
- **Command**: `npm test`
- **Framework**: Vitest with TypeScript support
- **Coverage**: `npm run coverage`

#### Common Mock Patterns

```typescript
import { vi } from 'vitest';

// Mock Node.js modules
vi.mock('fs', () => ({
  /* mock implementation */
}));
vi.mock('fs-extra', () => ({
  /* mock implementation */
}));

// Mock internal modules
vi.mock('@/core/securityHandler', () => ({
  validateAndResolvePath: vi.fn(),
}));

// Reset mocks in test lifecycle
beforeEach(() => {
  vi.resetAllMocks(); // or vi.clearAllMocks()
});
```

#### Frequently Mocked Modules

- `fs`, `fs-extra`, `os` (Node.js modules)
- `@/core/securityHandler`, `@/core/configLoader`, `@/core/fileSystemOps` (internal)

### End-to-End (E2E) Tests

- **Location**: `e2e/` directory
- **Command**: `npm run test:e2e`
- **Framework**: Vitest with custom runner (`e2e/utils/e2eTestRunner.ts:17`)

#### Scenario-Driven Testing

E2E tests use JSON scenario files in `e2e/scenarios/`:

```json
{
  "scenarios": [
    {
      "name": "scenario_identifier",
      "description": "Human-readable description",
      "request_payload": {
        "tool_name": "find",
        "params": {
          /* tool parameters */
        }
      },
      "expected_exit_code": 0,
      "expected_stdout": {
        "tool_name": "find",
        "status": "success",
        "results": {
          /* expected results */
        }
      },
      "filesystem_effects": {
        "created_files": [],
        "modified_files": [],
        "deleted_files": []
      }
    }
  ]
}
```

#### E2E Test Structure

```typescript
import { runConduitMCPScript, createMCPRequest } from '@/e2e/utils/e2eTestRunner';

test('scenario description', async () => {
  const request = createMCPRequest('tools/call', {
    name: 'find',
    arguments: {
      /* params */
    },
  });

  const result = await runConduitMCPScript(request, envVars);

  expect(result.exitCode).toBe(0);
  expect(result.response.status).toBe('success');
  // Validate specific response fields
});
```

#### Test Environment Management

- Use `e2e/utils/tempFs.ts` for test workspace management
- Functions: `setupTestEnvironment()`, `cleanupTestEnvironment()`, `testWorkspaceDir`
- Temporary files created in `e2e/test-workspace/` during tests

## Configuration Management

### Core Configuration (`src/core/configLoader.ts:46`)

Key environment variables and defaults:

```typescript
// Security
CONDUIT_ALLOWED_PATHS = '~:/tmp'; // Allowed filesystem access
CONDUIT_TEMP_DIR; // Temporary directory

// Limits
CONDUIT_MAX_PAYLOAD_SIZE_BYTES = 10485760; // 10MB request limit
CONDUIT_MAX_FILE_READ_BYTES = 52428800; // 50MB file read limit
CONDUIT_HTTP_TIMEOUT_MS = 30000; // 30s HTTP timeout

// Image Processing
CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 1048576; // 1MB
CONDUIT_IMAGE_COMPRESSION_QUALITY = 75; // 1-100

// Logging
LOG_LEVEL = 'INFO'; // TRACE,DEBUG,INFO,WARN,ERROR,FATAL
```

## Linting and Formatting

### Commands

- `npm run lint`: Run ESLint checks
- `npm run format`: Format code with Prettier

### ESLint Configuration (`eslint.config.js`)

- **Format**: Flat config (ESLint 9+)
- **Parser**: `@typescript-eslint/parser`
- **Key Rules**:
  - `@typescript-eslint/no-unused-vars`: Error (prefix with `_` for intentional)
  - `@typescript-eslint/no-explicit-any`: Warning (prefer specific types)
  - `import/no-unresolved`: Error (ensure imports resolve correctly)

### Type-Aware Linting

- `parserOptions.project`: Points to `./tsconfig.json`
- Covers `src/**/*.ts`, `tests/**/*.ts`, `e2e/**/*.ts`

## Build Process

### Commands

- `npm run build`: Compile TypeScript to `dist/`
- `npm run dev`: Development mode with file watching

### Output Structure

- Source: `src/` → Compiled: `dist/src/`
- Main entry: `dist/src/server.js`
- Declarations: Generated with source maps

## Documentation Standards

### Primary Documents

- `docs/spec.md`: Complete tool specification (MUST stay aligned with implementation)
- `DEVELOPMENT.md`: Developer setup and testing guide
- `README.md`: Project overview and quick start

### Code Documentation

- Use TSDoc comments for public APIs
- Document complex algorithms and security considerations
- Include examples for non-obvious usage patterns

## Key Learnings & Pitfalls

### TypeScript Module Resolution

**Issue**: Conflicts between `package.json` `"type": "module"` and `tsconfig.json` `"module": "commonjs"`
**Resolution**: Remove `"type": "module"` from package.json; let TypeScript handle module aspects

### ESLint Flat Configuration

**Issue**: Migration from legacy `.eslintrc` to flat config
**Resolution**: Use `eslint.config.js` with proper `parserOptions.project` setup for type-aware linting

### Server Exit Code Convention

**Issue**: E2E tests failing due to exit code expectations
**Resolution**: Server exits 0 for JSON responses; check `response.status` for tool success/failure

### File System Utilities

**Preference**: Use `fs-extra` over standard `fs` for:

- `emptyDirSync()`, `ensureDirSync()`, `removeSync()` in tests
- More reliable setup/teardown operations
- Better error handling

### Mock Management in Tests

**Best Practice**: Always reset mocks in `beforeEach`/`afterEach`:

```typescript
beforeEach(() => {
  vi.resetAllMocks(); // Clears call history and reset implementations
});
```

## Agent Usage Notes (Meta)

When using Claude Code MCP for file operations:

1. **Always specify `workFolder`**: Set to project root (`/Users/steipete/Projects/conduit-mcp`)
2. **Refer to these guidelines**: Before proposing changes or writing new code
3. **Follow security patterns**: Use `validateAndResolvePath` for all file operations
4. **Maintain test coverage**: Write both unit and E2E tests for new features
5. **Check lint/typecheck**: Run `npm run lint` and build before committing

### Development Commands Quick Reference

```bash
# Development
npm run dev              # Watch mode development
npm run build            # Compile TypeScript
npm run start            # Start compiled server

# Testing
npm test                 # Unit tests
npm run test:e2e         # E2E tests
npm run coverage         # Coverage report

# Code Quality
npm run lint             # ESLint check
npm run format           # Prettier format
```

## Security Checklist

Before adding new file operations:

- [ ] Uses `validateAndResolvePath` with appropriate options
- [ ] Handles all error cases with proper `ConduitError` types
- [ ] Respects configuration limits (file size, timeout, etc.)
- [ ] Returns consistent JSON response structure
- [ ] Includes comprehensive test coverage
- [ ] Documents security implications

---

_This document should be updated as the project evolves to reflect new patterns, conventions, and lessons learned._
