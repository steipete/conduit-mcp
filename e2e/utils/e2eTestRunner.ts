import { spawn, ChildProcess } from 'child_process';
import path from 'path';

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
            // The server should output a single JSON line
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            parsedResponse = JSON.parse(lastLine);
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

      // Send the request payload to stdin
      const requestJson = JSON.stringify(requestPayload) + '\n';
      serverProcess.stdin?.write(requestJson);
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

export function createMCPRequest(method: string, params: unknown): object {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  };
}
