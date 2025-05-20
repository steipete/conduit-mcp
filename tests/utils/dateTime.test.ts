import { formatToISO8601UTC, getCurrentISO8601UTC } from '@/utils/dateTime';

describe('dateTime Utilities', () => {
  describe('formatToISO8601UTC', () => {
    it('should format a Date object correctly', () => {
      const date = new Date(Date.UTC(2023, 0, 15, 10, 30, 45, 123)); // 2023-01-15T10:30:45.123Z
      expect(formatToISO8601UTC(date)).toBe('2023-01-15T10:30:45.123Z');
    });

    it('should format a date string correctly', () => {
      const dateString = '2024-03-10T12:00:00.000Z';
      expect(formatToISO8601UTC(dateString)).toBe('2024-03-10T12:00:00.000Z');
    });

    it('should format a number (timestamp) correctly', () => {
      const timestamp = new Date(Date.UTC(2022, 5, 20, 18, 0, 0, 0)).getTime(); // 2022-06-20T18:00:00.000Z
      expect(formatToISO8601UTC(timestamp)).toBe('2022-06-20T18:00:00.000Z');
    });
  });

  describe('getCurrentISO8601UTC', () => {
    it('should return a string in ISO 8601 UTC format', () => {
      const currentTimeString = getCurrentISO8601UTC();
      // Regex to check ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
      expect(currentTimeString).toMatch(iso8601Regex);
    });

    it('should reflect a time very close to now', () => {
      const before = Date.now();
      const currentTimeString = getCurrentISO8601UTC();
      const after = Date.now();
      const parsedTime = new Date(currentTimeString).getTime();
      expect(parsedTime).toBeGreaterThanOrEqual(before - 1000); // Allow for 1 sec slack before call
      expect(parsedTime).toBeLessThanOrEqual(after + 1000);    // Allow for 1 sec slack after call
    });
  });
}); 