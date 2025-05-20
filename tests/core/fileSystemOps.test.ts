import { vi } from 'vitest';
import * as fsOps from '@/core/fileSystemOps';
import { conduitConfig } from '@/core/configLoader';
import { getMimeType } from '@/core/mimeService';
import { ConduitError, ErrorCode } from '@/utils/errorHandler';
import logger from '@/utils/logger';
import fs from 'fs/promises';
import type { Stats, PathLike, Dirent } from 'fs'; // Import necessary types
import path from 'path';

// Mock logger
vi.mock('@/utils/logger');

// Mock fs/promises
vi.mock('fs/promises');
const mockFs = fs as unknown as import('vitest').Mocked<typeof fs>; 

// Mock mimeService
vi.mock('@/core/mimeService');
const mockGetMimeType = getMimeType as unknown as import('vitest').MockedFunction<typeof getMimeType>; 

// Mock configLoader.conduitConfig - adjust as needed for specific tests
const baseMockConfig = {
    maxFileReadBytes: 1024 * 1024, // 1MB for tests
    defaultChecksumAlgorithm: 'sha256',
    maxRecursiveDepth: 5,
    recursiveSizeTimeoutMs: 1000, // 1 second for tests
    // Fill in other required fields from ConduitServerConfig with defaults or test values
    logLevel: 'INFO',
    allowedPaths: ['/allowed'],
    httpTimeoutMs: 1000,
    maxPayloadSizeBytes: 1000,
    maxUrlDownloadBytes: 1000,
    imageCompressionThresholdBytes: 1000,
    imageCompressionQuality: 75,
    serverStartTimeIso: new Date().toISOString(),
    serverVersion: '1.0.0-test',
};
vi.mock('@/core/configLoader', () => ({
    get conduitConfig() { return baseMockConfig; }
}));


describe('fileSystemOps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetMimeType.mockResolvedValue('application/octet-stream'); // Default mock
    });

    describe('pathExists', () => {
        it('should return true if fs.access resolves', async () => {
            mockFs.access.mockResolvedValueOnce(undefined);
            await expect(fsOps.pathExists('/some/path')).resolves.toBe(true);
        });
        it('should return false if fs.access rejects', async () => {
            mockFs.access.mockRejectedValueOnce(new Error('ENOENT'));
            await expect(fsOps.pathExists('/some/path')).resolves.toBe(false);
        });
    });

    describe('getStats / getLstats', () => {
        const mockStatObject = { isFile: () => true, isDirectory: () => false, size: 100 } as Stats;
        it('getStats should return stats object on success', async () => {
            mockFs.stat.mockResolvedValueOnce(mockStatObject);
            await expect(fsOps.getStats('/file')).resolves.toEqual(mockStatObject);
        });
        it('getStats should throw ConduitError.ERR_FS_NOT_FOUND on ENOENT', async () => {
            mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
            await expect(fsOps.getStats('/notfound')).rejects.toThrow(ConduitError);
            try { await fsOps.getStats('/notfound'); } catch (e: any) { expect(e.errorCode).toBe(ErrorCode.ERR_FS_NOT_FOUND); }
        });
        it('getLstats should return stats object on success', async () => {
            mockFs.lstat.mockResolvedValueOnce(mockStatObject);
            await expect(fsOps.getLstats('/file')).resolves.toEqual(mockStatObject);
        });
    });

    describe('readFileAsString / readFileAsBuffer', () => {
        const mockFileContent = "Hello World";
        const mockFileBuffer = Buffer.from(mockFileContent);
        const mockStatObject = { size: mockFileBuffer.length } as Stats;

        beforeEach(() => {
            mockFs.stat.mockResolvedValue(mockStatObject);
            mockFs.readFile.mockResolvedValue(mockFileBuffer);
        });

        it('readFileAsString should return file content as string', async () => {
            await expect(fsOps.readFileAsString('/file.txt')).resolves.toBe(mockFileContent);
        });
        it('readFileAsBuffer should return file content as buffer', async () => {
            await expect(fsOps.readFileAsBuffer('/file.bin')).resolves.toEqual(mockFileBuffer);
        });
        it('should throw ERR_RESOURCE_LIMIT_EXCEEDED if file size is too large', async () => {
            mockFs.stat.mockResolvedValueOnce({ size: baseMockConfig.maxFileReadBytes + 1 } as Stats);
            await expect(fsOps.readFileAsString('/largefile')).rejects.toThrow(ConduitError);
            try { await fsOps.readFileAsString('/largefile'); } catch (e:any) { expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED); }
        });
    });

    describe('writeFile', () => {
        it('should write text content correctly', async () => {
            const content = "Test content";
            await fsOps.writeFile('/test.txt', content, 'text', 'overwrite');
            expect(mockFs.writeFile).toHaveBeenCalledWith('/test.txt', Buffer.from(content));
        });
        it('should write base64 content correctly', async () => {
            const base64Content = Buffer.from("Base64 data").toString('base64');
            await fsOps.writeFile('/test.b64', base64Content, 'base64');
            expect(mockFs.writeFile).toHaveBeenCalledWith('/test.b64', Buffer.from("Base64 data"));
        });
        it('should append content correctly', async () => {
            const content = "Append me";
            await fsOps.writeFile('/append.txt', content, 'text', 'append');
            expect(mockFs.appendFile).toHaveBeenCalledWith('/append.txt', Buffer.from(content));
        });
        it('should throw ERR_RESOURCE_LIMIT_EXCEEDED for large content', async () => {
            const largeContent = 'a'.repeat(baseMockConfig.maxFileReadBytes + 1);
            await expect(fsOps.writeFile('/large.txt', largeContent)).rejects.toThrow(ConduitError);
            try { await fsOps.writeFile('/large.txt', largeContent); } catch (e:any) { expect(e.errorCode).toBe(ErrorCode.ERR_RESOURCE_LIMIT_EXCEEDED); }
        });
    });

    describe('createDirectory', () => {
        it('should call fs.mkdir with recursive false by default', async () => {
            await fsOps.createDirectory('/newdir');
            expect(mockFs.mkdir).toHaveBeenCalledWith('/newdir', { recursive: false });
        });
        it('should call fs.mkdir with recursive true if specified', async () => {
            await fsOps.createDirectory('/newdir/deep', true);
            expect(mockFs.mkdir).toHaveBeenCalledWith('/newdir/deep', { recursive: true });
        });
        it('should be idempotent if directory exists (EEXIST)', async () => {
            mockFs.mkdir.mockRejectedValueOnce({ code: 'EEXIST' });
            await expect(fsOps.createDirectory('/existing')).resolves.toBeUndefined();
        });
    });

    describe('deletePath', () => {
        it('should call fs.unlink for files', async () => {
            mockFs.lstat.mockResolvedValueOnce({ isDirectory: () => false } as Stats);
            await fsOps.deletePath('/file.txt');
            expect(mockFs.unlink).toHaveBeenCalledWith('/file.txt');
        });
        it('should call fs.rm for directories', async () => {
            mockFs.lstat.mockResolvedValueOnce({ isDirectory: () => true } as Stats);
            await fsOps.deletePath('/dir', true);
            expect(mockFs.rm).toHaveBeenCalledWith('/dir', { recursive: true, force: true });
        });
        it('should be idempotent if path does not exist (ENOENT)', async () => {
            mockFs.lstat.mockRejectedValueOnce({ code: 'ENOENT' });
            await expect(fsOps.deletePath('/nonexistent')).resolves.toBeUndefined();
        });
    });

    describe('listDirectory', () => {
        it('should return list of entry names', async () => {
            mockFs.readdir.mockResolvedValueOnce(['file1.txt', 'subdir'] as any);
            await expect(fsOps.listDirectory('/somedir')).resolves.toEqual(['file1.txt', 'subdir']);
        });
        it('should throw ERR_FS_NOT_FOUND if directory not found', async () => {
            mockFs.readdir.mockRejectedValueOnce({code: 'ENOENT'});
            await expect(fsOps.listDirectory('/notfound')).rejects.toThrow(ConduitError);
        });
        it('should throw ERR_FS_IS_FILE if path is a file', async () => {
            mockFs.readdir.mockRejectedValueOnce({code: 'ENOTDIR'});
            await expect(fsOps.listDirectory('/isAFile')).rejects.toThrow(ConduitError);
        });
    });

    describe('createEntryInfo', () => {
        const mockStats = {
            name: 'testfile.txt',
            size: 123,
            birthtime: new Date(Date.UTC(2023,0,1,10,0,0)),
            mtime: new Date(Date.UTC(2023,0,1,11,0,0)),
            mode: 0o100644, // typical file permission
            isDirectory: () => false,
            isFile: () => true,
        } as unknown as Stats; // Cast needed as we are not mocking all Stats fields

        it('should populate EntryInfo correctly for a file', async () => {
            mockGetMimeType.mockResolvedValueOnce('text/plain');
            const entry = await fsOps.createEntryInfo('/allowed/testfile.txt', mockStats);
            expect(entry.name).toBe('testfile.txt');
            expect(entry.path).toBe('/allowed/testfile.txt');
            expect(entry.type).toBe('file');
            expect(entry.size_bytes).toBe(123);
            expect(entry.mime_type).toBe('text/plain');
            expect(entry.created_at_iso).toBe('2023-01-01T10:00:00.000Z');
            expect(entry.modified_at_iso).toBe('2023-01-01T11:00:00.000Z');
            expect(entry.permissions_octal).toBe('0644');
            expect(entry.permissions_string).toBe('rw-r--r--');
        });
    });
    
    describe('calculateRecursiveDirectorySize', () => {
        // Mock fs.readdir to return Dirent objects
        const mockFileDirent = (name: string) => ({ name, isFile: () => true, isDirectory: () => false } as Dirent);
        const mockDirDirent = (name: string) => ({ name, isFile: () => false, isDirectory: () => true } as Dirent);

        beforeEach(() => {
            // Reset readdir mock for each test as it can be complex
            mockFs.readdir.mockReset();
            mockFs.stat.mockReset(); // also stat for file sizes
        });

        it('should sum file sizes in a flat directory', async () => {
            mockFs.readdir.mockResolvedValueOnce([mockFileDirent('file1.txt'), mockFileDirent('file2.txt')] as any);
            mockFs.stat.mockResolvedValueOnce({ size: 100 } as Stats).mockResolvedValueOnce({ size: 200 } as Stats);
            
            const { size, note } = await fsOps.calculateRecursiveDirectorySize('/flatdir', 0, 1, 1000, Date.now());
            expect(size).toBe(300);
            expect(note).toBeUndefined();
        });

        it('should recurse into subdirectories within maxDepth', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([mockFileDirent('rootfile.txt'), mockDirDirent('subdir')] as any) // /root
                .mockResolvedValueOnce([mockFileDirent('subfile.txt')] as any); // /root/subdir
            mockFs.stat
                .mockResolvedValueOnce({ size: 50 } as Stats) // rootfile.txt
                .mockResolvedValueOnce({ size: 150 } as Stats); // subfile.txt

            const { size, note } = await fsOps.calculateRecursiveDirectorySize('/root', 0, 1, 1000, Date.now());
            expect(size).toBe(200);
            expect(note).toBeUndefined();
        });

        it('should respect maxDepth and return partial size note', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([mockDirDirent('subdir1')] as any) // /root, depth 0
                .mockResolvedValueOnce([mockDirDirent('subdir2')] as any) // /root/subdir1, depth 1 (maxDepth for this test)
                .mockResolvedValueOnce([mockFileDirent('deepfile.txt')] as any); // /root/subdir1/subdir2 (should not be reached)
            // No stat calls should happen for deepfile.txt
            
            const { size, note } = await fsOps.calculateRecursiveDirectorySize('/root', 0, 1, 1000, Date.now());
            expect(size).toBe(0); // Only summed sizes from allowed depth
            expect(note).toBe('Partial size: depth limit reached');
            expect(mockFs.stat).not.toHaveBeenCalled(); // As no files were at allowed depth
        });

        it('should respect timeout and return timeout note', async () => {
            mockFs.readdir.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulate long read
                return [mockFileDirent('file.txt')] as any;
            });
            mockFs.stat.mockResolvedValue({ size: 10 } as Stats);
            
            // Config timeout is 1000ms, but test timeout for this specific test might be shorter
            const { size, note } = await fsOps.calculateRecursiveDirectorySize('/timeoutdir', 0, 5, 100 /* short timeout */, Date.now());
            expect(size).toBe(0); // Or whatever was calculated before timeout
            expect(note).toBe('Calculation timed out due to server limit');
        });
    });
}); 