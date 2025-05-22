import { describe, it, expect, vi } from 'vitest';
import { formatToISO8601UTC, getCurrentISO8601UTC } from '@/utils/dateTime';

describe('dateTime utils', () => {
  describe('formatToISO8601UTC', () => {
    it('should format a Date object to ISO 8601 UTC string', () => {
      const date = new Date(2023, 0, 15, 10, 30, 0, 123); // January 15, 2023, 10:30:00.123
      // Note: JavaScript Date month is 0-indexed (0 for January)
      // When creating a date like this, it's in the local timezone.
      // toISOString() converts it to UTC.
      const expectedDate = new Date(Date.UTC(2023, 0, 15, 10, 30, 0, 123));
      expect(formatToISO8601UTC(date)).toBe(expectedDate.toISOString());
    });

    it('should format a date string to ISO 8601 UTC string', () => {
      const dateString = '2023-03-20T12:00:00.000Z';
      expect(formatToISO8601UTC(dateString)).toBe('2023-03-20T12:00:00.000Z');
    });

    it('should format a number (timestamp) to ISO 8601 UTC string', () => {
      const timestamp = new Date('2024-07-04T08:00:00.000Z').getTime();
      expect(formatToISO8601UTC(timestamp)).toBe('2024-07-04T08:00:00.000Z');
    });

    it('should handle different timezones correctly by converting to UTC', () => {
      // A date string with a specific timezone offset
      const dateStringNonUTC = '2023-05-10T10:00:00.000+02:00'; // 10:00 in GMT+2 is 08:00 UTC
      expect(formatToISO8601UTC(dateStringNonUTC)).toBe('2023-05-10T08:00:00.000Z');
    });
  });

  describe('getCurrentISO8601UTC', () => {
    it('should return the current time in ISO 8601 UTC string format', () => {
      const expectedNow = new Date();
      const expectedISOString = expectedNow.toISOString();

      // Mock Date constructor to control current time
      vi.useFakeTimers();
      vi.setSystemTime(expectedNow);

      const actualISOString = getCurrentISO8601UTC();
      expect(actualISOString).toBe(expectedISOString);

      vi.useRealTimers(); // Restore real timers
    });

    it('should return a string that matches ISO 8601 format', () => {
      const isoString = getCurrentISO8601UTC();
      // Regex to check for basic ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(isoString).toMatch(iso8601Regex);
    });
  });
});
