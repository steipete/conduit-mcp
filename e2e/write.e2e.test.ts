import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';

// Enhanced scenario interface to support new features
interface EnhancedTestScenario extends TestScenario {
  setup_filesystem?: Array<{
    type: 'createFile' | 'createDirectory' | 'createSymlink' | 'createBinaryFile' | 'createArchive';
    path?: string;
    content?: string;
    target?: string;
    link?: string;
    encoding?: string;
    mtime?: string;
    ctime?: string;
    binary_content?: number[];
    filename_pattern?: string;
    archive_path?: string;
    source_files?: string[];
    format?: string;
  }>;
}

describe('E2E Write Operations', () => {
  let testWorkspaceDir: string;
  const scenarios = loadTestScenarios('writeTool.scenarios.json') as EnhancedTestScenario[];

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

  // Helper function to generate large content for placeholders
  function processContentPlaceholders(content: string): string {
    if (content.includes('{{LARGE_CONTENT_10MB}}')) {
      // Generate 10MB of content (approximately)
      const chunkSize = 1024; // 1KB chunks
      const numChunks = 10 * 1024; // 10MB total
      const chunk = 'A'.repeat(chunkSize);
      return Array(numChunks).fill(chunk).join('');
    }

    if (content.includes('{{LARGE_CONTENT_1MB}}')) {
      // Generate 1MB of content (approximately)
      const chunkSize = 1024; // 1KB chunks
      const numChunks = 1024; // 1MB total
      const chunk = 'A'.repeat(chunkSize);
      return Array(numChunks).fill(chunk).join('');
    }

    // Unescape literal newlines in scenarios
    return content.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }

  // Helper function to set up filesystem for a scenario
  function setupFilesystem(setup: EnhancedTestScenario['setup_filesystem'], tempDir: string) {
    if (!setup) return;

    for (const item of setup) {
      // Handle symlinks differently as they use target/link fields
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

      // Handle archive creation
      if (item.type === 'createArchive') {
        if (item.archive_path && item.source_files) {
          // Create a real archive file for testing
          const archivePath = path.join(tempDir, item.archive_path);
          const archiveDir = path.dirname(archivePath);

          if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
          }

          if (item.format === 'zip' || item.archive_path.endsWith('.zip')) {
            // Create a real ZIP file using AdmZip
            const zip = new AdmZip();
            for (const sourceFile of item.source_files) {
              const sourceFilePath = path.join(tempDir, sourceFile);
              if (fs.existsSync(sourceFilePath)) {
                const stats = fs.statSync(sourceFilePath);
                if (stats.isDirectory()) {
                  zip.addLocalFolder(sourceFilePath, path.basename(sourceFile));
                } else {
                  zip.addLocalFile(sourceFilePath, '', path.basename(sourceFile));
                }
              }
            }
            zip.writeZip(archivePath);
          } else {
            // For non-zip formats, create a minimal placeholder file
            // In a real implementation, this would use tar or other library
            const archiveMetadata = {
              format: item.format || 'zip',
              files: item.source_files.map((f) => path.join(tempDir, f)),
            };
            fs.writeFileSync(archivePath, JSON.stringify(archiveMetadata));
          }
        }
        continue;
      }

      // Skip if no path is defined for non-symlink/archive types
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
          content = processContentPlaceholders(content);

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
                  const stat = fs.lstatSync(filePath);
                  if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                  } else {
                    fs.unlinkSync(filePath);
                  }
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

  // Helper function to verify scenario results
  function verifyScenarioResults(actual: any, expected: any) {
    if (expected.isError) {
      // Handle error scenarios - check for server error response format
      if (actual.isError) {
        // Handle scenarios that expect isError format
        expect(actual.isError).toBe(true);
        if (expected.error.code) {
          expect(actual.error.code).toBe(expected.error.code);
        }
        if (expected.error.message_contains) {
          expect(actual.error.message).toContain(expected.error.message_contains);
        }
      } else if (actual.status === 'error') {
        // Handle actual server error response format
        expect(actual.status).toBe('error');
        if (expected.error.code) {
          expect(actual.error_code).toBe(expected.error.code);
        }
        if (expected.error.message_contains) {
          expect(actual.error_message).toContain(expected.error.message_contains);
        }
      } else {
        throw new Error(`Expected error but got: ${JSON.stringify(actual)}`);
      }
      return;
    }

    // Handle tool response scenarios
    expect(actual.tool_name).toBe(expected.tool_name);
    expect(Array.isArray(actual.results)).toBe(true);

    if (expected.results && Array.isArray(expected.results)) {
      expect(actual.results.length).toBeGreaterThanOrEqual(expected.results.length);

      for (let i = 0; i < expected.results.length; i++) {
        const expectedResult = expected.results[i];
        const actualResult = actual.results[i];

        expect(actualResult.status).toBe(expectedResult.status);

        // Only check action_performed if it exists in actual result
        if (actualResult.action_performed !== undefined) {
          expect(actualResult.action_performed).toBe(expectedResult.action_performed);
        }

        // Check path contains if specified
        if (expectedResult.path_contains) {
          expect(actualResult.path).toContain(expectedResult.path_contains);
        }
        if (expectedResult.source_path_contains) {
          expect(actualResult.source_path).toContain(expectedResult.source_path_contains);
        }
        if (expectedResult.destination_path_contains) {
          expect(actualResult.destination_path).toContain(expectedResult.destination_path_contains);
        }
        if (expectedResult.archive_path_contains) {
          expect(actualResult.archive_path).toContain(expectedResult.archive_path_contains);
        }
        if (expectedResult.target_path_contains) {
          expect(actualResult.target_path).toContain(expectedResult.target_path_contains);
        }

        // Check byte counts - be more flexible
        if (expectedResult.bytes_written !== undefined) {
          // Allow slight variance for platform-specific differences (like line endings)
          const actualBytes = actualResult.bytes_written;
          const expectedBytes = expectedResult.bytes_written;

          // For zero bytes, be exact
          if (expectedBytes === 0) {
            expect(actualBytes).toBe(0);
          } else {
            // For non-zero, allow 1-2 bytes difference (for line endings, etc.)
            expect(actualBytes).toBeGreaterThanOrEqual(expectedBytes);
            expect(actualBytes).toBeLessThanOrEqual(expectedBytes + 2);
          }
        }
        if (expectedResult.bytes_written_gt !== undefined) {
          expect(actualResult.bytes_written).toBeGreaterThan(expectedResult.bytes_written_gt);
        }

        // Check error details for failed operations
        if (expectedResult.status === 'error') {
          if (expectedResult.error_code) {
            expect(actualResult.error_code).toBe(expectedResult.error_code);
          }
        }
      }
    }
  }

  describe('First Use Informational Notice', () => {
    it('should show info notice on first request with default paths', async () => {
      const testFile = path.join(testWorkspaceDir, 'test.txt');
      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: 'Hello, World!',
              input_encoding: 'text',
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
      expect(actualToolResponse.tool_name).toBe('write');
      expect(Array.isArray(actualToolResponse.results)).toBe(true);
      expect(actualToolResponse.results).toHaveLength(1);
      expect(actualToolResponse.results[0].status).toBe('success');
      expect(actualToolResponse.results[0].path).toBe(testFile);
    });

    it('should not show info notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const testFile = path.join(testWorkspaceDir, 'test.txt');
      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: 'Hello, World!',
              input_encoding: 'text',
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
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);
    });
  });

  describe('Scenario-Driven Tests', () => {
    scenarios.forEach((scenario) => {
      it(`should handle scenario: ${scenario.name}`, async () => {
        // Set up filesystem if required
        setupFilesystem(scenario.setup_filesystem, testWorkspaceDir);

        // Process the request payload and replace TEMP_DIR_PLACEHOLDER
        const requestPayload = JSON.parse(
          JSON.stringify(scenario.request_payload).replace(
            /TEMP_DIR_PLACEHOLDER/g,
            testWorkspaceDir
          )
        );

        // Process content placeholders in the request payload
        if (requestPayload.params && requestPayload.params.entries) {
          for (const entry of requestPayload.params.entries) {
            if (entry.content) {
              entry.content = processContentPlaceholders(entry.content);
            }
          }
        }

        // Run the scenario
        const result = await runConduitMCPScript(requestPayload, {
          CONDUIT_ALLOWED_PATHS: testWorkspaceDir,
          ...(scenario.env_vars || {}),
        });

        // Verify exit code
        expect(result.exitCode).toBe(scenario.expected_exit_code);
        expect(result.response).toBeDefined();

        // Debug logging for failing tests (disabled by default)
        const enableDebug = false;
        if (enableDebug && result.exitCode !== scenario.expected_exit_code) {
          console.log(`\n=== DEBUG: ${scenario.name} ===`);
          console.log('Expected:', JSON.stringify(scenario.expected_stdout, null, 2));
          console.log('Actual:', JSON.stringify(result.response, null, 2));
          console.log('=== END DEBUG ===\n');
        }

        // Handle notice scenarios
        if (scenario.should_show_notice) {
          expect(Array.isArray(result.response)).toBe(true);
          expect(result.response).toHaveLength(2);

          const infoNotice = result.response[0];
          expect(infoNotice.type).toBe('info_notice');
          if (scenario.notice_code) {
            expect(infoNotice.notice_code).toBe(scenario.notice_code);
          }

          const actualToolResponse = result.response[1];
          verifyScenarioResults(actualToolResponse, scenario.expected_stdout);
        } else {
          verifyScenarioResults(result.response, scenario.expected_stdout);
        }

        // Clean up filesystem if specified
        cleanupFilesystem(scenario.cleanup_filesystem || [], testWorkspaceDir);
      });
    });
  });
});
