import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Creates a unique temporary directory for testing.
 * @returns {Promise<string>} The path to the created temporary directory.
 */
export async function createTemporaryDirectory(): Promise<string> {
  const tempDirParent = os.tmpdir();
  const tempDir = await fs.mkdtemp(path.join(tempDirParent, 'conduit-mcp-test-'));
  return tempDir;
}

/**
 * Cleans up (removes) a temporary directory.
 * @param {string} directoryPath The path to the directory to remove.
 * @returns {Promise<void>}
 */
export async function cleanupTemporaryDirectory(directoryPath: string): Promise<void> {
  try {
    await fs.rm(directoryPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup temporary directory ${directoryPath}:`, error);
    // Depending on strictness, you might want to re-throw or handle more gracefully
  }
} 