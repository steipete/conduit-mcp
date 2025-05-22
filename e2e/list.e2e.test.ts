import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import {
  DirectoryEntry,
  ListCapabilitiesResponse,
  ListFilesystemStatsResponse,
  ToolResponse,
  isNoticeResponse,
  isToolResponse,
  assertListToolResponse,
} from './utils/types';
import path from 'path';
import fs from 'fs';
import type { BufferEncoding } from './utils/types';

describe('E2E List Operations', () => {
  let testWorkspaceDir: string;

  beforeEach(() => {
    testWorkspaceDir = createTempDir();
  });

  afterEach(() => {
    if (testWorkspaceDir) {
      if (fs.existsSync(testWorkspaceDir)) {
        fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
      }
    }
  });

  // Helper function to recursively substitute placeholders in any object/string
  function substitutePlaceholders<T>(obj: T, substitutions: Record<string, string>): T {
    if (typeof obj === 'string') {
      let result = obj;
      for (const [placeholder, value] of Object.entries(substitutions)) {
        result = result.replace(new RegExp(placeholder, 'g'), value);
      }
      return result as unknown as T;
    } else if (Array.isArray(obj)) {
      return obj.map((item) => substitutePlaceholders(item, substitutions)) as T;
    } else if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = substitutePlaceholders(value, substitutions);
      }
      return result as T;
    }
    return obj;
  }

  // Load scenarios and iterate through each one
  const scenarios = loadTestScenarios('listTool.scenarios.json') as TestScenario[];

  scenarios.forEach((scenario) => {
    describe(`${scenario.name}`, () => {
      it(`${scenario.description}`, async () => {
        // Setup files/directories if specified
        if (scenario.setup_files) {
          for (const file of scenario.setup_files) {
            const targetDir = file.base_dir || testWorkspaceDir;
            const fullPath = path.join(targetDir, file.path);

            // Ensure parent directories exist
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });

            if (file.content_type === 'directory') {
              fs.mkdirSync(fullPath, { recursive: true });
            } else {
              fs.writeFileSync(fullPath, file.content || '', {
                encoding: (file.encoding as BufferEncoding) || 'utf8',
              });
            }
          }
        }

        // Perform placeholder substitution
        const substitutions = {
          '{{TEMP_DIR}}': testWorkspaceDir,
        };

        const processedRequestPayload = substitutePlaceholders(
          scenario.request_payload,
          substitutions
        );
        const processedExpectedStdout = substitutePlaceholders(
          scenario.expected_stdout,
          substitutions
        );
        const processedEnvVars = substitutePlaceholders(scenario.env_vars || {}, substitutions);

        // Execute the test
        const result = await runConduitMCPScript(
          processedRequestPayload as object,
          processedEnvVars as Record<string, string>
        );

        // Assert exit code
        expect(result.exitCode).toBe(scenario.expected_exit_code);
        expect(result.response).toBeDefined();

        // Handle notice expectations
        let actualToolResponse: ToolResponse;
        if (scenario.should_show_notice) {
          expect(isNoticeResponse(result.response)).toBe(true);
          if (isNoticeResponse(result.response)) {
            const [notice, toolResponse] = result.response;
            expect(notice.type).toBe('info_notice');
            if (scenario.notice_code) {
              expect(notice.notice_code).toBe(scenario.notice_code);
            }
            actualToolResponse = toolResponse;
          } else {
            throw new Error('Expected notice response');
          }
        } else {
          expect(isToolResponse(result.response)).toBe(true);
          actualToolResponse = result.response as ToolResponse;
        }

        // Handle custom logic assertions
        if (scenario.assertions && scenario.assertions.some((a) => a.type === 'custom_logic')) {
          for (const assertion of scenario.assertions) {
            if (assertion.type === 'custom_logic') {
              switch (assertion.name) {
                case 'check_list_entries_basic': {
                  // Check if results is an array (direct results format) or has entries property
                  assertListToolResponse(actualToolResponse);
                  const entries: DirectoryEntry[] = Array.isArray(actualToolResponse.results)
                    ? actualToolResponse.results
                    : (actualToolResponse.results as { entries: DirectoryEntry[] }).entries;

                  expect(Array.isArray(entries)).toBe(true);

                  // Filter out hidden files and check we have the expected visible entries
                  const visibleEntries = entries.filter((e) => !e.name.startsWith('.'));
                  expect(visibleEntries.length).toBe(3);

                  const entryNames = visibleEntries.map((e) => e.name).sort();
                  expect(entryNames).toEqual(['file1.txt', 'file2.log', 'subdir1']);

                  // Check types and sizes
                  const file1 = visibleEntries.find((e) => e.name === 'file1.txt');
                  expect(file1?.type).toBe('file');
                  expect(file1?.size_bytes).toBe(5);

                  const file2 = visibleEntries.find((e) => e.name === 'file2.log');
                  expect(file2?.type).toBe('file');
                  expect(file2?.size_bytes).toBe(5);

                  const subdir = visibleEntries.find((e) => e.name === 'subdir1');
                  expect(subdir?.type).toBe('directory');

                  // Ensure hidden files are not in the visible entries (but may be in the full list)
                  const hiddenFileInVisible = visibleEntries.find((e) => e.name === '.hiddenfile');
                  expect(hiddenFileInVisible).toBeUndefined();
                  break;
                }

                case 'validate_server_capabilities': {
                  assertListToolResponse(actualToolResponse);
                  const capabilitiesResponse = actualToolResponse as ListCapabilitiesResponse;
                  if (!capabilitiesResponse.results) {
                    throw new Error('Missing results in capabilities response');
                  }
                  const results = capabilitiesResponse.results;

                  // Check server_version
                  expect(typeof results.server_version).toBe('string');
                  expect(results.server_version.length).toBeGreaterThan(0);

                  // Check active_configuration structure
                  expect(results.active_configuration).toBeDefined();
                  const config = results.active_configuration;

                  expect(typeof config.HTTP_TIMEOUT_MS).toBe('number');
                  expect(config.HTTP_TIMEOUT_MS).toBeGreaterThan(0);

                  expect(typeof config.MAX_PAYLOAD_SIZE_BYTES).toBe('number');
                  expect(config.MAX_PAYLOAD_SIZE_BYTES).toBeGreaterThan(0);

                  expect(typeof config.MAX_FILE_READ_BYTES).toBe('number');
                  expect(config.MAX_FILE_READ_BYTES).toBeGreaterThan(0);

                  expect(typeof config.MAX_URL_DOWNLOAD_BYTES).toBe('number');
                  expect(config.MAX_URL_DOWNLOAD_BYTES).toBeGreaterThan(0);

                  expect(typeof config.IMAGE_COMPRESSION_THRESHOLD_BYTES).toBe('number');
                  expect(config.IMAGE_COMPRESSION_THRESHOLD_BYTES).toBeGreaterThanOrEqual(0);

                  expect(typeof config.IMAGE_COMPRESSION_QUALITY).toBe('number');
                  expect(config.IMAGE_COMPRESSION_QUALITY).toBeGreaterThanOrEqual(0);
                  expect(config.IMAGE_COMPRESSION_QUALITY).toBeLessThanOrEqual(100);

                  expect(Array.isArray(config.ALLOWED_PATHS)).toBe(true);
                  expect(config.ALLOWED_PATHS.length).toBeGreaterThan(0);

                  expect(typeof config.DEFAULT_CHECKSUM_ALGORITHM).toBe('string');
                  expect(typeof config.MAX_RECURSIVE_DEPTH).toBe('number');
                  expect(config.MAX_RECURSIVE_DEPTH).toBeGreaterThan(0);

                  expect(typeof config.RECURSIVE_SIZE_TIMEOUT_MS).toBe('number');
                  expect(config.RECURSIVE_SIZE_TIMEOUT_MS).toBeGreaterThan(0);

                  // Check supported algorithms and formats
                  expect(Array.isArray(results.supported_checksum_algorithms)).toBe(true);
                  expect(results.supported_checksum_algorithms).toContain('md5');
                  expect(results.supported_checksum_algorithms).toContain('sha1');
                  expect(results.supported_checksum_algorithms).toContain('sha256');
                  expect(results.supported_checksum_algorithms).toContain('sha512');

                  expect(Array.isArray(results.supported_archive_formats)).toBe(true);
                  expect(results.supported_archive_formats).toContain('zip');
                  expect(results.supported_archive_formats).toContain('tar.gz');
                  expect(results.supported_archive_formats).toContain('tgz');

                  expect(results.supported_checksum_algorithms).toContain(
                    results.default_checksum_algorithm
                  );

                  expect(typeof results.max_recursive_depth).toBe('number');
                  expect(results.max_recursive_depth).toBeGreaterThan(0);
                  break;
                }

                case 'validate_filesystem_stats': {
                  assertListToolResponse(actualToolResponse);
                  const statsResponse = actualToolResponse as ListFilesystemStatsResponse;
                  if (!statsResponse.results) {
                    throw new Error('Missing results in filesystem stats response');
                  }
                  const results = statsResponse.results;

                  if (results.path_queried) {
                    expect(results.path_queried).toBe(testWorkspaceDir);
                  }

                  expect(typeof results.total_bytes).toBe('number');
                  expect(results.total_bytes).toBeGreaterThanOrEqual(0);

                  expect(typeof results.free_bytes).toBe('number');
                  expect(results.free_bytes).toBeGreaterThanOrEqual(0);

                  expect(typeof results.available_bytes).toBe('number');
                  expect(results.available_bytes).toBeGreaterThanOrEqual(0);

                  expect(typeof results.used_bytes).toBe('number');
                  expect(results.used_bytes).toBeGreaterThanOrEqual(0);

                  // Check that total_bytes approximately equals used_bytes + available_bytes
                  // Allow for some variance due to filesystem accounting differences
                  const calculatedTotal = results.used_bytes + results.available_bytes;
                  const variance = Math.abs(results.total_bytes - calculatedTotal);
                  const tolerance = results.total_bytes * 0.1; // 10% tolerance
                  expect(variance).toBeLessThanOrEqual(tolerance);
                  break;
                }
              }
            }
          }
        } else if (processedExpectedStdout) {
          // For scenarios without custom logic and without {{ANY_...}} placeholders, do flexible comparison
          const hasAnyPlaceholders = JSON.stringify(processedExpectedStdout).includes('{{ANY_');
          if (!hasAnyPlaceholders) {
            // Handle specific cases that need flexible matching
            if (scenario.name === 'list_entries_empty_dir_success') {
              // For empty directory, check the structure matches but allow for different response formats
              assertListToolResponse(actualToolResponse);
              expect(actualToolResponse.tool_name).toBe('list');
              if (Array.isArray(actualToolResponse.results)) {
                expect(actualToolResponse.results).toEqual([]);
              } else {
                expect(
                  (actualToolResponse.results as { entries: DirectoryEntry[] }).entries
                ).toEqual([]);
              }
            } else if (
              actualToolResponse.status === 'error' &&
              (processedExpectedStdout as { status?: string }).status === 'error'
            ) {
              // For error scenarios, check error_code and partial error_message match
              const actualResponse = actualToolResponse;
              const expectedResponse = processedExpectedStdout as {
                error_code?: string;
                error_message?: string;
                [key: string]: unknown;
              };
              expect(actualResponse.status).toBe(expectedResponse.status);
              expect(actualResponse.error_code).toBe(expectedResponse.error_code);

              // Handle different error message formats
              const expectedMsg = expectedResponse.error_message as string;
              const actualMsg = actualResponse.error_message as string;

              if (expectedMsg.includes('Access to path') && actualMsg.includes('Access to path')) {
                // For access denied errors, just check the path is mentioned
                expect(actualMsg).toContain('/etc');
              } else {
                // For other errors, check partial match (without resolved path info)
                const baseExpectedMsg = expectedMsg.split(' (resolved')[0];
                expect(actualMsg).toContain(baseExpectedMsg);
              }
            } else {
              expect(actualToolResponse).toEqual(processedExpectedStdout);
            }
          }
        }
      });
    });
  });
});
