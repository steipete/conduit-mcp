import * as path from 'path';
import {
  ConduitServerConfig,
  EntryInfo,
  ErrorCode,
  FindTool,
  fileSystemOps,
  ConduitError,
  getMimeType,
} from '@/internal';
import micromatch from 'micromatch';
import { logger } from '@/internal';

async function isTextBasedFileForContentSearch(
  filePath: string,
  fileTypesToSearch?: string[]
): Promise<boolean> {
  if (fileTypesToSearch && fileTypesToSearch.length > 0) {
    const ext = path.extname(filePath).toLowerCase();
    if (fileTypesToSearch.map((ft) => ft.toLowerCase()).includes(ext)) {
      const mime = await getMimeType(filePath);
      return mime
        ? mime.startsWith('text/') ||
            mime.includes('json') ||
            mime.includes('xml') ||
            mime.includes('script')
        : true;
    }
    return false;
  }
  const mime = await getMimeType(filePath);
  if (!mime) return false;
  return (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('application/x-sh') ||
    mime.includes('application/csv')
  );
}

async function matchesContentPattern(
  filePath: string,
  criterion: FindTool.ContentPatternCriterion,
  config: ConduitServerConfig
): Promise<boolean> {
  const operationLogger = logger.child({ component: 'findOps' });
  if (!(await isTextBasedFileForContentSearch(filePath, criterion.file_types_to_search))) {
    return false;
  }
  try {
    const buffer = await fileSystemOps.readFileAsBuffer(filePath, config.maxFileReadBytesFind);
    const content = buffer.toString('utf-8');
    const pattern = criterion.pattern;
    if (criterion.is_regex) {
      const regex = new RegExp(pattern, criterion.case_sensitive === false ? 'i' : '');
      return regex.test(content);
    } else {
      if (criterion.case_sensitive === false) {
        return content.toLowerCase().includes(pattern.toLowerCase());
      }
      return content.includes(pattern);
    }
  } catch (err: unknown) {
    if (err instanceof ConduitError && err.errorCode === ErrorCode.RESOURCE_LIMIT_EXCEEDED) {
      operationLogger.warn(
        `Content search for ${filePath} skipped: file exceeds max size (${config.maxFileReadBytesFind} bytes).`
      );
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      operationLogger.error(`Error reading file for content search ${filePath}: ${errorMessage}`);
    }
    return false;
  }
}

function matchesMetadataFilter(
  entryInfo: EntryInfo,
  criterion: FindTool.MetadataFilterCriterion
): boolean {
  const operationLogger = logger.child({ component: 'findOps' });
  const attributeName = criterion.attribute === 'entry_type' ? 'type' : criterion.attribute;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic attribute access for metadata filtering
  const attributeValue = (entryInfo as any)[attributeName];

  if (
    attributeValue === undefined &&
    attributeName !== 'mime_type' &&
    attributeName !== 'size_bytes'
  ) {
    operationLogger.warn(
      `Metadata attribute ${criterion.attribute} (resolved to ${attributeName}) not found or undefined on entry ${entryInfo.path}`
    );
    return false;
  }

  const val = criterion.value;
  const op = criterion.operator;

  switch (criterion.attribute) {
    case 'name':
    case 'entry_type':
    case 'mime_type': {
      const strAttr = String(attributeValue ?? '');
      const strVal = String(val);
      const caseSensitive = criterion.case_sensitive === true; // undefined or false means case-insensitive

      switch (op) {
        case 'equals':
          return caseSensitive
            ? strAttr === strVal
            : strAttr.toLowerCase() === strVal.toLowerCase();
        case 'not_equals':
          return caseSensitive
            ? strAttr !== strVal
            : strAttr.toLowerCase() !== strVal.toLowerCase();
        case 'contains':
          return caseSensitive
            ? strAttr.includes(strVal)
            : strAttr.toLowerCase().includes(strVal.toLowerCase());
        case 'starts_with':
          return caseSensitive
            ? strAttr.startsWith(strVal)
            : strAttr.toLowerCase().startsWith(strVal.toLowerCase());
        case 'ends_with':
          return caseSensitive
            ? strAttr.endsWith(strVal)
            : strAttr.toLowerCase().endsWith(strVal.toLowerCase());
        case 'matches_regex':
          try {
            return new RegExp(strVal).test(strAttr);
          } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            operationLogger.warn(`Invalid regex '${strVal}' in metadata filter: ${errorMessage}`);
            return false;
          }
        default:
          operationLogger.warn(`Unsupported string operator: ${op}`);
          return false;
      }
    }
    case 'size_bytes': {
      const numAttr = Number(attributeValue);
      const numVal = Number(val);
      if (isNaN(numAttr) || isNaN(numVal)) {
        // size_bytes can be undefined for dirs if not calculated
        if (op === 'eq' && val === null && attributeValue === undefined) return true; // Special case: check if size is undefined
        if (op === 'neq' && val === null && attributeValue !== undefined) return true;
        operationLogger.warn(`Invalid number comparison: ${attributeValue} vs ${val}`);
        return false;
      }
      switch (op) {
        case 'eq':
          return numAttr === numVal;
        case 'neq':
          return numAttr !== numVal;
        case 'gt':
          return numAttr > numVal;
        case 'gte':
          return numAttr >= numVal;
        case 'lt':
          return numAttr < numVal;
        case 'lte':
          return numAttr <= numVal;
        default:
          operationLogger.warn(`Unsupported numeric operator: ${op}`);
          return false;
      }
    }
    case 'created_at':
    case 'modified_at': {
      try {
        if (!attributeValue) return false; // Date cannot be undefined for these checks
        const dateAttr = new Date(attributeValue as string).getTime();
        if (isNaN(dateAttr)) return false;

        if (op === 'on_date') {
          const dateValStart = new Date(val as string);
          dateValStart.setUTCHours(0, 0, 0, 0);
          const dateValEnd = new Date(val as string);
          dateValEnd.setUTCHours(23, 59, 59, 999);
          return dateAttr >= dateValStart.getTime() && dateAttr <= dateValEnd.getTime();
        }
        const dateVal = new Date(val as string).getTime();
        if (isNaN(dateVal)) return false;
        switch (op) {
          case 'before':
            return dateAttr < dateVal;
          case 'after':
            return dateAttr > dateVal;
          default:
            operationLogger.warn(`Unsupported date operator: ${op}`);
            return false;
        }
      } catch (e) {
        operationLogger.error(
          `Error parsing dates for metadata filter: ${attributeValue}, ${val}`,
          e
        );
        return false;
      }
    }
    default:
      operationLogger.warn(`Unsupported metadata attribute: ${criterion.attribute}`);
      return false;
  }
}

function matchesNamePattern(entryName: string, pattern: string): boolean {
  return micromatch.isMatch(entryName, pattern, { dot: true }); // {dot: true} to match hidden files by default like shell glob
}

async function checkAllCriteria(
  entryInfo: EntryInfo,
  criteria: FindTool.MatchCriterion[],
  config: ConduitServerConfig
): Promise<boolean> {
  const operationLogger = logger.child({ component: 'findOps' });
  for (const criterion of criteria) {
    let match = false;
    switch (criterion.type) {
      case 'name_pattern':
        match = matchesNamePattern(entryInfo.name, criterion.pattern);
        break;
      case 'content_pattern':
        if (entryInfo.type === 'file') {
          match = await matchesContentPattern(entryInfo.path, criterion, config);
        } else {
          match = false;
        }
        break;
      case 'metadata_filter':
        match = matchesMetadataFilter(entryInfo, criterion);
        break;
      default: {
        const _exhaustiveCheck: never = criterion;
        operationLogger.warn(
          `Unknown match criterion type encountered: ${JSON.stringify(_exhaustiveCheck)}`
        );
        return false;
      }
    }
    if (!match) return false;
  }
  return true;
}

export async function findEntriesRecursive(
  currentPath: string,
  params: FindTool.Parameters,
  config: ConduitServerConfig,
  currentDepth: number,
  processedPaths: Set<string>
): Promise<EntryInfo[]> {
  const operationLogger = logger.child({ component: 'findOps' });
  const foundEntries: EntryInfo[] = [];
  if (processedPaths.has(currentPath)) {
    return foundEntries;
  }
  processedPaths.add(currentPath);

  const maxDepth =
    params.recursive === false
      ? 0
      : config.maxRecursiveDepth === -1
        ? Infinity
        : config.maxRecursiveDepth;
  if (currentDepth > maxDepth) {
    return foundEntries;
  }

  let dirContents: string[];
  try {
    dirContents = await fileSystemOps.listDirectory(currentPath);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    operationLogger.error(`Error listing directory for find: ${currentPath}, ${errorMessage}`);
    return foundEntries;
  }

  for (const entryName of dirContents) {
    const entryAbsolutePath = path.join(currentPath, entryName);
    if (processedPaths.has(entryAbsolutePath)) continue;

    try {
      const stats = await fileSystemOps.getLstats(entryAbsolutePath);
      const entryInfo = await fileSystemOps.createEntryInfo(entryAbsolutePath, stats, entryName);

      let matchesCurrentEntry = true;
      if (params.entry_type_filter && params.entry_type_filter !== 'any') {
        if (entryInfo.type !== params.entry_type_filter) {
          matchesCurrentEntry = false;
        }
      }

      if (
        matchesCurrentEntry &&
        (await checkAllCriteria(entryInfo, params.match_criteria, config))
      ) {
        foundEntries.push(entryInfo);
      }

      if (stats.isDirectory() && params.recursive !== false && currentDepth < maxDepth) {
        foundEntries.push(
          ...(await findEntriesRecursive(
            entryAbsolutePath,
            params,
            config,
            currentDepth + 1,
            processedPaths
          ))
        );
      }
    } catch (statError: unknown) {
      const errorMessage = statError instanceof Error ? statError.message : String(statError);
      operationLogger.warn(
        `Could not stat or process entry during find ${entryAbsolutePath}: ${errorMessage}. Skipping.`
      );
    }
  }
  return foundEntries;
}

export async function handleFindEntries(
  params: FindTool.Parameters,
  config: ConduitServerConfig
): Promise<EntryInfo[]> {
  const result = await findEntries(params, config);
  if (result instanceof ConduitError) {
    throw result;
  }
  return result;
}

export async function findEntries(
  params: FindTool.Parameters,
  config: ConduitServerConfig
): Promise<EntryInfo[] | ConduitError> {
  const operationLogger = logger.child({ component: 'findOps' });
  operationLogger.info(
    `Processing findEntries in base_path: ${params.base_path} with criteria: ${JSON.stringify(params.match_criteria)}`
  );

  // params.base_path should already be validated and resolved by the tool handler
  const absoluteBasePath = params.base_path;

  if (!(await fileSystemOps.pathExists(absoluteBasePath))) {
    return new ConduitError(
      ErrorCode.ERR_FS_NOT_FOUND,
      `Base path for find not found: ${params.base_path}`
    );
  }
  const baseStats = await fileSystemOps.getStats(absoluteBasePath);

  if (!baseStats.isDirectory()) {
    if (params.recursive === false || params.recursive === undefined) {
      try {
        const entryInfo = await fileSystemOps.createEntryInfo(
          absoluteBasePath,
          baseStats,
          path.basename(absoluteBasePath)
        );
        if (
          params.entry_type_filter &&
          params.entry_type_filter !== 'any' &&
          entryInfo.type !== params.entry_type_filter
        ) {
          return [];
        }
        if (await checkAllCriteria(entryInfo, params.match_criteria, config)) {
          return [entryInfo];
        }
        return [];
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        return new ConduitError(
          ErrorCode.OPERATION_FAILED,
          `Failed to process base_path file ${params.base_path}: ${errorMessage}`
        );
      }
    } else {
      return [];
    }
  }

  try {
    const processedPaths = new Set<string>();
    if (params.recursive === false) {
      const results: EntryInfo[] = [];
      const dirContentsNames = await fileSystemOps.listDirectory(absoluteBasePath);
      processedPaths.add(absoluteBasePath);

      for (const name of dirContentsNames) {
        const entryPath = path.join(absoluteBasePath, name);
        if (processedPaths.has(entryPath)) continue;

        try {
          const stats = await fileSystemOps.getLstats(entryPath);
          const entryInfoBase = await fileSystemOps.createEntryInfo(entryPath, stats, name);
          if (params.entry_type_filter && params.entry_type_filter !== 'any') {
            if (entryInfoBase.type !== params.entry_type_filter) {
              continue;
            }
          }
          if (await checkAllCriteria(entryInfoBase, params.match_criteria, config)) {
            results.push(entryInfoBase);
          }
        } catch (statError: unknown) {
          const errorMessage = statError instanceof Error ? statError.message : String(statError);
          operationLogger.warn(
            `Could not stat or process entry ${entryPath} in non-recursive find: ${errorMessage}. Skipping.`
          );
        }
      }
      return results;
    } else {
      const allFound = await findEntriesRecursive(
        absoluteBasePath,
        params,
        config,
        0,
        processedPaths
      );
      return Array.from(new Map(allFound.map((e) => [e.path, e])).values());
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    operationLogger.error(`Failed to find entries for ${params.base_path}: ${errorMessage}`);
    if (error instanceof ConduitError) return error;
    return new ConduitError(
      ErrorCode.ERR_INTERNAL_SERVER_ERROR,
      `An unexpected error occurred during find: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
