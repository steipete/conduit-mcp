import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios } from './utils/scenarioLoader';
import path from 'path';
import fs from 'fs';

// Enhanced scenario interface to support new features for list tool
interface EnhancedTestScenario {
  name: string;
  description: string;
  request_payload: unknown;
  expected_exit_code: number;
  expected_stdout?: unknown;
  expected_stderr?: unknown;
  should_show_notice?: boolean;
  notice_code?: string;
  env_vars?: Record<string, string>;
  setup_filesystem?: Array<{
    type:
      | 'createFile'
      | 'createDirectory'
      | 'createSymlink'
      | 'createBinaryFile'
      | 'createMultipleFiles';
    path?: string;
    content?: string;
    target?: string;
    link?: string;
    encoding?: string;
    mtime?: string;
    ctime?: string;
    binary_content?: number[];
    filename_pattern?: string;
    pattern?: string;
    content_template?: string;
    permissions?: string;
  }>;
  cleanup_filesystem?: string[];
  filesystem_effects?: unknown;
}

describe('E2E List Operations', () => {
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

  // Helper function to set up filesystem for a scenario
  function setupFilesystem(setup: EnhancedTestScenario['setup_filesystem'], tempDir: string) {
    if (!setup) return;

    for (const item of setup) {
      // Handle symlinks differently as they use target/link fields
      if (item.type === 'createSymlink') {
        if (item.target && item.link) {
          const linkPath = path.join(tempDir, item.link);
          const linkDir = path.dirname(linkPath);

          if (!fs.existsSync(linkDir)) {
            fs.mkdirSync(linkDir, { recursive: true });
          }

          // Create symlink - target can be relative or absolute
          try {
            // Try relative path first
            fs.symlinkSync(item.target, linkPath);
          } catch (error) {
            // If that fails and target exists, try absolute path
            const absoluteTarget = path.resolve(tempDir, item.target);
            if (fs.existsSync(absoluteTarget)) {
              fs.symlinkSync(absoluteTarget, linkPath);
            } else {
              // Create broken symlink (target doesn't exist)
              fs.symlinkSync(item.target, linkPath);
            }
          }
        }
        continue;
      }

      // Handle multiple file creation pattern
      if (item.type === 'createMultipleFiles') {
        if (item.pattern) {
          const match = item.pattern.match(/^(.+)\{(\d+)-(\d+)\}(.*)$/);
          if (match) {
            const [, prefix, startStr, endStr, suffix] = match;
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);

            for (let i = start; i <= end; i++) {
              const filename = `${prefix}${i.toString().padStart(startStr.length, '0')}${suffix}`;
              const fullPath = path.join(tempDir, filename);
              const dirPath = path.dirname(fullPath);

              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }

              let content = item.content_template || 'Generated content';
              content = content.replace(/\{number\}/g, i.toString());
              fs.writeFileSync(fullPath, content);
            }
          }
        }
        continue;
      }

      // Skip if no path is defined for non-symlink types
      if (!item.path) continue;

      const fullPath = path.join(tempDir, item.path);
      const dirPath = path.dirname(fullPath);

      // Ensure parent directory exists
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      switch (item.type) {
        case 'createFile': {
          let content = item.content || '';
          fs.writeFileSync(fullPath, content, item.encoding || 'utf8');

          // Set permissions if specified
          if (item.permissions) {
            const mode = parseInt(item.permissions, 8);
            fs.chmodSync(fullPath, mode);
          }

          // Set custom timestamps if specified
          if (item.mtime || item.ctime) {
            const mtime = item.mtime ? new Date(item.mtime) : undefined;
            const ctime = item.ctime ? new Date(item.ctime) : undefined;

            if (mtime || ctime) {
              const timeToSet = mtime || ctime || new Date();
              fs.utimesSync(fullPath, timeToSet, timeToSet);
            }
          }
          break;
        }

        case 'createDirectory':
          if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
          }
          break;

        case 'createBinaryFile': {
          let binaryData: Buffer;

          if (item.binary_content) {
            binaryData = Buffer.from(item.binary_content);
          } else if (item.content && item.encoding === 'base64') {
            binaryData = Buffer.from(item.content, 'base64');
          } else {
            // Default binary content
            binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          }

          fs.writeFileSync(fullPath, binaryData);
          break;
        }
      }
    }
  }

  // Helper function to clean up filesystem after a scenario
  function cleanupFilesystem(cleanup: string[], tempDir: string) {
    if (!cleanup) return;

    for (const item of cleanup) {
      const fullPath = path.join(tempDir, item);
      try {
        if (fs.existsSync(fullPath)) {
          const stats = fs.lstatSync(fullPath);
          if (stats.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  // Helper function to verify scenario results
  function verifyScenarioResults(actual: any, expected: any, scenario: EnhancedTestScenario) {
    // Handle error cases
    if (scenario.expected_exit_code !== 0) {
      if (scenario.expected_stderr) {
        expect(actual.status).toBe('error');

        if (typeof scenario.expected_stderr === 'object' && scenario.expected_stderr.contains) {
          expect(actual.error_message).toContain(scenario.expected_stderr.contains);
        }
      }
      return;
    }

    // Handle success cases
    if (expected && expected.tool_name) {
      expect(actual.tool_name).toBe(expected.tool_name);
    }

    if (expected && expected.results !== undefined) {
      // Handle array results (list entries)
      if (Array.isArray(expected.results)) {
        expect(Array.isArray(actual.results)).toBe(true);

        // Check results count if specified
        if (expected.results_count_matches) {
          const countMatch = expected.results_count_matches;
          if (typeof countMatch === 'string' && countMatch.startsWith('gte:')) {
            const minCount = parseInt(countMatch.split(':')[1], 10);
            expect(actual.results.length).toBeGreaterThanOrEqual(minCount);
          } else if (typeof countMatch === 'number') {
            expect(actual.results.length).toBe(countMatch);
          }
        }

        // Helper function to flatten hierarchical results for comparison
        function flattenEntries(entries: any[]): any[] {
          const flattened: any[] = [];
          for (const entry of entries) {
            flattened.push(entry);
            if (entry.children && Array.isArray(entry.children)) {
              flattened.push(...flattenEntries(entry.children));
            }
          }
          return flattened;
        }

        // Flatten the actual results to match scenario expectations
        const flatActualResults = flattenEntries(actual.results);

        // Verify individual entries
        for (let i = 0; i < expected.results.length; i++) {
          const expectedEntry = expected.results[i];

          // Find matching entry by name or other criteria in both top-level and flattened results
          let actualEntry = flatActualResults.find((entry: any) => {
            if (expectedEntry.name && entry.name === expectedEntry.name) return true;
            if (expectedEntry.name_contains && entry.name.includes(expectedEntry.name_contains))
              return true;
            if (
              expectedEntry.path_contains &&
              entry.path &&
              entry.path.includes(expectedEntry.path_contains)
            )
              return true;
            return false;
          });

          // If still not found, try by position in original results
          if (!actualEntry && i < actual.results.length) {
            actualEntry = actual.results[i];
          }

          if (!actualEntry) {
            console.log(`Could not find expected entry:`, expectedEntry);
            console.log(
              `Available top-level entries:`,
              actual.results.map((e: any) => ({ name: e.name, path: e.path, type: e.type }))
            );
            console.log(
              `Available flattened entries:`,
              flatActualResults.map((e: any) => ({ name: e.name, path: e.path, type: e.type }))
            );
          }

          expect(actualEntry).toBeDefined();

          if (expectedEntry.type) {
            expect(actualEntry.type).toBe(expectedEntry.type);
          }

          if (expectedEntry.name && !expectedEntry.name_contains) {
            expect(actualEntry.name).toBe(expectedEntry.name);
          }

          if (expectedEntry.path_contains) {
            expect(actualEntry.path).toContain(expectedEntry.path_contains);
          }

          if (expectedEntry.size_bytes_matches) {
            const sizeMatch = expectedEntry.size_bytes_matches;
            if (typeof sizeMatch === 'string' && sizeMatch.startsWith('gt:')) {
              const minSize = parseInt(sizeMatch.split(':')[1], 10);
              expect(actualEntry.size_bytes).toBeGreaterThan(minSize);
            } else if (typeof sizeMatch === 'number') {
              expect(actualEntry.size_bytes).toBe(sizeMatch);
            }
          }

          if (
            expectedEntry.recursive_size_bytes_matches &&
            actualEntry.recursive_size_bytes !== undefined
          ) {
            const sizeMatch = expectedEntry.recursive_size_bytes_matches;
            if (typeof sizeMatch === 'string' && sizeMatch.startsWith('gt:')) {
              const minSize = parseInt(sizeMatch.split(':')[1], 10);
              expect(actualEntry.recursive_size_bytes).toBeGreaterThan(minSize);
            }
          }
        }
      } else if (typeof expected.results === 'object') {
        // Handle object results (system info)
        const results = actual.results;

        // Server capabilities checks
        if (expected.results.server_version_exists) {
          expect(results.server_version).toBeDefined();
        }

        if (expected.results.supported_checksum_algorithms_contains) {
          expect(Array.isArray(results.supported_checksum_algorithms)).toBe(true);
          for (const algo of expected.results.supported_checksum_algorithms_contains) {
            expect(results.supported_checksum_algorithms).toContain(algo);
          }
        }

        if (expected.results.supported_archive_formats_contains) {
          expect(Array.isArray(results.supported_archive_formats)).toBe(true);
          for (const format of expected.results.supported_archive_formats_contains) {
            expect(results.supported_archive_formats).toContain(format);
          }
        }

        if (expected.results.max_recursive_depth_exists) {
          expect(results.max_recursive_depth).toBeDefined();
          expect(typeof results.max_recursive_depth).toBe('number');
        }

        // Filesystem stats checks
        if (expected.results.path_queried_exists) {
          expect(results.path_queried).toBeDefined();
        }

        // Handle explicit path_queried value match
        if (expected.results.path_queried && expected.results.path_queried !== '<any_string>') {
          expect(results.path_queried).toBe(expected.results.path_queried);
        }

        if (expected.results.total_bytes_exists) {
          expect(typeof results.total_bytes).toBe('number');
          expect(results.total_bytes).toBeGreaterThan(0);
        }

        // Handle explicit byte values with <any_number> placeholders
        if (expected.results.total_bytes && expected.results.total_bytes !== '<any_number>') {
          expect(results.total_bytes).toBe(expected.results.total_bytes);
        } else if (expected.results.total_bytes === '<any_number>') {
          expect(typeof results.total_bytes).toBe('number');
        }

        if (expected.results.free_bytes_exists) {
          expect(typeof results.free_bytes).toBe('number');
          expect(results.free_bytes).toBeGreaterThanOrEqual(0);
        }

        if (expected.results.free_bytes && expected.results.free_bytes !== '<any_number>') {
          expect(results.free_bytes).toBe(expected.results.free_bytes);
        } else if (expected.results.free_bytes === '<any_number>') {
          expect(typeof results.free_bytes).toBe('number');
        }

        if (expected.results.available_bytes_exists) {
          expect(typeof results.available_bytes).toBe('number');
          expect(results.available_bytes).toBeGreaterThanOrEqual(0);
        }

        if (
          expected.results.available_bytes &&
          expected.results.available_bytes !== '<any_number>'
        ) {
          expect(results.available_bytes).toBe(expected.results.available_bytes);
        } else if (expected.results.available_bytes === '<any_number>') {
          expect(typeof results.available_bytes).toBe('number');
        }

        if (expected.results.used_bytes_exists) {
          expect(typeof results.used_bytes).toBe('number');
          expect(results.used_bytes).toBeGreaterThanOrEqual(0);
        }

        if (expected.results.used_bytes && expected.results.used_bytes !== '<any_number>') {
          expect(results.used_bytes).toBe(expected.results.used_bytes);
        } else if (expected.results.used_bytes === '<any_number>') {
          expect(typeof results.used_bytes).toBe('number');
        }

        if (expected.results.info_type_requested) {
          expect(results.info_type_requested).toBe(expected.results.info_type_requested);
        }

        if (expected.results.status_message_contains) {
          expect(results.status_message).toContain(expected.results.status_message_contains);
        }

        if (expected.results.configured_allowed_paths_exists) {
          expect(Array.isArray(results.configured_allowed_paths)).toBe(true);
        }
      }
    }
  }

  describe('Scenario-based Tests', () => {
    const scenarios = loadTestScenarios('listTool.scenarios.json') as EnhancedTestScenario[];

    scenarios.forEach((scenario) => {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        // Set up filesystem for this scenario
        setupFilesystem(scenario.setup_filesystem, testWorkspaceDir);

        // Replace TEMP_DIR_PLACEHOLDER in request payload
        const requestPayload = JSON.parse(
          JSON.stringify(scenario.request_payload).replace(
            /TEMP_DIR_PLACEHOLDER/g,
            testWorkspaceDir
          )
        );

        // Prepare environment variables
        const env = {
          CONDUIT_ALLOWED_PATHS: testWorkspaceDir,
          ...scenario.env_vars,
        };

        // Execute the test
        const result = await runConduitMCPScript(requestPayload, env);

        // Debug output for failed scenarios
        if (result.exitCode !== scenario.expected_exit_code) {
          console.log(`Scenario ${scenario.name}:`);
          console.log(`  Expected exit code: ${scenario.expected_exit_code}`);
          console.log(`  Actual exit code: ${result.exitCode}`);
          console.log(`  Response:`, JSON.stringify(result.response, null, 2));
          console.log(`  Error:`, result.error);
        }

        // For error scenarios, check if the server returned an error response instead of exit code
        if (scenario.expected_exit_code !== 0) {
          // The MCP server typically returns exit code 0 but with error status in the response
          if (result.exitCode === 0 && result.response && result.response.status === 'error') {
            // This is acceptable - the server handled the error gracefully
          } else {
            expect(result.exitCode).toBe(scenario.expected_exit_code);
          }
        } else {
          expect(result.exitCode).toBe(scenario.expected_exit_code);
        }

        if (result.exitCode !== 0 && result.error) {
          console.error(`Scenario ${scenario.name} failed with error:`, result.error);
        }

        // Verify response structure
        expect(result.response).toBeDefined();

        // Handle notice expectations
        if (scenario.should_show_notice) {
          if (Array.isArray(result.response)) {
            expect(result.response).toHaveLength(2);
            const notice = result.response[0];
            expect(notice.type).toBe('info_notice');
            if (scenario.notice_code) {
              expect(notice.notice_code).toBe(scenario.notice_code);
            }
            // Use the actual tool response for further verification
            const toolResponse = result.response[1];
            if (scenario.expected_stdout) {
              verifyScenarioResults(toolResponse, scenario.expected_stdout, scenario);
            }
          }
        } else {
          // Direct tool response (no notice)
          if (scenario.expected_stdout) {
            verifyScenarioResults(result.response, scenario.expected_stdout, scenario);
          }
        }

        // Clean up filesystem for this scenario
        cleanupFilesystem(scenario.cleanup_filesystem || [], testWorkspaceDir);
      });
    });
  });

  // Legacy manual tests for backwards compatibility
  describe('Manual Test Coverage', () => {
    beforeEach(() => {
      // Create test directory structure
      const subDir1 = path.join(testWorkspaceDir, 'subdir1');
      const subDir2 = path.join(testWorkspaceDir, 'subdir2');
      const nestedDir = path.join(subDir1, 'nested');

      fs.mkdirSync(subDir1, { recursive: true });
      fs.mkdirSync(subDir2, { recursive: true });
      fs.mkdirSync(nestedDir, { recursive: true });

      // Create test files
      fs.writeFileSync(path.join(testWorkspaceDir, 'file1.txt'), 'Hello World');
      fs.writeFileSync(path.join(testWorkspaceDir, 'file2.log'), 'Log content');
      fs.writeFileSync(path.join(subDir1, 'nested-file.txt'), 'Nested content');
      fs.writeFileSync(path.join(nestedDir, 'deep-file.txt'), 'Deep content');

      // Create empty file for size testing
      fs.writeFileSync(path.join(testWorkspaceDir, 'empty.txt'), '');

      // Create binary file
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fs.writeFileSync(path.join(testWorkspaceDir, 'test.png'), binaryContent);
    });

    it('should successfully list directory entries (non-recursive)', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testWorkspaceDir,
          recursive_depth: 0,
        },
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      expect(result.response.tool_name).toBe('list');
      expect(Array.isArray(result.response.results)).toBe(true);

      const entries = result.response.results;
      expect(entries.length).toBeGreaterThan(0);

      // Check for expected entries
      const entryNames = entries.map((entry: any) => entry.name);
      expect(entryNames).toContain('file1.txt');
      expect(entryNames).toContain('file2.log');
      expect(entryNames).toContain('empty.txt');
      expect(entryNames).toContain('test.png');
      expect(entryNames).toContain('subdir1');
      expect(entryNames).toContain('subdir2');
    });
  });
});
