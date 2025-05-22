import { describe, it, expect } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import { TestToolResponse, isNoticeResponse, isToolResponse } from './utils/types';

describe('E2E Test Tool Operations', () => {
  const scenarios = loadTestScenarios('testTool.scenarios.json');

  describe('First Use Informational Notice', () => {
    it('should show info notice on first request with default paths', async () => {
      const requestPayload = {
        tool_name: 'test',
        params: {
          operation: 'echo',
          params_to_echo: 'Hello, World!',
        },
      };

      const result = await runConduitMCPScript(requestPayload, {});

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      expect(isNoticeResponse(result.response)).toBe(true);

      if (isNoticeResponse(result.response)) {
        const [infoNotice, actualToolResponse] = result.response;
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe('DEFAULT_PATHS_USED');
        expect(infoNotice.message).toContain('CONDUIT_ALLOWED_PATHS was not explicitly set');

        // Second element should be the actual tool response object
        expect(actualToolResponse.tool_name).toBe('test');
        const testResponse = actualToolResponse as TestToolResponse;
        expect(testResponse.results).toBeDefined();
        expect(testResponse.results?.[0]?.status).toBe('success');
        const firstResult = testResponse.results?.[0] as { status: string; echoed_params?: string };
        expect(firstResult?.echoed_params).toBe('Hello, World!');
      }
    });

    it('should not show info notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const requestPayload = {
        tool_name: 'test',
        params: {
          operation: 'echo',
          params_to_echo: 'No notice test',
        },
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: '/tmp',
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();

      // Should be the direct tool response object (no notice)
      expect(isToolResponse(result.response)).toBe(true);
      const response = result.response as TestToolResponse;
      expect(response.tool_name).toBe('test');
      expect(response.results).toBeDefined();
      expect(response.results?.[0]?.status).toBe('success');
      const firstResult = response.results?.[0] as { status: string; echoed_params?: string };
      expect(firstResult?.echoed_params).toBe('No notice test');
    });
  });

  scenarios.forEach((scenario: TestScenario) => {
    describe('Dynamic Test Tool Scenarios', () => {
      it(`${scenario.description || scenario.name}`, async () => {
        const result = await runConduitMCPScript(scenario.request_payload, scenario.env_vars || {});

        expect(result.exitCode).toBe(scenario.expected_exit_code);
        expect(result.response).toBeDefined();

        if (scenario.should_show_notice) {
          expect(isNoticeResponse(result.response)).toBe(true);
          if (isNoticeResponse(result.response)) {
            const [infoNotice, actualToolResponse] = result.response;
            expect(infoNotice.type).toBe('info_notice');
            if (scenario.notice_code) {
              expect(infoNotice.notice_code).toBe(scenario.notice_code);
            }
            expect(actualToolResponse).toEqual(scenario.expected_stdout);
          }
        } else {
          expect(result.response).toEqual(scenario.expected_stdout);
        }
      });
    });
  });
});
