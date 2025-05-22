import logger from '@/utils/logger';

// file-type is an ES module, so we need to use dynamic import in a CommonJS environment.
let fileTypeFromFile:
  | ((filePath: string) => Promise<{ readonly ext: string; readonly mime: string } | undefined>)
  | undefined;

async function loadFileTypeModule() {
  if (!fileTypeFromFile) {
    try {
      const module = await import('file-type');
      fileTypeFromFile = module.fileTypeFromFile;
    } catch (err) {
      logger.error('Failed to load file-type module dynamically', err);
      fileTypeFromFile = async () => undefined; // Fallback to prevent further errors
    }
  }
  return fileTypeFromFile;
}

/**
 * Detects the MIME type of a local file using magic numbers.
 * @param filePath The absolute path to the file.
 * @returns The detected MIME type string (e.g., "image/jpeg") or undefined if not determinable or error.
 */
export async function getMimeType(filePath: string): Promise<string | undefined> {
  const importer = await loadFileTypeModule();
  if (!importer) {
    return undefined;
  }
  try {
    const type = await importer(filePath);
    return type?.mime;
  } catch (error: unknown) {
    // file-type can sometimes throw if it encounters issues (e.g. permissions, though less likely for just reading header)
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not determine MIME type for ${filePath} using file-type: ${message}`);
    return undefined;
  }
}
