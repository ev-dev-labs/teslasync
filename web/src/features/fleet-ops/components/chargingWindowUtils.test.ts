import { describe, expect, it } from 'vitest';
import { chargingWindowsAreValid, type EditableChargingWindow } from './chargingWindowUtils';

function window(
  key: string,
  day_of_week: number,
  start_local_time: string,
  end_local_time: string,
): EditableChargingWindow {
  return { key, day_of_week, start_local_time, end_local_time };
}

describe('chargingWindowsAreValid', () => {
  it('accepts distinct and overnight windows', () => {
    expect(chargingWindowsAreValid([
      window('a', 1, '22:00', '02:00'),
      window('b', 2, '02:00', '06:00'),
    ])).toBe(true);
  });

  it('rejects overlap created by an overnight spill', () => {
    expect(chargingWindowsAreValid([
      window('a', 1, '22:00', '03:00'),
      window('b', 2, '02:00', '06:00'),
    ])).toBe(false);
  });

  it('rejects empty, full-day, and malformed windows', () => {
    expect(chargingWindowsAreValid([])).toBe(false);
    expect(chargingWindowsAreValid([window('a', 1, '08:00', '08:00')])).toBe(false);
    expect(chargingWindowsAreValid([window('a', 1, '8:00', '09:00')])).toBe(false);
  });
});
