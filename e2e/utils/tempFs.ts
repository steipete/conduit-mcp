import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const E2E_TEMP_BASE = path.resolve(__dirname, '../temp_data');

export function ensureTempBaseExists(): void {
  if (!fs.existsSync(E2E_TEMP_BASE)) {
    fs.mkdirSync(E2E_TEMP_BASE, { recursive: true });
  }
}

export function createTempDir(basePath?: string): string {
  ensureTempBaseExists();

  const tempDirBase = basePath || E2E_TEMP_BASE;
  const randomSuffix = randomBytes(8).toString('hex');
  const tempDirPath = path.join(tempDirBase, `temp_${randomSuffix}`);

  fs.mkdirSync(tempDirPath, { recursive: true });
  return tempDirPath;
}

export function createTempFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

export function createTempFileInBase(filename: string, content: string): string {
  ensureTempBaseExists();
  const filePath = path.join(E2E_TEMP_BASE, filename);
  createTempFile(filePath, content);
  return filePath;
}

export function cleanupTemp(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  // Safety check: only allow cleanup within E2E temp area
  const resolvedPath = path.resolve(targetPath);
  const resolvedBase = path.resolve(E2E_TEMP_BASE);

  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error(`Cleanup path ${resolvedPath} is outside E2E temp area ${resolvedBase}`);
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
}

export function cleanupAllTemp(): void {
  if (fs.existsSync(E2E_TEMP_BASE)) {
    fs.rmSync(E2E_TEMP_BASE, { recursive: true, force: true });
  }
}

export function getTempBasePath(): string {
  return E2E_TEMP_BASE;
}

export function readTempFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function tempFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
