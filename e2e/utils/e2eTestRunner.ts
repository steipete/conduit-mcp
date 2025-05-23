import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import {
  MCPResponse,
  isMCPResponse,
  extractToolResponseFromMCP,
  extractNoticeFromMCP,
  ToolResponse,
  InfoNotice,
  isMCPToolCallResult,
  extractMCPResponseData,
} from './types';

export interface E2ETestResult {
  response: unknown;
  error: string;
  exitCode: number | null;
}

export interface E2ETestOptions {
  timeout?: number;
  workingDir?: string;
}

const DEFAULT_TIMEOUT = 10000; // 10 seconds

export async function runConduitMCPScript(
  requestPayload: object,
  envVars: Record<string, string> = {},
  options: E2ETestOptions = {}
): Promise<E2ETestResult> {
  const { timeout = DEFAULT_TIMEOUT, workingDir } = options;

  const projectRoot = path.resolve(__dirname, '../..');
  const startScript = path.join(projectRoot, 'start.sh');

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let serverProcess: ChildProcess;
    let timeoutId: NodeJS.Timeout;
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
        // Force kill after 2 seconds if graceful shutdown fails
        setTimeout(() => {
          if (!serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
        }, 2000);
      }
    };

    const finishTest = (result: E2ETestResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Set timeout
    timeoutId = setTimeout(() => {
      finishTest({
        response: null,
        error: 'Test timeout exceeded',
        exitCode: null,
      });
    }, timeout);

    try {
      // Prepare environment variables
      const env = {
        ...process.env,
        ...envVars,
      };

      // Change to working directory if specified
      const spawnOptions = {
        env,
        cwd: workingDir || projectRoot,
      };

      // Spawn the server process
      serverProcess = spawn('bash', [startScript], spawnOptions);

      // Handle process errors
      serverProcess.on('error', (error) => {
        finishTest({
          response: null,
          error: `Failed to start server: ${error.message}`,
          exitCode: null,
        });
      });

      // Collect stdout
      serverProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      serverProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process exit
      serverProcess.on('close', (code) => {
        let parsedResponse = null;
        let errorMessage = stderr;

        // Try to parse the stdout as JSON
        if (stdout.trim()) {
          try {
            // Parse JSON-RPC responses
            const lines = stdout
              .trim()
              .split('\n')
              .filter((line) => line.trim());

            // Filter only JSON lines (ignore log messages)
            const jsonLines = lines.filter((line) => {
              try {
                JSON.parse(line);
                return true;
              } catch {
                return false;
              }
            });

            const responses = jsonLines.map((line) => JSON.parse(line));

            // Find the tool call response (skip initialize response)
            const toolCallResponse = responses.find(
              (resp) => isMCPResponse(resp) && resp.id !== 'initialize' && resp.result !== undefined
            );

            if (toolCallResponse && isMCPResponse(toolCallResponse)) {
              try {
                const result = extractMCPResponseData(toolCallResponse);

                if (isMCPToolCallResult(result)) {
                  // Parse the JSON text content
                  const textContent = result.content
                    .filter((item) => item.type === 'text')
                    .map((item) => item.text)
                    .join('\n');

                  const parsedContent = JSON.parse(textContent);

                  // Check if this is a notice response (array with notice + tool response)
                  if (Array.isArray(parsedContent) && parsedContent.length === 2) {
                    const [notice, toolResponse] = parsedContent;
                    if (notice?.type === 'info_notice' && toolResponse?.tool_name) {
                      // Return as notice response format expected by tests
                      parsedResponse = [notice, toolResponse];
                    } else {
                      // If it's not the expected format, return the array as-is
                      parsedResponse = parsedContent;
                    }
                  } else if (parsedContent?.tool_name) {
                    // Direct tool response
                    parsedResponse = parsedContent;
                  } else {
                    // Fallback
                    parsedResponse = parsedContent;
                  }
                } else {
                  // Not a tool call result, return the raw result
                  parsedResponse = result;
                }
              } catch (parseError) {
                errorMessage = `Failed to parse MCP tool response: ${parseError}. Raw result: ${JSON.stringify(extractMCPResponseData(toolCallResponse))}`;
              }
            } else {
              // Fallback to original behavior for non-MCP responses
              if (responses.length === 1) {
                parsedResponse = responses[0];
              } else {
                parsedResponse = responses;
              }
            }
          } catch (parseError) {
            errorMessage = `Failed to parse server response: ${parseError}. Raw stdout: ${stdout}`;
          }
        }

        finishTest({
          response: parsedResponse,
          error: errorMessage,
          exitCode: code,
        });
      });

      // Convert old format request to MCP format if needed
      const mcpRequest = convertToMCPRequest(requestPayload);

      // For MCP protocol, we need to send multiple requests:
      // 1. Initialize
      // 2. Tools/call (for our actual test)
      const requests = [
        createMCPRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
        mcpRequest,
      ];

      // Send all requests
      for (const request of requests) {
        const requestJson = JSON.stringify(request) + '\n';
        serverProcess.stdin?.write(requestJson);
      }
      serverProcess.stdin?.end();
    } catch (error) {
      finishTest({
        response: null,
        error: `Error running test: ${error}`,
        exitCode: null,
      });
    }
  });
}

function convertToMCPRequest(oldRequest: any): object {
  // Check if it's already an MCP request
  if (oldRequest.jsonrpc && oldRequest.method) {
    return oldRequest;
  }

  // Convert old format to MCP format
  if (oldRequest.tool_name && oldRequest.params) {
    return createMCPRequest('tools/call', {
      name: oldRequest.tool_name,
      arguments: oldRequest.params,
    });
  }

  // Fallback - assume it's already properly formatted
  return oldRequest;
}

export function createMCPRequest(method: string, params: unknown): object {
  const id = method === 'initialize' ? 'initialize' : Math.floor(Math.random() * 1000000);
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

// Helper function to run MCP tool call directly
export async function runMCPToolCall(
  toolName: string,
  toolArgs: unknown,
  envVars: Record<string, string> = {},
  options: E2ETestOptions = {}
): Promise<E2ETestResult> {
  const mcpRequest = createMCPRequest('tools/call', {
    name: toolName,
    arguments: toolArgs,
  });

  return runConduitMCPScript(mcpRequest, envVars, options);
}
