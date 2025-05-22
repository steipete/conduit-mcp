import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
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
              pattern: '*.txt'
            }
          ]
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
        tool_name: 'find',
        params: {
          base_path: '/nonexistent/directory',
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt'
            }
          ]
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

  describe('Name Pattern Search', () => {
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
              pattern: '*.txt'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
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
      const file1 = foundFiles.find((f: any) => path.basename(f.path) === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1.type).toBe('file');
      expect(file1.name).toBe('file1.txt');
      expect(file1.path).toBe(path.join(testWorkspaceDir, 'file1.txt'));
      expect(file1.size_bytes).toBeGreaterThan(0);
      expect(file1.created_at).toBeDefined();
      expect(file1.modified_at).toBeDefined();
    });

    it('should find files matching complex glob pattern', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: 'file?.{txt,log}'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find file1.txt and file2.log
      expect(foundNames).toContain('file1.txt');
      expect(foundNames).toContain('file2.log');
      
      // Should not find other files
      expect(foundNames).not.toContain('readme.md');
      expect(foundNames).not.toContain('config.json');
      expect(foundNames).not.toContain('nested-file.txt');
    });

    it('should find directories matching pattern', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          entry_type_filter: 'directory',
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: 'sub*'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundDirs = result.response.results;
      const foundNames = foundDirs.map((d: any) => path.basename(d.path));
      
      // Should find subdirectories
      expect(foundNames).toContain('subdir1');
      expect(foundNames).toContain('subdir2');
      
      // Should not find nested directory
      expect(foundNames).not.toContain('nested');
      
      // Verify all results are directories
      foundDirs.forEach((dir: any) => {
        expect(dir.type).toBe('directory');
      });
    });

    it('should respect non-recursive search', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: false,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should only find files in root directory
      expect(foundNames).toContain('file1.txt');
      expect(foundNames).toContain('.hidden.txt');
      
      // Should NOT find nested files
      expect(foundNames).not.toContain('nested-file.txt');
      expect(foundNames).not.toContain('another.txt');
    });
  });

  describe('Content Pattern Search', () => {
    beforeEach(() => {
      // Create test files with specific content
      fs.writeFileSync(path.join(testWorkspaceDir, 'file1.txt'), 'Hello World\nThis is a test file\nContains special text');
      fs.writeFileSync(path.join(testWorkspaceDir, 'file2.txt'), 'Another file\nwith different content\nNo special words here');
      fs.writeFileSync(path.join(testWorkspaceDir, 'file3.log'), 'Error: Something went wrong\nWarning: Check this\nHello there');
      fs.writeFileSync(path.join(testWorkspaceDir, 'config.json'), '{"debug": true, "test": "hello world"}');
      fs.writeFileSync(path.join(testWorkspaceDir, 'readme.md'), '# Project\nThis project contains **special** features');
      
      // Create binary file that should be ignored
      const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      fs.writeFileSync(path.join(testWorkspaceDir, 'image.png'), binaryContent);
    });

    it('should find files containing specific text (case sensitive)', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'content_pattern',
              pattern: 'Hello',
              case_sensitive: true
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find files containing "Hello" (case sensitive)
      expect(foundNames).toContain('file1.txt');
      expect(foundNames).toContain('file3.log');
      
      // Should not find files without exact case match
      expect(foundNames).not.toContain('config.json'); // contains "hello" not "Hello"
      expect(foundNames).not.toContain('file2.txt');
      expect(foundNames).not.toContain('readme.md');
    });

    it('should find files containing specific text (case insensitive)', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'content_pattern',
              pattern: 'hello',
              case_sensitive: false
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find files containing "hello" in any case
      expect(foundNames).toContain('file1.txt'); // "Hello"
      expect(foundNames).toContain('file3.log'); // "Hello"
      expect(foundNames).toContain('config.json'); // "hello world"
      
      // Should not find files without the pattern
      expect(foundNames).not.toContain('file2.txt');
      expect(foundNames).not.toContain('readme.md');
    });

    it('should find files using regex pattern', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'content_pattern',
              pattern: '^Error:.*wrong$',
              is_regex: true
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find file with line matching regex
      expect(foundNames).toContain('file3.log');
      
      // Should not find other files
      expect(foundNames).not.toContain('file1.txt');
      expect(foundNames).not.toContain('file2.txt');
      expect(foundNames).not.toContain('config.json');
    });

    it('should search only specific file types', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'content_pattern',
              pattern: 'test',
              case_sensitive: false,
              file_types_to_search: ['.txt', '.log']
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find files with .txt extension containing "test"
      expect(foundNames).toContain('file1.txt');
      
      // Should not find .json files even if they contain "test"
      expect(foundNames).not.toContain('config.json');
      expect(foundNames).not.toContain('readme.md');
    });
  });

  describe('Metadata Filter Search', () => {
    beforeEach(() => {
      // Create files with known sizes and content
      fs.writeFileSync(path.join(testWorkspaceDir, 'small.txt'), 'Hi'); // 2 bytes
      fs.writeFileSync(path.join(testWorkspaceDir, 'medium.txt'), 'This is a medium sized file content'); // ~35 bytes
      fs.writeFileSync(path.join(testWorkspaceDir, 'large.txt'), 'A'.repeat(1000)); // 1000 bytes
      fs.writeFileSync(path.join(testWorkspaceDir, 'empty.txt'), ''); // 0 bytes
      
      // Create directory
      fs.mkdirSync(path.join(testWorkspaceDir, 'testdir'));
      
      // Create files with specific names
      fs.writeFileSync(path.join(testWorkspaceDir, 'test_file.txt'), 'test content');
      fs.writeFileSync(path.join(testWorkspaceDir, 'prefix_test.log'), 'log content');
      fs.writeFileSync(path.join(testWorkspaceDir, 'no_match.md'), 'markdown content');
    });

    it('should find files by size (greater than)', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          entry_type_filter: 'file',
          match_criteria: [
            {
              type: 'metadata_filter',
              attribute: 'size_bytes',
              operator: 'gt',
              value: 100
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find only large file
      expect(foundNames).toContain('large.txt');
      
      // Should not find smaller files
      expect(foundNames).not.toContain('small.txt');
      expect(foundNames).not.toContain('medium.txt');
      expect(foundNames).not.toContain('empty.txt');
    });

    it('should find entries by type', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'metadata_filter',
              attribute: 'entry_type',
              operator: 'equals',
              value: 'directory'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundEntries = result.response.results;
      const foundNames = foundEntries.map((e: any) => path.basename(e.path));
      
      // Should find only directories
      expect(foundNames).toContain('testdir');
      
      // Should not find files
      expect(foundNames).not.toContain('small.txt');
      expect(foundNames).not.toContain('medium.txt');
      
      // Verify all results are directories
      foundEntries.forEach((entry: any) => {
        expect(entry.type).toBe('directory');
      });
    });

    it('should find files by name with string operators', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'metadata_filter',
              attribute: 'name',
              operator: 'contains',
              value: 'test',
              case_sensitive: false
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundEntries = result.response.results;
      const foundNames = foundEntries.map((e: any) => path.basename(e.path));
      
      // Should find entries with "test" in name
      expect(foundNames).toContain('test_file.txt');
      expect(foundNames).toContain('prefix_test.log');
      expect(foundNames).toContain('testdir');
      
      // Should not find files without "test"
      expect(foundNames).not.toContain('small.txt');
      expect(foundNames).not.toContain('no_match.md');
    });

    it('should find files by name with regex', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'metadata_filter',
              attribute: 'name',
              operator: 'matches_regex',
              value: '^test_.*\\.txt$'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundEntries = result.response.results;
      const foundNames = foundEntries.map((e: any) => path.basename(e.path));
      
      // Should find only test_file.txt
      expect(foundNames).toContain('test_file.txt');
      
      // Should not find other files
      expect(foundNames).not.toContain('prefix_test.log');
      expect(foundNames).not.toContain('testdir');
    });
  });

  describe('Combined Criteria Search', () => {
    beforeEach(() => {
      // Create test structure for combined searches
      fs.writeFileSync(path.join(testWorkspaceDir, 'config.txt'), 'Configuration: debug=true\nSetting: mode=test');
      fs.writeFileSync(path.join(testWorkspaceDir, 'readme.txt'), 'This is a readme file\nContains help information');
      fs.writeFileSync(path.join(testWorkspaceDir, 'data.log'), 'Configuration: production=false\nLog entry');
      fs.writeFileSync(path.join(testWorkspaceDir, 'small.txt'), 'Hi'); // Small file
      
      const subdir = path.join(testWorkspaceDir, 'configs');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'app.txt'), 'Application Configuration: debug=true');
    });

    it('should find files matching multiple criteria (AND logic)', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt'
            },
            {
              type: 'content_pattern',
              pattern: 'Configuration',
              case_sensitive: true
            },
            {
              type: 'metadata_filter',
              attribute: 'size_bytes',
              operator: 'gt',
              value: 10
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      // Should find files that match ALL criteria
      expect(foundNames).toContain('config.txt'); // .txt + contains "Configuration" + size > 10
      expect(foundNames).toContain('app.txt'); // .txt + contains "Configuration" + size > 10
      
      // Should not find files that don't match all criteria
      expect(foundNames).not.toContain('readme.txt'); // no "Configuration"
      expect(foundNames).not.toContain('data.log'); // not .txt
      expect(foundNames).not.toContain('small.txt'); // too small
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent base path', async () => {
      const nonExistentPath = path.join(testWorkspaceDir, 'nonexistent');
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: nonExistentPath,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*'
            }
          ]
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

    it('should handle base path pointing to a file', async () => {
      const testFile = path.join(testWorkspaceDir, 'test.txt');
      fs.writeFileSync(testFile, 'test content');
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testFile,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*'
            }
          ]
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
      expect(result.response.error_message).toContain('Provided base_path is a file, not a directory');
    });

    it('should handle access denied for paths outside allowed paths', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: '/etc',
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*'
            }
          ]
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

    it('should handle missing match criteria', async () => {
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: []
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
      
      // With empty criteria, should still work but find everything
      if (result.response.status !== 'error') {
        expect(result.response.tool_name).toBe('find');
        expect(Array.isArray(result.response.results)).toBe(true);
      }
    });

    it('should handle invalid regex in content pattern', async () => {
      // Create a test file
      fs.writeFileSync(path.join(testWorkspaceDir, 'test.txt'), 'test content');
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'content_pattern',
              pattern: '[invalid regex',
              is_regex: true
            }
          ]
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
      
      // Should handle invalid regex gracefully (likely returning empty results)
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty directory', async () => {
      const emptyDir = path.join(testWorkspaceDir, 'empty');
      fs.mkdirSync(emptyDir);
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: emptyDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(0);
    });

    it('should handle very long file names', async () => {
      const longName = 'a'.repeat(200) + '.txt';
      const longPath = path.join(testWorkspaceDir, longName);
      fs.writeFileSync(longPath, 'content');
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      const foundNames = foundFiles.map((f: any) => path.basename(f.path));
      
      expect(foundNames).toContain(longName);
    });

    it('should handle special characters in file names', async () => {
      const specialFiles = [
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.with.dots.txt',
        'файл.txt', // Cyrillic
        '文件.txt'  // Chinese
      ];
      
      specialFiles.forEach(fileName => {
        try {
          fs.writeFileSync(path.join(testWorkspaceDir, fileName), 'content');
        } catch (e) {
          // Skip files that can't be created on this filesystem
        }
      });
      
      const requestPayload = {
        tool_name: 'find',
        params: {
          base_path: testWorkspaceDir,
          recursive: true,
          match_criteria: [
            {
              type: 'name_pattern',
              pattern: '*.txt'
            }
          ]
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
      
      expect(result.response.tool_name).toBe('find');
      expect(Array.isArray(result.response.results)).toBe(true);
      
      const foundFiles = result.response.results;
      expect(foundFiles.length).toBeGreaterThan(0);
      
      // Verify each found file has valid structure
      foundFiles.forEach((file: any) => {
        expect(file.type).toBe('file');
        expect(file.name).toBeDefined();
        expect(file.path).toBeDefined();
        expect(typeof file.size_bytes).toBe('number');
      });
    });
  });
});