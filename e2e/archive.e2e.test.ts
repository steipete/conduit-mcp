import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import { loadTestScenarios, TestScenario } from './utils/scenarioLoader';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

describe('E2E Archive Tool Scenarios', () => {
  let testWorkspaceDir: string;
  const scenarios = loadTestScenarios('archiveTool.scenarios.json');

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
  async function setupFilesystem(setupCommands: any[] = []): Promise<void> {
    for (const command of setupCommands) {
      const targetPath = path.join(testWorkspaceDir, command.path || '');

      switch (command.type) {
        case 'createFile':
          await createFileForTest(targetPath, command.content || '');
          break;

        case 'createDirectory':
          fs.mkdirSync(targetPath, { recursive: true });
          break;

        case 'createSymlink': {
          const targetFile = path.join(testWorkspaceDir, command.target);
          const linkPath = path.join(testWorkspaceDir, command.link);

          // Ensure target exists for symlinks
          if (!fs.existsSync(targetFile)) {
            await createFileForTest(targetFile, 'target content');
          }

          try {
            fs.symlinkSync(path.relative(path.dirname(linkPath), targetFile), linkPath);
          } catch (error) {
            // Some systems may not support symlinks, continue with warning
            console.warn(`Could not create symlink: ${error}`);
          }
          break;
        }

        case 'createMultipleFiles':
          await createMultipleFiles(command);
          break;

        case 'createZipArchive':
          await createZipArchiveForTest(command);
          break;

        case 'createTarGzArchive':
          await createTarGzArchiveForTest(command);
          break;

        case 'createEmptyZipArchive':
          await createEmptyZipArchiveForTest(command.archive_path);
          break;

        default:
          throw new Error(`Unknown setup command type: ${command.type}`);
      }
    }
  }

  // Helper function to create a file
  async function createFileForTest(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Handle special content patterns
    if (content.startsWith('REPEAT:')) {
      // Handle repeat patterns like "REPEAT:A:2000"
      const parts = content.split(':');
      if (parts.length === 3) {
        const char = parts[1];
        const count = parseInt(parts[2]);
        content = char.repeat(count);
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
  }

  // Helper function to create multiple files
  async function createMultipleFiles(command: any): Promise<void> {
    const pattern = command.pattern;
    const template = command.content_template;

    // Parse pattern like "file_{001-010}.txt"
    const match = pattern.match(/^(.+)\{(\d+)-(\d+)\}(.+)$/);
    if (!match) {
      throw new Error(`Invalid pattern: ${pattern}`);
    }

    const [, prefix, startStr, endStr, suffix] = match;
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    const padding = startStr.length;

    for (let i = start; i <= end; i++) {
      const paddedNum = i.toString().padStart(padding, '0');
      const fileName = `${prefix}${paddedNum}${suffix}`;
      const filePath = path.join(testWorkspaceDir, fileName);
      const content = template.replace('{number}', paddedNum);
      await createFileForTest(filePath, content);
    }
  }

  // Helper function to create ZIP archive for tests
  async function createZipArchiveForTest(command: any): Promise<void> {
    const archivePath = path.join(testWorkspaceDir, command.archive_path);
    const zip = new AdmZip();

    if (command.source_files) {
      // Add individual files
      for (const sourceFile of command.source_files) {
        const sourcePath = path.join(testWorkspaceDir, sourceFile);
        if (fs.existsSync(sourcePath)) {
          zip.addLocalFile(sourcePath, '', sourceFile);
        }
      }
    }

    if (command.source_paths) {
      // Add files and directories
      for (const sourcePath of command.source_paths) {
        const fullSourcePath = path.join(testWorkspaceDir, sourcePath);
        if (fs.existsSync(fullSourcePath)) {
          const stat = fs.statSync(fullSourcePath);
          if (stat.isDirectory()) {
            zip.addLocalFolder(fullSourcePath, sourcePath);
          } else {
            zip.addLocalFile(fullSourcePath, '', sourcePath);
          }
        }
      }
    }

    zip.writeZip(archivePath);
  }

  // Helper function to create TAR.GZ archive for tests
  async function createTarGzArchiveForTest(command: any): Promise<void> {
    const archivePath = path.join(testWorkspaceDir, command.archive_path);
    const sourcePaths = command.source_paths || [];

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: testWorkspaceDir,
      },
      sourcePaths
    );
  }

  // Helper function to create empty ZIP archive
  async function createEmptyZipArchiveForTest(archiveFileName: string): Promise<void> {
    const archivePath = path.join(testWorkspaceDir, archiveFileName);
    const zip = new AdmZip();
    zip.writeZip(archivePath);
  }

  // Helper function to cleanup filesystem
  function cleanupFilesystem(cleanupPaths: string[] = []): void {
    for (const cleanupPath of cleanupPaths) {
      const targetPath = path.join(testWorkspaceDir, cleanupPath);
      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(targetPath);
          }
        } catch (error) {
          // Ignore cleanup errors
          console.warn(`Cleanup warning for ${targetPath}: ${error}`);
        }
      }
    }
  }

  // Helper function to replace placeholders in request payload
  function replacePathPlaceholders(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/TEMP_DIR_PLACEHOLDER/g, testWorkspaceDir);
    }
    if (Array.isArray(obj)) {
      return obj.map(replacePathPlaceholders);
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = replacePathPlaceholders(value);
      }
      return result;
    }
    return obj;
  }

  // Helper function to validate expected output
  function validateExpectedOutput(actual: any, expected: any, scenario: TestScenario): void {
    if (!expected) return;

    if (typeof expected === 'object' && !Array.isArray(expected)) {
      for (const [key, expectedValue] of Object.entries(expected)) {
        expect(actual).toHaveProperty(key);

        if (key === 'results' && Array.isArray(expectedValue) && Array.isArray(actual[key])) {
          expect(actual[key]).toHaveLength(expectedValue.length);

          for (let i = 0; i < expectedValue.length; i++) {
            validateResultObject(actual[key][i], expectedValue[i], scenario);
          }
        } else {
          validateExpectedOutput(actual[key], expectedValue, scenario);
        }
      }
    }
  }

  // Helper function to validate individual result objects
  function validateResultObject(
    actualResult: any,
    expectedResult: any,
    scenario: TestScenario
  ): void {
    for (const [key, expectedValue] of Object.entries(expectedResult)) {
      if (key === 'size_bytes_matches') {
        validateSizeMatch(actualResult.size_bytes, expectedValue as string);
      } else if (key === 'checksum_sha256_exists') {
        if (expectedValue) {
          expect(actualResult.checksum_sha256).toBeDefined();
          expect(typeof actualResult.checksum_sha256).toBe('string');
          expect(actualResult.checksum_sha256.length).toBe(64); // SHA256 hex length
        }
      } else if (key === 'error_message_contains') {
        expect(actualResult.error_message).toContain(expectedValue);
      } else if (typeof expectedValue === 'object' && expectedValue !== null) {
        expect(actualResult).toHaveProperty(key);
        validateResultObject(actualResult[key], expectedValue, scenario);
      } else {
        expect(actualResult[key]).toBe(expectedValue);
      }
    }
  }

  // Helper function to validate size matches
  function validateSizeMatch(actualSize: number, sizePattern: string): void {
    if (sizePattern.startsWith('gt:')) {
      const minSize = parseInt(sizePattern.substring(3));
      expect(actualSize).toBeGreaterThan(minSize);
    } else if (sizePattern.startsWith('gte:')) {
      const minSize = parseInt(sizePattern.substring(4));
      expect(actualSize).toBeGreaterThanOrEqual(minSize);
    } else if (sizePattern.startsWith('lt:')) {
      const maxSize = parseInt(sizePattern.substring(3));
      expect(actualSize).toBeLessThan(maxSize);
    } else if (sizePattern.startsWith('lte:')) {
      const maxSize = parseInt(sizePattern.substring(4));
      expect(actualSize).toBeLessThanOrEqual(maxSize);
    } else {
      const expectedSize = parseInt(sizePattern);
      expect(actualSize).toBe(expectedSize);
    }
  }

  // Helper function to validate stderr expectations
  function validateStderrExpectations(actualStderr: string, expectedStderr: any): void {
    if (!expectedStderr) return;

    if (expectedStderr.contains) {
      expect(actualStderr).toContain(expectedStderr.contains);
    }
  }

  // Helper function to validate filesystem effects
  function validateFilesystemEffects(effects: any[]): void {
    if (!effects) return;

    for (const effect of effects) {
      const targetPath = path.join(testWorkspaceDir, effect.path);

      switch (effect.type) {
        case 'file_exists':
          expect(fs.existsSync(targetPath)).toBe(true);
          if (effect.content) {
            const actualContent = fs.readFileSync(targetPath, 'utf8');
            expect(actualContent).toBe(effect.content);
          }
          break;

        case 'file_not_exists':
          expect(fs.existsSync(targetPath)).toBe(false);
          break;

        case 'directory_exists':
          expect(fs.existsSync(targetPath)).toBe(true);
          expect(fs.statSync(targetPath).isDirectory()).toBe(true);
          break;

        case 'directory_not_exists':
          expect(fs.existsSync(targetPath)).toBe(false);
          break;

        default:
          throw new Error(`Unknown filesystem effect type: ${effect.type}`);
      }
    }
  }

  // Create a test for each scenario
  scenarios.forEach((scenario: TestScenario) => {
    it(`should handle scenario: ${scenario.name}`, async () => {
      try {
        // Setup filesystem if needed
        if (scenario.setup_filesystem) {
          await setupFilesystem(scenario.setup_filesystem);
        }

        // Replace placeholders in request payload
        const requestPayload = replacePathPlaceholders(scenario.request_payload);

        // Prepare environment variables
        const envVars = {
          CONDUIT_ALLOWED_PATHS: testWorkspaceDir,
          ...scenario.env_vars,
        };

        // Run the test
        const result = await runConduitMCPScript(requestPayload, envVars);

        // Validate exit code
        expect(result.exitCode).toBe(scenario.expected_exit_code);

        // Validate stderr if expected
        if (scenario.expected_stderr) {
          validateStderrExpectations(result.error, scenario.expected_stderr);
        }

        // For successful tests, validate stdout
        if (scenario.expected_exit_code === 0) {
          expect(result.response).toBeDefined();

          // Handle cases where response might be wrapped with notices
          let actualResponse = result.response;
          if (Array.isArray(result.response)) {
            if (scenario.should_show_notice) {
              expect(result.response.length).toBeGreaterThanOrEqual(2);
              // Find the actual tool response (not the notice)
              actualResponse = result.response.find((item: any) => item.tool_name);
            } else {
              // Should only be the tool response
              expect(result.response.length).toBe(1);
              actualResponse = result.response[0];
            }
          }

          // Validate expected stdout
          if (scenario.expected_stdout) {
            const expectedStdout = replacePathPlaceholders(scenario.expected_stdout);
            validateExpectedOutput(actualResponse, expectedStdout, scenario);
          }
        }

        // Validate filesystem effects if specified
        if (scenario.filesystem_effects) {
          validateFilesystemEffects(scenario.filesystem_effects);
        }
      } catch (error) {
        console.error(`Scenario ${scenario.name} failed:`, error);
        throw error;
      } finally {
        // Cleanup filesystem
        if (scenario.cleanup_filesystem) {
          cleanupFilesystem(scenario.cleanup_filesystem);
        }
      }
    }, 30000); // 30 second timeout for complex scenarios
  });
});
