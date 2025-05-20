import { FindTool } from '@/types/tools';
import { EntryInfo } from '@/types/common';
import * as fsOps from '@/core/fileSystemOps';
import { conduitConfig } from '@/core/configLoader';
import logger from '@/utils/logger';
import { minimatch } from 'minimatch'; // For glob pattern matching
import path from 'path';

// Helper function to check if a value matches a string criterion
function matchesStringCriterion(
  value: string | undefined,
  operator: FindTool.StringOperator | string,
  criterionValue: string,
  caseSensitive: boolean = false
): boolean {
  if (value === undefined) return false;
  const val = caseSensitive ? value : value.toLowerCase();
  const critVal = caseSensitive ? criterionValue : criterionValue.toLowerCase();

  switch (operator) {
    case 'equals': return val === critVal;
    case 'not_equals': return val !== critVal;
    case 'contains': return val.includes(critVal);
    case 'starts_with': return val.startsWith(critVal);
    case 'ends_with': return val.endsWith(critVal);
    case 'matches_regex':
      try {
        const regex = new RegExp(criterionValue, caseSensitive ? '' : 'i');
        return regex.test(value); // Use original value for regex test if case is handled by flag
      } catch (e) {
        logger.warn(`Invalid regex in find criteria: ${criterionValue}`, e);
        return false;
      }
    default: return false;
  }
}

// Helper function to check if a value matches a numeric criterion
function matchesNumericCriterion(
  value: number | undefined,
  operator: FindTool.NumericOperator | string,
  criterionValue: number
): boolean {
  if (value === undefined) return false;
  switch (operator) {
    case 'eq': return value === criterionValue;
    case 'neq': return value !== criterionValue;
    case 'gt': return value > criterionValue;
    case 'gte': return value >= criterionValue;
    case 'lt': return value < criterionValue;
    case 'lte': return value <= criterionValue;
    default: return false;
  }
}

// Helper function to check if a value matches a date criterion
function matchesDateCriterion(
  valueISO: string | undefined, // ISO 8601 string
  operator: FindTool.DateOperator | string,
  criterionValueISO: string // ISO 8601 string for before/after, YYYY-MM-DD for on_date
): boolean {
  if (valueISO === undefined) return false;
  try {
    const valueDate = new Date(valueISO);
    if (operator === 'on_date') {
      const critDate = new Date(criterionValueISO + 'T00:00:00.000Z'); // Ensure it's treated as UTC start of day
      // Compare YYYY-MM-DD part only
      return valueDate.toISOString().slice(0, 10) === critDate.toISOString().slice(0, 10);
    }
    const critDate = new Date(criterionValueISO);
    switch (operator) {
      case 'before': return valueDate < critDate;
      case 'after': return valueDate > critDate;
      default: return false;
    }
  } catch (e) {
    logger.warn(`Invalid date format in find criteria: ${valueISO} or ${criterionValueISO}`, e);
    return false;
  }
}

async function entryMatchesAllCriteria(entryInfo: EntryInfo, criteria: FindTool.MatchCriterion[]): Promise<boolean> {
  for (const criterion of criteria) {
    let match = false;
    switch (criterion.type) {
      case 'name_pattern':
        match = minimatch(entryInfo.name, criterion.pattern, { nocase: !conduitConfig.allowedPaths.some(p => p.startsWith('/mnt')) /* simple heuristic for case-insensitivity on non-Linux-like paths */ });
        break;
      case 'content_pattern':
        if (entryInfo.type === 'file') {
          if (criterion.file_types_to_search && criterion.file_types_to_search.length > 0) {
            const ext = path.extname(entryInfo.name).toLowerCase();
            if (!criterion.file_types_to_search.includes(ext)) {
              match = false; // Skip if file type not in the list
              break;
            }
          }
          // Default to skip binary unless specific text-based MIME is known
          let isTextSearchable = entryInfo.mime_type?.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript', 'application/svg+xml'].includes(entryInfo.mime_type || '');
          if (!isTextSearchable && criterion.file_types_to_search === undefined) {
            // If file_types_to_search is not specified, we only search known text types.
            // If it *is* specified, we trust the user wanted to search those types, but still avoid full binary reads if possible.
            // This part might need refinement based on how strictly to avoid reading binary files.
             logger.debug(`Skipping content search for presumed binary file ${entryInfo.path} (MIME: ${entryInfo.mime_type}) unless file_types_to_search is used.`);
             match = false;
             break;
          }

          try {
            const content = await fsOps.readFileAsString(entryInfo.path, conduitConfig.maxFileReadBytes); // Respect read limits
            if (criterion.is_regex) {
              const regex = new RegExp(criterion.pattern, criterion.case_sensitive === false ? 'i' : '');
              match = regex.test(content);
            } else {
              match = criterion.case_sensitive ? content.includes(criterion.pattern) : content.toLowerCase().includes(criterion.pattern.toLowerCase());
            }
          } catch (e: any) {
            logger.warn(`Could not read/search content of ${entryInfo.path}: ${e.message}`);
            match = false;
          }
        }
        break;
      case 'metadata_filter':
        const attr = criterion.attribute as FindTool.MetadataAttribute;
        switch (attr) {
          case 'name': match = matchesStringCriterion(entryInfo.name, criterion.operator, criterion.value, criterion.case_sensitive); break;
          case 'size_bytes': match = matchesNumericCriterion(entryInfo.size_bytes, criterion.operator, Number(criterion.value)); break;
          case 'created_at_iso': match = matchesDateCriterion(entryInfo.created_at_iso, criterion.operator, criterion.value); break;
          case 'modified_at_iso': match = matchesDateCriterion(entryInfo.modified_at_iso, criterion.operator, criterion.value); break;
          case 'entry_type': match = matchesStringCriterion(entryInfo.type, criterion.operator, criterion.value, true); break; // entry_type is always 'file' or 'directory'
          case 'mime_type': match = matchesStringCriterion(entryInfo.mime_type, criterion.operator, criterion.value, criterion.case_sensitive); break;
          default: match = false;
        }
        break;
      default: // Should not happen with proper typing
        match = false;
    }
    if (!match) return false; // If any criterion doesn't match, the entry is out
  }
  return true; // All criteria matched
}

export async function findEntriesRecursive(
  currentPath: string,
  criteria: FindTool.MatchCriterion[],
  entryTypeFilter: 'file' | 'directory' | 'any',
  recursive: boolean,
  currentDepth: number,
  maxDepth: number,
  results: EntryInfo[]
): Promise<void> {
  if (currentDepth > maxDepth) return;

  let itemsInCurrentPath: string[];
  try {
    itemsInCurrentPath = await fsOps.listDirectory(currentPath);
  } catch (error: any) {
    logger.warn(`Cannot list directory ${currentPath} during find: ${error.message}`);
    return; // Skip unlistable directories
  }

  for (const itemName of itemsInCurrentPath) {
    const itemFullPath = path.join(currentPath, itemName);
    try {
      const stats = await fsOps.getLstats(itemFullPath); // Use lstat to avoid following symlinks in traversal for now
      const entryInfoBase = await fsOps.createEntryInfo(itemFullPath, stats, itemName);
      const entryInfo: EntryInfo = { ...entryInfoBase, children: undefined, recursive_size_calculation_note: undefined };

      let typeMatch = true;
      if (entryTypeFilter !== 'any') {
        typeMatch = entryInfo.type === entryTypeFilter;
      }

      if (typeMatch && await entryMatchesAllCriteria(entryInfo, criteria)) {
        results.push(entryInfo);
      }

      if (entryInfo.type === 'directory' && recursive) {
        await findEntriesRecursive(itemFullPath, criteria, entryTypeFilter, recursive, currentDepth + 1, maxDepth, results);
      }
    } catch (error: any) {
      logger.warn(`Error processing path ${itemFullPath} during find: ${error.message}`);
      // Continue with other items
    }
  }
} 