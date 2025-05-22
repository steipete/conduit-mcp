import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import path from 'path';
import fs from 'fs';

describe('E2E Read Operations', () => {
  let testWorkspaceDir: string;

  beforeEach(() => {
    testWorkspaceDir = createTempDir();
  });

  afterEach(() => {
    // Only cleanup our specific test workspace, not all temp
    if (testWorkspaceDir) {
      if (fs.existsSync(testWorkspaceDir)) {
        fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
      }
    }
  });

  describe('First Use Informational Notice', () => {
    it('should show info notice on first request with default paths', async () => {
      const requestPayload = {
        tool_name: 'read',
        params: {
          operation: 'content',
          sources: ['/nonexistent/file.txt'],
          format: 'text',
        },
      };

      const result = await runConduitMCPScript(requestPayload, {});

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      expect(Array.isArray(result.response)).toBe(true);

      // Should have 2 elements: info notice + actual tool response
      expect(result.response).toHaveLength(2);

      // First element should be the info notice
      const infoNotice = (result.response as any[])[0];
      expect(infoNotice.type).toBe('info_notice');
      expect(infoNotice.notice_code).toBe('DEFAULT_PATHS_USED');
      expect(infoNotice.message).toContain('CONDUIT_ALLOWED_PATHS was not explicitly set');

      // Second element should be the actual tool response object
      const actualToolResponse = (result.response as any[])[1];
      expect(actualToolResponse.tool_name).toBe('read');
      expect(Array.isArray(actualToolResponse.results)).toBe(true);
      expect(actualToolResponse.results).toHaveLength(1);

      // The tool response item should be an error for nonexistent file
      const toolResponseItem = actualToolResponse.results[0];
      expect(toolResponseItem.status).toBe('error');
      expect(toolResponseItem.error_message).toContain('Path not found');
    });

    it('should not show info notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const requestPayload = {
        tool_name: 'read',
        params: {
          operation: 'content',
          sources: ['/nonexistent/file.txt'],
          format: 'text',
        },
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir,
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();

      // Should be the direct tool response object (no notice)
      expect((result.response as any).tool_name).toBe('read');
      expect(Array.isArray((result.response as any).results)).toBe(true);
      expect((result.response as any).results).toHaveLength(1);

      const toolResponseItem = (result.response as any).results[0];
      expect(toolResponseItem.status).toBe('error');
      expect(toolResponseItem.error_message).toContain('Path not found');
    });
  });

  // Load scenarios and create dynamic tests
  const scenarios = loadTestScenarios('readTool.scenarios.json');

  scenarios.forEach((scenario: TestScenario) => {
    describe(`${scenario.name}`, () => {
      beforeEach(async () => {
        // Setup files if specified
        if (scenario.setup_files) {
          for (const file of scenario.setup_files) {
            const targetDir = file.base_dir || testWorkspaceDir;
            const filePath = path.join(targetDir, file.path);

            // Ensure parent directories exist
            const parentDir = path.dirname(filePath);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }

            fs.writeFileSync(filePath, file.content || '', { encoding: file.encoding || 'utf8' });
          }
        }
      });

      afterEach(() => {
        // Cleanup for this scenario
      });

      it(`${scenario.description}`, async () => {
        // Process placeholder substitution
        const processedRequestPayload = substituteTemplateValues(
          JSON.parse(JSON.stringify(scenario.request_payload)),
          testWorkspaceDir
        );

        const processedExpectedStdout = substituteTemplateValues(
          JSON.parse(JSON.stringify(scenario.expected_stdout)),
          testWorkspaceDir
        );

        const processedEnvVars = substituteTemplateValues(
          JSON.parse(JSON.stringify(scenario.env_vars || {})),
          testWorkspaceDir
        );

        // Run the test
        const result = await runConduitMCPScript(processedRequestPayload as object, processedEnvVars as Record<string, string>);

        // Assertions
        expect(result.exitCode).toBe(scenario.expected_exit_code);
        expect(result.response).toBeDefined();

        if (scenario.should_show_notice) {
          expect(Array.isArray(result.response)).toBe(true);
          expect(result.response).toHaveLength(2);

          // First element should be the info notice
          const infoNotice = (result.response as any[])[0];
          expect(infoNotice.type).toBe('info_notice');
          if (scenario.notice_code) {
            expect(infoNotice.notice_code).toBe(scenario.notice_code);
          }

          // Second element should be the actual tool response
          const actualToolResponse = (result.response as any[])[1];
          expect(actualToolResponse).toEqual(processedExpectedStdout);
        } else {
          expect(result.response).toEqual(processedExpectedStdout);
        }
      });
    });
  });
});

/**
 * Recursively substitute template values in an object
 */
function substituteTemplateValues(obj: unknown, tempDir: string): unknown {
  if (typeof obj === 'string') {
    return obj
      .replace(/\{\{TEMP_DIR\}\}/g, tempDir)
      .replace(/\{\{TEMP_DIR_FORWARD_SLASH\}\}/g, tempDir.replace(/\\/g, '/'));
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteTemplateValues(item, tempDir));
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteTemplateValues(value, tempDir);
    }
    return result;
  }

  return obj;
}
