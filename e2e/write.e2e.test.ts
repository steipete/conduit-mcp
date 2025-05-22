import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir, tempFileExists, readTempFile } from './utils/tempFs';
import path from 'path';
import fs from 'fs';

describe('E2E Write Operations', () => {
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

      // Verify file was actually created
      expect(tempFileExists(testFile)).toBe(true);
      expect(readTempFile(testFile)).toBe('Hello, World!');
    });
  });

  describe('Write Content Operations', () => {
    it('should successfully write a text file', async () => {
      const testFile = path.join(testWorkspaceDir, 'test-write.txt');
      const testContent = 'Hello, World!\nThis is a test file.\nLine 3 with special chars: åäö';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: testContent,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);
      expect(result.response.results[0].bytes_written).toBeGreaterThan(0);

      // Verify filesystem side effects
      expect(tempFileExists(testFile)).toBe(true);
      const actualContent = readTempFile(testFile);
      expect(actualContent).toBe(testContent);
    });

    it('should successfully write binary content with base64 format', async () => {
      const testFile = path.join(testWorkspaceDir, 'test.png');
      // Simple PNG header bytes
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const base64Content = binaryContent.toString('base64');

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: base64Content,
              input_encoding: 'base64',
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);
      expect(result.response.results[0].bytes_written).toBeGreaterThan(0);

      // Verify filesystem side effects
      expect(tempFileExists(testFile)).toBe(true);
      const actualContent = fs.readFileSync(testFile);
      expect(actualContent.equals(binaryContent)).toBe(true);
    });

    it('should create parent directories when they do not exist', async () => {
      const testFile = path.join(testWorkspaceDir, 'nested', 'directory', 'test.txt');
      const testContent = 'Content in nested directory';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: testContent,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);

      // Verify filesystem side effects
      expect(tempFileExists(testFile)).toBe(true);
      const actualContent = readTempFile(testFile);
      expect(actualContent).toBe(testContent);

      // Verify parent directories were created
      const parentDir = path.dirname(testFile);
      expect(fs.existsSync(parentDir)).toBe(true);
      expect(fs.lstatSync(parentDir).isDirectory()).toBe(true);
    });

    it('should overwrite existing file content', async () => {
      const testFile = path.join(testWorkspaceDir, 'overwrite-test.txt');
      const originalContent = 'Original content';
      const newContent = 'New content that replaces the original';

      // First, create the file with original content
      fs.writeFileSync(testFile, originalContent);
      expect(readTempFile(testFile)).toBe(originalContent);

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: newContent,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);

      // Verify filesystem side effects - file should be overwritten
      expect(tempFileExists(testFile)).toBe(true);
      const actualContent = readTempFile(testFile);
      expect(actualContent).toBe(newContent);
      expect(actualContent).not.toBe(originalContent);
    });

    it('should handle writing empty content', async () => {
      const testFile = path.join(testWorkspaceDir, 'empty.txt');
      const emptyContent = '';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: emptyContent,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);

      // Verify filesystem side effects
      expect(tempFileExists(testFile)).toBe(true);
      const actualContent = readTempFile(testFile);
      expect(actualContent).toBe('');
      expect(fs.lstatSync(testFile).size).toBe(0);
    });
  });

  describe('Batch Write Operations', () => {
    it('should successfully write multiple files in batch', async () => {
      const file1 = path.join(testWorkspaceDir, 'batch1.txt');
      const file2 = path.join(testWorkspaceDir, 'batch2.txt');
      const content1 = 'Content for file 1';
      const content2 = 'Content for file 2';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: file1,
              content: content1,
              input_encoding: 'text',
            },
            {
              path: file2,
              content: content2,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(2);

      // Check each result
      result.response.results.forEach((writeResult: unknown, index: number) => {
        const result = writeResult as { status: string; path: string };
        expect(result.status).toBe('success');
        expect(result.path).toBe(index === 0 ? file1 : file2);
      });

      // Verify filesystem side effects
      expect(tempFileExists(file1)).toBe(true);
      expect(tempFileExists(file2)).toBe(true);
      expect(readTempFile(file1)).toBe(content1);
      expect(readTempFile(file2)).toBe(content2);
    });

    it('should handle mixed success and failure in batch operations', async () => {
      const validFile = path.join(testWorkspaceDir, 'valid.txt');
      const invalidFile = '/invalid/path/that/should/fail.txt'; // Path that doesn't exist
      const validContent = 'Valid content';
      const invalidContent = 'Invalid content';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: validFile,
              content: validContent,
              input_encoding: 'text',
            },
            {
              path: invalidFile,
              content: invalidContent,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(2);

      // First write should succeed
      const firstResult = result.response.results[0];
      expect(firstResult.status).toBe('success');
      expect(firstResult.path).toBe(validFile);

      // Second write should fail (path doesn't exist)
      const secondResult = result.response.results[1];
      expect(secondResult.status).toBe('error');
      expect(secondResult.path).toBe(invalidFile);
      expect(secondResult.error_message).toMatch(
        /ENOENT|no such file or directory|Failed to write/i
      );

      // Verify filesystem side effects
      expect(tempFileExists(validFile)).toBe(true);
      expect(readTempFile(validFile)).toBe(validContent);
      expect(fs.existsSync(invalidFile)).toBe(false);
    });
  });

  describe('Directory Creation Operations', () => {
    it('should successfully create a directory', async () => {
      const testDir = path.join(testWorkspaceDir, 'new-directory');

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'mkdir',
          entries: [
            {
              path: testDir,
              recursive: true,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testDir);

      // Verify filesystem side effects
      expect(fs.existsSync(testDir)).toBe(true);
      expect(fs.lstatSync(testDir).isDirectory()).toBe(true);
    });

    it('should create nested directories recursively', async () => {
      const nestedDir = path.join(testWorkspaceDir, 'level1', 'level2', 'level3');

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'mkdir',
          entries: [
            {
              path: nestedDir,
              recursive: true,
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

      // Verify tool response
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(nestedDir);

      // Verify filesystem side effects
      expect(fs.existsSync(nestedDir)).toBe(true);
      expect(fs.lstatSync(nestedDir).isDirectory()).toBe(true);

      // Verify all parent directories were created
      expect(fs.existsSync(path.join(testWorkspaceDir, 'level1'))).toBe(true);
      expect(fs.existsSync(path.join(testWorkspaceDir, 'level1', 'level2'))).toBe(true);
    });

    it('should handle creating directory that already exists', async () => {
      const testDir = path.join(testWorkspaceDir, 'existing-directory');

      // Create the directory first
      fs.mkdirSync(testDir);
      expect(fs.existsSync(testDir)).toBe(true);

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'mkdir',
          entries: [
            {
              path: testDir,
              recursive: true,
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

      // Should still succeed (idempotent operation)
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testDir);

      // Directory should still exist
      expect(fs.existsSync(testDir)).toBe(true);
      expect(fs.lstatSync(testDir).isDirectory()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle access denied for paths outside allowed paths', async () => {
      const forbiddenFile = '/etc/forbidden.txt';
      const testContent = 'This should not be written';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: forbiddenFile,
              content: testContent,
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

      // Should be an error response (currently gets write failed rather than permission denied)
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('error');
      expect(result.response.results[0].path).toBe(forbiddenFile);
      expect(result.response.results[0].error_code).toBe('ERR_FS_WRITE_FAILED');
      expect(result.response.results[0].error_message).toMatch(
        /ENOENT|no such file or directory|Failed to write/i
      );

      // Verify file was not created
      expect(fs.existsSync(forbiddenFile)).toBe(false);
    });

    it('should handle invalid content format gracefully (currently defaults to text)', async () => {
      // Note: Currently, invalid input_encoding values default to text encoding
      // This test documents the current behavior - may need future improvement
      const testFile = path.join(testWorkspaceDir, 'invalid-format.txt');
      const testContent = 'Some content';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: testContent,
              input_encoding: 'invalid_format',
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

      // Currently succeeds (defaults to text encoding)
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);

      // Verify file was created with content treated as text
      expect(tempFileExists(testFile)).toBe(true);
      expect(readTempFile(testFile)).toBe(testContent);
    });

    it('should handle missing required parameters', async () => {
      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          // Missing entries
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

      // Should be an error response (top-level error, not results array)
      expect(result.response.status).toBe('error');
      expect(result.response.error_code).toBe('ERR_MISSING_ENTRIES_FOR_BATCH');
      expect(result.response.error_message).toMatch(/Entries array cannot be empty/i);
    });

    it('should handle invalid base64 content gracefully (currently succeeds)', async () => {
      // Note: Currently, invalid base64 content doesn't fail validation in fileSystemOps
      // Buffer.from() with 'base64' encoding is forgiving and will decode what it can
      const testFile = path.join(testWorkspaceDir, 'invalid-base64.bin');
      const invalidBase64 = 'This is not valid base64!@#$%';

      const requestPayload = {
        tool_name: 'write',
        params: {
          action: 'put',
          entries: [
            {
              path: testFile,
              content: invalidBase64,
              input_encoding: 'base64',
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

      // Currently succeeds (Buffer.from is forgiving with base64)
      expect(result.response.tool_name).toBe('write');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
      expect(result.response.results[0].path).toBe(testFile);

      // File gets created (though content may be partially decoded/corrupted)
      expect(tempFileExists(testFile)).toBe(true);
    });
  });
});
