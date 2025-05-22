import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import path from 'path';
import fs from 'fs';

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

  describe('First Use Informational Notice', () => {
    it('should show info notice on first request with default paths', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: '/nonexistent/directory'
        }
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
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: '/nonexistent/directory'
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      // Should be the direct tool response object (no notice)
      expect(result.response.status).toBe('error');
      expect(result.response.error_message).toContain('Path not found');
    });
  });

  describe('List Entries Operations', () => {
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
      const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      fs.writeFileSync(path.join(testWorkspaceDir, 'test.png'), binaryContent);
    });

    it('should successfully list directory entries (non-recursive)', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testWorkspaceDir,
          recursive_depth: 0
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      // Should be the direct tool response object (no notice due to CONDUIT_ALLOWED_PATHS)
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
      
      // Verify entry structure
      const file1 = entries.find((entry: any) => entry.name === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1.type).toBe('file');
      expect(file1.size_bytes).toBe(11); // "Hello World"
      expect(file1.path).toBe(path.join(testWorkspaceDir, 'file1.txt'));
      expect(file1.created_at).toBeDefined();
      expect(file1.modified_at).toBeDefined();
      // mime_type is optional for files
      if (file1.mime_type) {
        expect(typeof file1.mime_type).toBe('string');
      }
      
      const subdir1 = entries.find((entry: any) => entry.name === 'subdir1');
      expect(subdir1).toBeDefined();
      expect(subdir1.type).toBe('directory');
      expect(subdir1.path).toBe(path.join(testWorkspaceDir, 'subdir1'));
      expect(subdir1.children).toBeUndefined(); // No children at depth 0
      
      const emptyFile = entries.find((entry: any) => entry.name === 'empty.txt');
      expect(emptyFile).toBeDefined();
      expect(emptyFile.type).toBe('file');
      expect(emptyFile.size_bytes).toBe(0);
    });

    it('should successfully list directory entries with recursion', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testWorkspaceDir,
          recursive_depth: 2
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.tool_name).toBe('list');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const entries = result.response.results;
      
      // Find subdir1 and check its children
      const subdir1 = entries.find((entry: any) => entry.name === 'subdir1');
      expect(subdir1).toBeDefined();
      expect(subdir1.type).toBe('directory');
      expect(Array.isArray(subdir1.children)).toBe(true);
      expect(subdir1.children.length).toBeGreaterThan(0);
      
      // Check for nested file
      const nestedFile = subdir1.children.find((entry: any) => entry.name === 'nested-file.txt');
      expect(nestedFile).toBeDefined();
      expect(nestedFile.type).toBe('file');
      expect(nestedFile.size_bytes).toBe(14); // "Nested content"
      
      // Check for nested directory
      const nestedDir = subdir1.children.find((entry: any) => entry.name === 'nested');
      expect(nestedDir).toBeDefined();
      expect(nestedDir.type).toBe('directory');
      expect(Array.isArray(nestedDir.children)).toBe(true);
      
      // Check deep file
      const deepFile = nestedDir.children.find((entry: any) => entry.name === 'deep-file.txt');
      expect(deepFile).toBeDefined();
      expect(deepFile.type).toBe('file');
      expect(deepFile.size_bytes).toBe(12); // "Deep content"
    });

    it('should calculate recursive directory sizes when requested', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testWorkspaceDir,
          recursive_depth: 1,
          calculate_recursive_size: true
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.tool_name).toBe('list');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const entries = result.response.results;
      
      // Find directories and check they have size_bytes calculated
      const subdir1 = entries.find((entry: any) => entry.name === 'subdir1');
      expect(subdir1).toBeDefined();
      expect(subdir1.type).toBe('directory');
      expect(typeof subdir1.size_bytes).toBe('number');
      expect(subdir1.size_bytes).toBeGreaterThan(0); // Should contain size of nested files
      
      const subdir2 = entries.find((entry: any) => entry.name === 'subdir2');
      expect(subdir2).toBeDefined();
      expect(subdir2.type).toBe('directory');
      expect(typeof subdir2.size_bytes).toBe('number');
      expect(subdir2.size_bytes).toBe(0); // Empty directory
    });

    it('should handle depth limiting correctly', async () => {
      // Create deeper structure for testing depth limits
      const deepPath = path.join(testWorkspaceDir, 'level1', 'level2', 'level3', 'level4');
      fs.mkdirSync(deepPath, { recursive: true });
      fs.writeFileSync(path.join(deepPath, 'very-deep.txt'), 'Very deep content');

      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testWorkspaceDir,
          recursive_depth: 2
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      const entries = result.response.results;
      const level1 = entries.find((entry: any) => entry.name === 'level1');
      expect(level1).toBeDefined();
      expect(level1.children).toBeDefined();
      
      const level2 = level1.children.find((entry: any) => entry.name === 'level2');
      expect(level2).toBeDefined();
      expect(level2.children).toBeDefined();
      
      const level3 = level2.children.find((entry: any) => entry.name === 'level3');
      expect(level3).toBeDefined();
      // At depth 2, level3 should not have children populated due to depth limit
      expect(level3.children).toBeUndefined();
    });

    it('should handle listing a file path (should fail)', async () => {
      const testFile = path.join(testWorkspaceDir, 'file1.txt');
      
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: testFile
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      expect(result.response.error_code).toBe('ERR_FS_PATH_IS_FILE');
      expect(result.response.error_message).toContain('Provided path is a file, not a directory');
    });

    it('should handle non-existent directory', async () => {
      const nonExistentDir = path.join(testWorkspaceDir, 'nonexistent');
      
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: nonExistentDir
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      expect(result.response.error_message).toContain('Path not found');
    });

    it('should handle access denied for paths outside allowed paths', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries',
          path: '/etc'
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      expect(result.response.error_code).toBe('ERR_FS_PERMISSION_DENIED');
      expect(result.response.error_message).toMatch(/Access to path is denied|Access denied|Path not allowed/i);
    });
  });

  describe('System Info Operations', () => {
    it('should return server capabilities', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'system_info',
          info_type: 'server_capabilities'
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.tool_name).toBe('list');
      expect(result.response.results).toBeDefined();
      
      const capabilities = result.response.results;
      expect(capabilities.server_version).toBeDefined();
      expect(capabilities.active_configuration).toBeDefined();
      expect(Array.isArray(capabilities.supported_checksum_algorithms)).toBe(true);
      expect(capabilities.supported_checksum_algorithms).toContain('md5');
      expect(capabilities.supported_checksum_algorithms).toContain('sha256');
      expect(Array.isArray(capabilities.supported_archive_formats)).toBe(true);
      expect(capabilities.supported_archive_formats).toContain('zip');
      expect(capabilities.default_checksum_algorithm).toBeDefined();
      expect(typeof capabilities.max_recursive_depth).toBe('number');
      
      // Check active configuration
      expect(capabilities.active_configuration.ALLOWED_PATHS).toBeDefined();
      expect(capabilities.active_configuration.MAX_RECURSIVE_DEPTH).toBeDefined();
      expect(capabilities.active_configuration.HTTP_TIMEOUT_MS).toBeDefined();
    });

    it('should return filesystem stats with path', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'system_info',
          info_type: 'filesystem_stats',
          path: testWorkspaceDir
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.tool_name).toBe('list');
      expect(result.response.results).toBeDefined();
      
      const stats = result.response.results;
      expect(stats.path_queried).toBeDefined();
      expect(typeof stats.total_bytes).toBe('number');
      expect(typeof stats.free_bytes).toBe('number');
      expect(typeof stats.available_bytes).toBe('number');
      expect(typeof stats.used_bytes).toBe('number');
      expect(stats.total_bytes).toBeGreaterThan(0);
      expect(stats.free_bytes).toBeGreaterThanOrEqual(0);
      expect(stats.available_bytes).toBeGreaterThanOrEqual(0);
      expect(stats.used_bytes).toBeGreaterThanOrEqual(0);
    });

    it('should return filesystem stats info when no path provided', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'system_info',
          info_type: 'filesystem_stats'
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.tool_name).toBe('list');
      expect(result.response.results).toBeDefined();
      
      const info = result.response.results;
      expect(info.info_type_requested).toBe('filesystem_stats');
      expect(info.status_message).toContain('No specific path provided');
      expect(info.server_version).toBeDefined();
      expect(info.server_start_time_iso).toBeDefined();
      expect(Array.isArray(info.configured_allowed_paths)).toBe(true);
    });

    it('should handle invalid info_type', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'system_info',
          info_type: 'invalid_type'
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      expect(result.response.error_code).toBe('ERR_INVALID_PARAMETER');
      expect(result.response.error_message).toContain('Unknown info_type');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operation', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'invalid_operation',
          path: testWorkspaceDir
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      expect(result.response.error_code).toBe('ERR_INVALID_PARAMETER');
      expect(result.response.error_message).toContain('Unknown operation');
    });

    it('should handle missing path parameter for entries operation', async () => {
      const requestPayload = {
        tool_name: 'list',
        params: {
          operation: 'entries'
          // Missing path parameter
        }
      };

      const result = await runConduitMCPScript(requestPayload, {
        CONDUIT_ALLOWED_PATHS: testWorkspaceDir
      });

      if (result.exitCode !== 0) {
        console.error(result.error);
      }
      expect(result.exitCode).toBe(0);
      expect(result.response).toBeDefined();
      
      expect(result.response.status).toBe('error');
      // The exact error may vary based on validation, but should be an error
      expect(['ERR_MISSING_PARAMETER', 'ERR_INVALID_PARAMETER', 'ERR_FS_INVALID_PATH']).toContain(result.response.error_code);
    });
  });
});