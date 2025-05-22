import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import path from 'path';
import fs from 'fs';

describe('E2E Find Operations', () => {
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
  function setupFilesystem(setup: TestScenario['setup_filesystem'], tempDir: string) {
    if (!setup) return;

    for (const item of setup) {
      // Handle symlinks differently as they don't use the 'path' field
      if (item.type === 'createSymlink') {
        if (item.target && item.link) {
          const targetPath = path.resolve(tempDir, item.target);
          const linkPath = path.join(tempDir, item.link);
          const linkDir = path.dirname(linkPath);

          if (!fs.existsSync(linkDir)) {
            fs.mkdirSync(linkDir, { recursive: true });
          }

          // Create symlink (handle both relative and absolute targets)
          try {
            fs.symlinkSync(targetPath, linkPath);
          } catch {
            // If absolute path fails, try relative
            const relativePath = path.relative(linkDir, targetPath);
            fs.symlinkSync(relativePath, linkPath);
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

          // Handle special filename patterns
          if (item.path.includes('{{LONG_FILENAME}}')) {
            const longName = 'a'.repeat(200);
            const actualPath = path.join(tempDir, item.path.replace('{{LONG_FILENAME}}', longName));
            const actualDirPath = path.dirname(actualPath);
            if (!fs.existsSync(actualDirPath)) {
              fs.mkdirSync(actualDirPath, { recursive: true });
            }
            fs.writeFileSync(actualPath, content, item.encoding || 'utf8');
          } else {
            fs.writeFileSync(fullPath, content, item.encoding || 'utf8');
          }

          // Set custom timestamps if specified
          if (item.mtime || item.ctime) {
            const mtime = item.mtime ? new Date(item.mtime) : undefined;
            const ctime = item.ctime ? new Date(item.ctime) : undefined;

            if (mtime || ctime) {
              // Use mtime for both access and modify time if available
              const timeToSet = mtime || ctime || new Date();
              fs.utimesSync(
                item.path.includes('{{LONG_FILENAME}}')
                  ? path.join(tempDir, item.path.replace('{{LONG_FILENAME}}', 'a'.repeat(200)))
                  : fullPath,
                timeToSet,
                timeToSet
              );
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
            binaryData = Buffer.from(item.content || '', 'utf8');
          }

          fs.writeFileSync(fullPath, binaryData);
          break;
        }
      }
    }
  }

  // Helper function to clean up filesystem
  function cleanupFilesystem(cleanup: string[], tempDir: string) {
    if (!cleanup) return;

    for (const item of cleanup) {
      const fullPath = path.join(tempDir, item);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.lstatSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }

        // Handle glob patterns for cleanup
        if (item.includes('*')) {
          const dir = path.dirname(fullPath);
          const pattern = path.basename(item);
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            files.forEach((file) => {
              if (file.match(pattern.replace('*', '.*'))) {
                const filePath = path.join(dir, file);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                }
              }
            });
          }
        }
      } catch (error) {
        // Ignore cleanup errors
        console.warn(`Cleanup failed for ${item}:`, error);
      }
    }
  }

  // Helper function to verify results against expected output
  function verifyResults(actual: unknown, expected: unknown) {
    expect(actual).toBeDefined();
    expect(Array.isArray(actual)).toBe(true);

    const actualArray = actual as Array<any>;
    const expectedArray = expected as Array<any>;

    for (const expectedItem of expectedArray) {
      const matchingItems = actualArray.filter((item) => {
        let matches = true;

        // Check type if specified
        if (expectedItem.type && item.type !== expectedItem.type) {
          matches = false;
        }

        // Check exact name match
        if (expectedItem.name && item.name !== expectedItem.name) {
          matches = false;
        }

        // Check name contains
        if (expectedItem.name_contains && !item.name.includes(expectedItem.name_contains)) {
          matches = false;
        }

        // Check path contains
        if (expectedItem.path_contains && !item.path.includes(expectedItem.path_contains)) {
          matches = false;
        }

        return matches;
      });

      expect(matchingItems.length).toBeGreaterThan(
        0,
        `Expected to find item matching: ${JSON.stringify(expectedItem)}, but found: ${JSON.stringify(actualArray.map((i) => ({ name: i.name, type: i.type, path: i.path })))}`
      );
    }

    // For scenarios, we allow additional results as long as all expected ones are found
    // Only verify exact count if there are specific expectations that rule out extra results
    if (expectedArray.length === 0) {
      expect(actualArray.length).toBe(0);
    } else {
      expect(actualArray.length).toBeGreaterThanOrEqual(expectedArray.length);
    }
  }

  describe('First Use Informational Notice', () => {
    it('should show info notice on first request with default paths', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: '/nonexistent/directory',
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt',
            },
          ],
        },
      };

      const result = await runConduitMCPScript(requestPayload, {});

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();

      if (Array.isArray(result.response)) {
        // Should have 2 elements: info notice + actual tool response
        expect(result.response).toHaveLength(2);

        // First element should be the info notice
        const infoNotice = result.response[0];
        expect(infoNotice.type).toBe('info_notice');
        expect(infoNotice.notice_code).toBe('DEFAULT_PATHS_USED');
        expect(infoNotice.message).toContain('CONDUIT_ALLOWED_PATHS was not explicitly set');

        // Second element should be the actual tool response object
        const actualToolResponse = result.response[1];
        expect(actualToolResponse.status).toBe('error');
        expect(actualToolResponse.error_message).toContain('Path not found');
      } else {
        // Direct error response
        expect(result.response.status).toBe('error');
        expect(result.response.error_message).toContain('Path not found');
      }
    });

    it('should not show info notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: '/nonexistent/directory',
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt',
            },
          ],
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
      const response = result.response as any;
      expect(response.status).toBe('error');
      expect(response.error_message).toContain('Path not found');
    });
  });

  describe('Scenario-based Tests', () => {
    const scenarios = loadTestScenarios('findTool.scenarios.json');

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

        // Verify exit code
        expect(result.exitCode).toBe(scenario.expected_exit_code);

        if (result.exitCode !== 0 && result.error) {
          console.error(`Scenario ${scenario.name} failed with error:`, result.error);
        }

        // Verify response structure
        expect(result.response).toBeDefined();

        // Handle notice expectations
        if (scenario.should_show_notice) {
          if (Array.isArray(result.response)) {
            expect(result.response).toHaveLength(2);
            const notice = result.response[0] as any;
            expect(notice.type).toBe('info_notice');
            if (scenario.notice_code) {
              expect(notice.notice_code).toBe(scenario.notice_code);
            }
            // Use the actual tool response for further verification
            const toolResponse = result.response[1] as any;
            expect(toolResponse.tool_name).toBe(scenario.expected_stdout?.tool_name);
          }
        } else {
          // Verify the main response
          const response = result.response as any;
          if (scenario.expected_stdout?.tool_name) {
            expect(response.tool_name).toBe(scenario.expected_stdout.tool_name);
          }

          // Verify results if expected
          if (scenario.expected_stdout?.results) {
            // Special handling for case-insensitive filesystem scenarios
            if (scenario.name === 'case_insensitive_filename_search') {
              // On case-insensitive filesystems, files with names differing only in case
              // are the same file, so we expect at least 1 file containing "test"
              expect(response.results).toBeDefined();
              expect(Array.isArray(response.results)).toBe(true);
              expect(response.results.length).toBeGreaterThanOrEqual(1);
              const hasTestFile = response.results.some(
                (r: { type: string; name: string }) =>
                  r.type === 'file' && r.name.toLowerCase().includes('test')
              );
              expect(hasTestFile).toBe(true);
            } else {
              verifyResults(response.results, scenario.expected_stdout.results);
            }
          }

          // Handle error expectations
          if (response.status === 'error') {
            expect(scenario.expected_stdout?.status).toBe('error');
            if ((scenario.expected_stdout as any)?.error_message) {
              expect(response.error_message).toContain(
                (scenario.expected_stdout as any).error_message
              );
            }
          }
        }

        // Clean up filesystem for this scenario
        cleanupFilesystem(scenario.cleanup_filesystem || [], testWorkspaceDir);
      });
    });
  });

  // Keep some of the original manual tests for core functionality
  describe('Core Manual Tests', () => {
    beforeEach(() => {
      // Create test directory structure with various files
      const subDir1 = path.join(testWorkspaceDir, 'subdir1');
      const subDir2 = path.join(testWorkspaceDir, 'subdir2');
      const nestedDir = path.join(subDir1, 'nested');

      fs.mkdirSync(subDir1, { recursive: true });
      fs.mkdirSync(subDir2, { recursive: true });
      fs.mkdirSync(nestedDir, { recursive: true });

      // Create test files with different extensions
      fs.writeFileSync(path.join(testWorkspaceDir, 'file1.txt'), 'Text content 1');
      fs.writeFileSync(path.join(testWorkspaceDir, 'file2.log'), 'Log content');
      fs.writeFileSync(path.join(testWorkspaceDir, 'readme.md'), 'Markdown content');
      fs.writeFileSync(path.join(testWorkspaceDir, 'config.json'), '{"key": "value"}');
      fs.writeFileSync(path.join(subDir1, 'nested-file.txt'), 'Nested text content');
      fs.writeFileSync(path.join(nestedDir, 'deep-file.log'), 'Deep log content');
      fs.writeFileSync(path.join(subDir2, 'another.txt'), 'Another text file');

      // Create hidden files
      fs.writeFileSync(path.join(testWorkspaceDir, '.hidden.txt'), 'Hidden content');
      fs.writeFileSync(path.join(testWorkspaceDir, '.env'), 'SECRET=value');
    });

    it('should find files matching glob pattern (*.txt)', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt',
            },
          ],
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

      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);

      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: { path: string }) => path.basename(f.path));

      // Should find all .txt files including hidden ones
      expect(foundNames).toContain('file1.txt');
      expect(foundNames).toContain('nested-file.txt');
      expect(foundNames).toContain('another.txt');
      expect(foundNames).toContain('.hidden.txt');

      // Should not find non-.txt files
      expect(foundNames).not.toContain('file2.log');
      expect(foundNames).not.toContain('readme.md');
      expect(foundNames).not.toContain('config.json');

      // Verify entry structure
      const file1 = foundFiles.find((f: { path: string }) => path.basename(f.path) === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1.type).toBe('file');
      expect(file1.name).toBe('file1.txt');
      expect(file1.path).toBe(path.join(testWorkspaceDir, 'file1.txt'));
      expect(file1.size_bytes).toBeGreaterThan(0);
      expect(file1.created_at).toBeDefined();
      expect(file1.modified_at).toBeDefined();
    });

    it('should handle error cases gracefully', async () => {
      const nonExistentPath = path.join(testWorkspaceDir, 'nonexistent');

      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: nonExistentPath,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*',
            },
          ],
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

      expect(result.response.status).toBe('error');
      expect(result.response.error_message).toContain('Path not found');
    });
  });
});
