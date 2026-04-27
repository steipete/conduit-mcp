import { vi } from "vitest";
import type { Stats } from "fs";

// This data store will be manipulated by archiveOps.test.ts
export const mockFsDataForManualMock: {
  [key: string]: { type: "file" | "dir"; content?: string; error?: NodeJS.ErrnoException };
} = {};

export const clearCustomMockFsData = () => {
  for (const key in mockFsDataForManualMock) {
    delete mockFsDataForManualMock[key];
  }
  // Reset all mock function states
  stat.mockClear();
  lstat.mockClear();
  access.mockClear();
  readFile.mockClear();
  writeFile.mockClear();
  appendFile.mockClear();
  mkdir.mockClear();
  rm.mockClear();
  rmdir.mockClear();
  unlink.mockClear();
  readdir.mockClear();
  cp.mockClear();
  rename.mockClear();
  utimes.mockClear();
};

const createErrnoError = (code: string, path: string, syscall: string): NodeJS.ErrnoException => {
  const err = new Error(
    `${code}: no such file or directory, ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = code;
  err.path = path;
  err.syscall = syscall;
  return err;
};

export const stat = vi.fn(async (pathKey: string): Promise<Stats> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (entry?.error) throw entry.error;
  if (entry) {
    if (entry.type === "file") {
      return {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: entry.content?.length ?? 0,
        mtimeMs: Date.now(),
        atimeMs: Date.now(),
        birthtimeMs: Date.now(),
      } as unknown as Stats;
    } else if (entry.type === "dir") {
      return {
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
        size: 4096,
        mtimeMs: Date.now(),
        atimeMs: Date.now(),
        birthtimeMs: Date.now(),
      } as unknown as Stats;
    }
  }
  throw createErrnoError("ENOENT", pathKey as string, "stat");
});

export const lstat = vi.fn(async (pathKey: string): Promise<Stats> => stat(pathKey)); // Simple alias for now

export const access = vi.fn(async (pathKey: string): Promise<void> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (entry?.error) throw entry.error;
  if (!entry) {
    throw createErrnoError("ENOENT", pathKey as string, "access");
  }
});

export const readFile = vi.fn(async (pathKey: string, options?: any): Promise<string | Buffer> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (entry?.error) throw entry.error;
  if (entry && entry.type === "file") {
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding === "buffer" ? Buffer.from(entry.content ?? "") : (entry.content ?? "");
  }
  throw createErrnoError("ENOENT", pathKey as string, "open");
});

export const writeFile = vi.fn(async (pathKey: string, data: string | Buffer): Promise<void> => {
  mockFsDataForManualMock[pathKey as string] = { type: "file", content: data.toString() };
});

export const appendFile = vi.fn(async (pathKey: string, data: string | Buffer): Promise<void> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (entry && entry.type === "file") {
    entry.content += data.toString();
  } else {
    mockFsDataForManualMock[pathKey as string] = { type: "file", content: data.toString() };
  }
});

export const mkdir = vi.fn(
  async (pathKey: string, options?: { recursive?: boolean }): Promise<string | undefined> => {
    // Basic implementation: just creates the entry if it doesn't exist.
    // Does not truly handle recursive for nested paths not already in mockFsDataForManualMock.
    // Assumes parent directories are either present or options.recursive handles it (which we simplify here).
    if (!mockFsDataForManualMock[pathKey as string]) {
      mockFsDataForManualMock[pathKey as string] = { type: "dir" };
    } else if (mockFsDataForManualMock[pathKey as string].type !== "dir") {
      throw createErrnoError("EEXIST", pathKey as string, "mkdir");
    }
    return options?.recursive ? (pathKey as string) : undefined; // Behavior can vary
  },
);

export const rm = vi.fn(
  async (pathKey: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> => {
    const entry = mockFsDataForManualMock[pathKey as string];
    if (!entry && !options?.force) {
      throw createErrnoError("ENOENT", pathKey as string, "rm");
    }
    if (entry) {
      if (entry.type === "dir" && !options?.recursive && !options?.force) {
        // Check if directory is empty by seeing if any other keys start with this path + path.sep
        // This is a simplification; a real fs.rm would check actual children.
        const children = Object.keys(mockFsDataForManualMock).filter(
          (k) => k.startsWith(pathKey + "/") && k !== pathKey,
        );
        if (children.length > 0) {
          throw createErrnoError("ENOTEMPTY", pathKey as string, "rmdir");
        }
      }
      delete mockFsDataForManualMock[pathKey as string];
      if (options?.recursive && entry.type === "dir") {
        Object.keys(mockFsDataForManualMock).forEach((k) => {
          if (k.startsWith(pathKey + "/")) {
            delete mockFsDataForManualMock[k];
          }
        });
      }
    }
  },
);

export const rmdir = vi.fn(async (pathKey: string): Promise<void> => {
  await rm(pathKey, { recursive: false }); // rmdir is not recursive by default
});
export const unlink = vi.fn(async (pathKey: string): Promise<void> => rm(pathKey)); // unlink is for files/symlinks

export const readdir = vi.fn(async (pathKey: string): Promise<string[]> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (entry?.error) throw entry.error;
  if (entry && entry.type === "dir") {
    const dirPath = pathKey.endsWith("/") ? pathKey : pathKey + "/";
    const children = new Set<string>();
    Object.keys(mockFsDataForManualMock).forEach((k) => {
      if (k.startsWith(dirPath)) {
        const relativePath = k.substring(dirPath.length);
        if (relativePath && !relativePath.includes("/")) {
          children.add(relativePath);
        }
      }
    });
    return Array.from(children);
  }
  throw createErrnoError("ENOENT", pathKey as string, "scandir");
});

export const cp = vi.fn(
  async (srcKey: string, destKey: string, options?: { recursive?: boolean }): Promise<void> => {
    const srcEntry = mockFsDataForManualMock[srcKey as string];
    if (!srcEntry) throw createErrnoError("ENOENT", srcKey as string, "cp");

    if (srcEntry.type === "file") {
      mockFsDataForManualMock[destKey as string] = { ...srcEntry };
    } else if (srcEntry.type === "dir") {
      if (options?.recursive) {
        mockFsDataForManualMock[destKey as string] = { type: "dir" };
        Object.keys(mockFsDataForManualMock).forEach((k) => {
          if (k.startsWith(srcKey + "/")) {
            const relativePath = k.substring(srcKey.length);
            mockFsDataForManualMock[destKey + relativePath] = { ...mockFsDataForManualMock[k] };
          }
        });
      } else {
        // Copying a directory without recursive might be an error or no-op depending on flags/OS
        // For simplicity, let's assume it's an error if not recursive and trying to copy a dir to a new location
        throw createErrnoError("EISDIR", srcKey as string, "cp");
      }
    }
  },
);

export const rename = vi.fn(async (oldPathKey: string, newPathKey: string): Promise<void> => {
  const entry = mockFsDataForManualMock[oldPathKey as string];
  if (!entry) throw createErrnoError("ENOENT", oldPathKey as string, "rename");
  mockFsDataForManualMock[newPathKey as string] = entry;
  delete mockFsDataForManualMock[oldPathKey as string];
  // If renaming a directory, also need to update paths of all children
  if (entry.type === "dir") {
    Object.keys(mockFsDataForManualMock).forEach((k) => {
      if (k.startsWith(oldPathKey + "/")) {
        const relativePath = k.substring(oldPathKey.length);
        mockFsDataForManualMock[newPathKey + relativePath] = mockFsDataForManualMock[k];
        delete mockFsDataForManualMock[k];
      }
    });
  }
});

export const utimes = vi.fn(async (pathKey: string, _atime: any, _mtime: any): Promise<void> => {
  const entry = mockFsDataForManualMock[pathKey as string];
  if (!entry) throw createErrnoError("ENOENT", pathKey as string, "utimes");
  // In a real scenario, you'd update timestamps. Here, it's a no-op for simplicity.
});

// Default export for `import fs from 'fs/promises'`
export default {
  stat,
  lstat,
  access,
  readFile,
  writeFile,
  appendFile,
  mkdir,
  rm,
  rmdir,
  unlink,
  readdir,
  cp,
  rename,
  utimes,
  // Expose data store for manipulation if needed, though direct manipulation is primary
  _data: mockFsDataForManualMock,
};
