/**
 * Formats a Date object or a date string into an ISO 8601 UTC string.
 * Example: 2025-05-16T15:30:00.123Z
 * @param date The Date object or a string that can be parsed into a Date.
 * @returns ISO 8601 UTC string.
 */
export function formatToISO8601UTC(date: Date | string | number): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dateObj.toISOString();
}

/**
 * Gets the current time as an ISO 8601 UTC string.
 * @returns Current time in ISO 8601 UTC string format.
 */
export function getCurrentISO8601UTC(): string {
  return new Date().toISOString();
} 