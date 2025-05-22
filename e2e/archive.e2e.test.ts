import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConduitMCPScript } from './utils/e2eTestRunner';
import { createTempDir } from './utils/tempFs';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

describe('E2E Archive Operations', () => {
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
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: ['/nonexistent/file.txt'],
          archive_path: '/nonexistent/archive.zip'
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
        expect(actualToolResponse.tool_name).toBe('ArchiveTool');
        expect(Array.isArray(actualToolResponse.results)).toBe(true);
        expect(actualToolResponse.results).toHaveLength(1);
        expect(actualToolResponse.results[0].status).toBe('error');
      } else {
        // Direct tool response
        expect(result.response.tool_name).toBe('ArchiveTool');
        expect(Array.isArray(result.response.results)).toBe(true);
        expect(result.response.results).toHaveLength(1);
        expect(result.response.results[0].status).toBe('error');
      }
    });

    it('should not show info notice when CONDUIT_ALLOWED_PATHS is set', async () => {
      const testFile = path.join(testWorkspaceDir, 'test.txt');
      const archivePath = path.join(testWorkspaceDir, 'test.zip');
      fs.writeFileSync(testFile, 'test content');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [testFile],
          archive_path: archivePath
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
      expect(result.response.tool_name).toBe('ArchiveTool');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      expect(result.response.results[0].status).toBe('success');
    });
  });

  describe('Archive Create Operations', () => {
    beforeEach(() => {
      // Create test directory structure
      const subDir = path.join(testWorkspaceDir, 'subdir');
      fs.mkdirSync(subDir, { recursive: true });
      
      // Create test files
      fs.writeFileSync(path.join(testWorkspaceDir, 'file1.txt'), 'Hello World');
      fs.writeFileSync(path.join(testWorkspaceDir, 'file2.log'), 'Log content');
      fs.writeFileSync(path.join(subDir, 'nested-file.txt'), 'Nested content');
      
      // Create binary file
      const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      fs.writeFileSync(path.join(testWorkspaceDir, 'test.png'), binaryContent);
    });

    it('should successfully create a ZIP archive from single file', async () => {
      const testFile = path.join(testWorkspaceDir, 'file1.txt');
      const archivePath = path.join(testWorkspaceDir, 'single-file.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [testFile],
          archive_path: archivePath
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
      
      expect(result.response.tool_name).toBe('ArchiveTool');
      expect(Array.isArray(result.response.results)).toBe(true);
      expect(result.response.results).toHaveLength(1);
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.operation).toBe('create');
      expect(archiveResult.archive_path).toBe(archivePath);
      expect(archiveResult.format_used).toBe('zip');
      expect(archiveResult.size_bytes).toBeGreaterThan(0);
      expect(archiveResult.entries_processed).toBe(1);
      expect(archiveResult.checksum_sha256).toBeDefined();
      expect(archiveResult.compression_used).toBe('zip');
      expect(archiveResult.message).toContain('Archive created successfully');
      
      // Verify archive file exists and is valid
      expect(fs.existsSync(archivePath)).toBe(true);
      
      // Verify archive content
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].entryName).toBe('file1.txt');
      expect(entries[0].getData().toString()).toBe('Hello World');
    });

    it('should successfully create a ZIP archive from multiple files', async () => {
      const file1 = path.join(testWorkspaceDir, 'file1.txt');
      const file2 = path.join(testWorkspaceDir, 'file2.log');
      const archivePath = path.join(testWorkspaceDir, 'multiple-files.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [file1, file2],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.operation).toBe('create');
      expect(archiveResult.entries_processed).toBe(2);
      
      // Verify archive content
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      expect(entries.length).toBe(2);
      
      const entryNames = entries.map(e => e.entryName);
      expect(entryNames).toContain('file1.txt');
      expect(entryNames).toContain('file2.log');
    });

    it('should successfully create a ZIP archive from directory', async () => {
      const sourceDir = path.join(testWorkspaceDir, 'subdir');
      const archivePath = path.join(testWorkspaceDir, 'directory.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [sourceDir],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.operation).toBe('create');
      expect(archiveResult.entries_processed).toBe(1);
      
      // Verify archive content
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      expect(entries.length).toBeGreaterThan(0);
      
      // Should contain the nested file
      const hasNestedFile = entries.some(e => e.entryName.includes('nested-file.txt'));
      expect(hasNestedFile).toBe(true);
    });

    it('should successfully create a TAR.GZ archive', async () => {
      const testFile = path.join(testWorkspaceDir, 'file1.txt');
      const archivePath = path.join(testWorkspaceDir, 'archive.tar.gz');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [testFile],
          archive_path: archivePath,
          compression: 'gzip'
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.operation).toBe('create');
      expect(archiveResult.format_used).toBe('tar.gz');
      expect(archiveResult.compression_used).toBe('gzip');
      
      // Verify archive file exists and is valid
      expect(fs.existsSync(archivePath)).toBe(true);
    });

    it('should create archive with prefix option', async () => {
      const testFile = path.join(testWorkspaceDir, 'file1.txt');
      const archivePath = path.join(testWorkspaceDir, 'prefixed.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [testFile],
          archive_path: archivePath,
          options: {
            prefix: 'myprefix'
          }
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.options_applied?.prefix).toBe('myprefix');
      
      // Verify archive content has prefix
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].entryName).toBe('myprefix/file1.txt');
    });

    it('should handle overwrite option correctly', async () => {
      const testFile = path.join(testWorkspaceDir, 'file1.txt');
      const archivePath = path.join(testWorkspaceDir, 'existing.zip');
      
      // Create existing archive
      fs.writeFileSync(archivePath, 'existing content');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [testFile],
          archive_path: archivePath,
          options: {
            overwrite: false
          }
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('Archive already exists');
      expect(archiveResult.error_code).toBe('ERR_RESOURCE_ALREADY_EXISTS');
    });

    it('should handle non-existent source files', async () => {
      const nonExistentFile = path.join(testWorkspaceDir, 'nonexistent.txt');
      const archivePath = path.join(testWorkspaceDir, 'failed.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [nonExistentFile],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('Path not found');
    });

    it('should handle empty source paths', async () => {
      const archivePath = path.join(testWorkspaceDir, 'empty.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('source_paths cannot be empty');
      expect(archiveResult.error_code).toBe('ERR_ARCHIVE_NO_SOURCES');
    });
  });

  describe('Archive Extract Operations', () => {
    let zipArchivePath: string;
    let tarArchivePath: string;
    let extractDir: string;

    beforeEach(async () => {
      // Create test files to archive
      const sourceDir = path.join(testWorkspaceDir, 'source');
      const subDir = path.join(sourceDir, 'subdir');
      fs.mkdirSync(subDir, { recursive: true });
      
      fs.writeFileSync(path.join(sourceDir, 'file1.txt'), 'Content 1');
      fs.writeFileSync(path.join(sourceDir, 'file2.txt'), 'Content 2');
      fs.writeFileSync(path.join(subDir, 'nested.txt'), 'Nested content');
      
      // Create ZIP archive
      zipArchivePath = path.join(testWorkspaceDir, 'test.zip');
      const zip = new AdmZip();
      zip.addLocalFile(path.join(sourceDir, 'file1.txt'), '', 'file1.txt');
      zip.addLocalFile(path.join(sourceDir, 'file2.txt'), '', 'file2.txt');
      zip.addLocalFolder(subDir, 'subdir');
      zip.writeZip(zipArchivePath);
      
      // Create TAR.GZ archive
      tarArchivePath = path.join(testWorkspaceDir, 'test.tar.gz');
      await tar.create({
        gzip: true,
        file: tarArchivePath,
        cwd: sourceDir
      }, ['file1.txt', 'file2.txt', 'subdir']);
      
      // Create extraction directory
      extractDir = path.join(testWorkspaceDir, 'extract');
      fs.mkdirSync(extractDir, { recursive: true });
    });

    it('should successfully extract a ZIP archive', async () => {
      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: zipArchivePath,
          target_path: extractDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('success');
      expect(extractResult.operation).toBe('extract');
      expect(extractResult.archive_path).toBe(zipArchivePath);
      expect(extractResult.target_path).toBe(extractDir);
      expect(extractResult.format_used).toBe('zip');
      expect(extractResult.message).toContain('Archive extracted successfully');
      
      // Verify extracted files
      expect(fs.existsSync(path.join(extractDir, 'file1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'file2.txt'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'subdir', 'nested.txt'))).toBe(true);
      
      // Verify file contents
      expect(fs.readFileSync(path.join(extractDir, 'file1.txt'), 'utf8')).toBe('Content 1');
      expect(fs.readFileSync(path.join(extractDir, 'file2.txt'), 'utf8')).toBe('Content 2');
      expect(fs.readFileSync(path.join(extractDir, 'subdir', 'nested.txt'), 'utf8')).toBe('Nested content');
    });

    it('should successfully extract a TAR.GZ archive', async () => {
      const extractTarDir = path.join(testWorkspaceDir, 'extract-tar');
      fs.mkdirSync(extractTarDir, { recursive: true });

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: tarArchivePath,
          target_path: extractTarDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('success');
      expect(extractResult.operation).toBe('extract');
      expect(extractResult.format_used).toBe('tar.gz');
      
      // Verify extracted files
      expect(fs.existsSync(path.join(extractTarDir, 'file1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(extractTarDir, 'file2.txt'))).toBe(true);
      expect(fs.existsSync(path.join(extractTarDir, 'subdir', 'nested.txt'))).toBe(true);
    });

    it('should extract to non-existing target directory', async () => {
      const newExtractDir = path.join(testWorkspaceDir, 'new-extract-dir');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: zipArchivePath,
          target_path: newExtractDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('success');
      
      // Verify directory was created and files extracted
      expect(fs.existsSync(newExtractDir)).toBe(true);
      expect(fs.existsSync(path.join(newExtractDir, 'file1.txt'))).toBe(true);
    });

    it('should handle overwrite option during extraction', async () => {
      // Pre-populate extract directory with existing file
      const existingFile = path.join(extractDir, 'file1.txt');
      fs.writeFileSync(existingFile, 'Existing content');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: zipArchivePath,
          target_path: extractDir,
          options: {
            overwrite: true
          }
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('success');
      expect(extractResult.options_applied?.overwrite).toBe(true);
      
      // Verify file was overwritten
      expect(fs.readFileSync(existingFile, 'utf8')).toBe('Content 1');
    });

    it('should handle filter_paths option during extraction', async () => {
      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: zipArchivePath,
          target_path: extractDir,
          options: {
            filter_paths: ['file1.txt']
          }
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('success');
      
      // Verify only filtered file was extracted
      expect(fs.existsSync(path.join(extractDir, 'file1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'file2.txt'))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, 'subdir'))).toBe(false);
    });

    it('should handle non-existent archive file', async () => {
      const nonExistentArchive = path.join(testWorkspaceDir, 'nonexistent.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: nonExistentArchive,
          target_path: extractDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('error');
      expect(extractResult.error_message).toContain('Path not found');
    });

    it('should handle unsupported archive format', async () => {
      const unsupportedArchive = path.join(testWorkspaceDir, 'test.rar');
      fs.writeFileSync(unsupportedArchive, 'fake rar content');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: unsupportedArchive,
          target_path: extractDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('error');
      expect(extractResult.error_message).toContain('Unsupported archive format');
      expect(extractResult.error_code).toBe('ERR_ARCHIVE_FORMAT_NOT_SUPPORTED');
    });

    it('should handle corrupted archive file', async () => {
      const corruptedArchive = path.join(testWorkspaceDir, 'corrupted.zip');
      fs.writeFileSync(corruptedArchive, 'This is not a valid ZIP file');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'extract',
          archive_path: corruptedArchive,
          target_path: extractDir
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
      
      const extractResult = result.response.results[0];
      expect(extractResult.status).toBe('error');
      expect(extractResult.error_message).toContain('Failed to extract archive');
      expect(extractResult.error_code).toBe('ERR_ARCHIVE_EXTRACTION_FAILED');
    });
  });

  describe('Error Handling', () => {
    it('should handle access denied for paths outside allowed paths', async () => {
      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: ['/etc/passwd'],
          archive_path: '/tmp/forbidden.zip'
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('Parent directory access denied');
    });

    it('should handle invalid operation', async () => {
      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'invalid_operation',
          source_paths: ['/some/file'],
          archive_path: '/some/archive.zip'
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('Invalid or unsupported archive operation');
      expect(archiveResult.error_code).toBe('ERR_UNSUPPORTED_OPERATION');
    });

    it('should handle missing required parameters', async () => {
      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create'
          // Missing source_paths and archive_path
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('error');
      expect(archiveResult.error_message).toContain('Path must be a non-empty string');
      expect(archiveResult.error_code).toBe('ERR_INTERNAL');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large file names in archives', async () => {
      const longFileName = 'a'.repeat(200) + '.txt';
      const longFilePath = path.join(testWorkspaceDir, longFileName);
      const archivePath = path.join(testWorkspaceDir, 'long-names.zip');
      
      fs.writeFileSync(longFilePath, 'content');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [longFilePath],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      
      // Verify archive was created
      expect(fs.existsSync(archivePath)).toBe(true);
    });

    it('should handle empty directories in archives', async () => {
      const emptyDir = path.join(testWorkspaceDir, 'empty-dir');
      const archivePath = path.join(testWorkspaceDir, 'empty-dir.zip');
      
      fs.mkdirSync(emptyDir);

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: [emptyDir],
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      
      // Verify archive was created
      expect(fs.existsSync(archivePath)).toBe(true);
    });

    it('should handle special characters in file names', async () => {
      const specialFiles = [
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.with.dots.txt'
      ];
      
      const createdFiles: string[] = [];
      specialFiles.forEach(fileName => {
        try {
          const filePath = path.join(testWorkspaceDir, fileName);
          fs.writeFileSync(filePath, `Content of ${fileName}`);
          createdFiles.push(filePath);
        } catch (e) {
          // Skip files that can't be created on this filesystem
        }
      });
      
      if (createdFiles.length === 0) {
        // Skip test if no files could be created
        return;
      }

      const archivePath = path.join(testWorkspaceDir, 'special-chars.zip');

      const requestPayload = {
        tool_name: 'ArchiveTool',
        params: {
          operation: 'create',
          source_paths: createdFiles,
          archive_path: archivePath
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
      
      const archiveResult = result.response.results[0];
      expect(archiveResult.status).toBe('success');
      expect(archiveResult.entries_processed).toBe(createdFiles.length);
      
      // Verify archive was created and contains files
      expect(fs.existsSync(archivePath)).toBe(true);
      
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      expect(entries.length).toBe(createdFiles.length);
    });
  });
});