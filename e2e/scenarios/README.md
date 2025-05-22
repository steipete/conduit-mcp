# E2E Test Scenarios

This directory contains JSON files with predefined test scenarios for the conduit-mcp E2E tests.

## Structure

Each scenario file should contain:

```json
{
  "name": "Scenario Name",
  "description": "Description of what this scenario tests",
  "requestPayload": {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "tool.name",
      "arguments": {
        // tool arguments
      }
    }
  },
  "envVars": {
    "CONDUIT_ALLOWED_PATHS": "/path/to/allowed"
  },
  "expectedResponse": {
    "success": true,
    "exitCode": 0,
    "responsePattern": "regex pattern to match in response"
  },
  "preConditions": [
    {
      "type": "createFile",
      "path": "relative/path/to/file.txt",
      "content": "file content"
    }
  ],
  "postConditions": [
    {
      "type": "checkFileExists",
      "path": "relative/path/to/file.txt"
    }
  ]
}
```

## Usage

These scenario files can be loaded and used by E2E tests to avoid hardcoding test data in the test files themselves.

Example usage:

```typescript
import scenarioData from './scenarios/read-text-file.json';

it('should read text file', async () => {
  const result = await runConduitMCPScript(scenarioData.requestPayload, scenarioData.envVars);
  // assertions...
});
```
