import { describe, it, expect } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';

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
      expect(Array.isArray(result.response)).toBe(true);

      // Should have 2 elements: info notice + actual tool response
      expect(result.response).toHaveLength(2);

      // First element should be the info notice
      const infoNotice = result.response[0];
      expect(infoNotice.type).toBe('info_notice');
      expect(infoNotice.notice_code).toBe('DEFAULT_PATHS_USED');
      expect(infoNotice.message).toContain('CONDUIT_ALLOWED_PATHS was not explicitly set');

      // Second element should be the actual tool response object
      const actualToolResponse = result.response[1];
      expect(actualToolResponse.tool_name).toBe('test');
      expect(actualToolResponse.results).toBeDefined();
      expect(actualToolResponse.results.status).toBe('success');
      expect(actualToolResponse.results.echoed_params).toBe('Hello, World!');
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
      expect(result.response.tool_name).toBe('test');
      expect(result.response.results).toBeDefined();
      expect(result.response.results.status).toBe('success');
      expect(result.response.results.echoed_params).toBe('No notice test');
    });
  });

  describe('Echo Operations', () => {
    it('should echo simple string parameter', async () => {
      const scenario = scenarios.find((s) => s.name === 'echo_simple_string');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });

    it('should echo complex object parameter', async () => {
      const scenario = scenarios.find((s) => s.name === 'echo_complex_object');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });

    it('should echo null value', async () => {
      const scenario = scenarios.find((s) => s.name === 'echo_null_value');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });

    it('should echo empty array', async () => {
      const scenario = scenarios.find((s) => s.name === 'echo_empty_array');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });

    it('should echo without notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const scenario = scenarios.find((s) => s.name === 'echo_no_notice_with_allowed_paths');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();
      expect(result.response).toEqual(scenario!.expected_stdout);
    });
  });

  describe('Error Generation Operations', () => {
    it('should generate error with known error code', async () => {
      const scenario = scenarios.find((s) => s.name === 'generate_error_known_code');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });

    it('should generate error with unknown error code', async () => {
      const scenario = scenarios.find((s) => s.name === 'generate_error_unknown_code');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported operation', async () => {
      const scenario = scenarios.find((s) => s.name === 'unsupported_operation');
      expect(scenario).toBeDefined();

      const result = await runConduitMCPScript(scenario!.request_payload, scenario!.env_vars || {});

      expect(result.exitCode).toBe(scenario!.expected_exit_code);
      expect(result.response).toBeDefined();

      if (scenario!.should_show_notice) {
        expect(Array.isArray(result.response)).toBe(true);
        expect(result.response).toHaveLength(2);

        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe(scenario!.notice_code);

        const actualToolResponse = result.response[1];
        expect(actualToolResponse).toEqual(scenario!.expected_stdout);
      } else {
        expect(result.response).toEqual(scenario!.expected_stdout);
      }
    });
  });

  describe('Dynamic Scenario Tests', () => {
    // Generate test cases dynamically from scenarios file
    scenarios.forEach((scenario: TestScenario) => {
      it(`[Scenario: ${scenario.name}] ${scenario.description}`, async () => {
        const result = await runConduitMCPScript(scenario.request_payload, scenario.env_vars || {});

        if (result.exitCode !== scenario.expected_exit_code) {
          console.error(`Test failed for scenario: ${scenario.name}`);
          console.error('Result:', result);
          console.error('Expected exit code:', scenario.expected_exit_code);
          console.error('Actual exit code:', result.exitCode);
        }

        expect(result.exitCode).toBe(scenario.expected_exit_code);
        expect(result.response).toBeDefined();

        if (scenario.should_show_notice) {
          expect(Array.isArray(result.response)).toBe(true);
          expect(result.response).toHaveLength(2);

          const infoNotice = result.response[0];
          expect(infoNotice.type).toBe('info_notice');
          if (scenario.notice_code) {
            expect(infoNotice.notice_code).toBe(scenario.notice_code);
          }

          const actualToolResponse = result.response[1];
          expect(actualToolResponse).toEqual(scenario.expected_stdout);
        } else {
          expect(result.response).toEqual(scenario.expected_stdout);
        }
      });
    });
  });
});
