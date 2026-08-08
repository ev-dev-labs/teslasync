export interface EditableChargingWindow {
  key: string;
  day_of_week: number;
  start_local_time: string;
  end_local_time: string;
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOfDay(value: string): number | null {
  const match = timePattern.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function chargingWindowsAreValid(windows: EditableChargingWindow[]): boolean {
  const occupied = new Map<number, Array<[number, number]>>();
  if (windows.length === 0) return false;
  for (const window of windows) {
    const start = minuteOfDay(window.start_local_time);
    const end = minuteOfDay(window.end_local_time);
    if (
      window.day_of_week < 0
      || window.day_of_week > 6
      || start == null
      || end == null
      || start === end
    ) return false;
    const segments: Array<[number, number, number]> = end < start
      ? [
          [window.day_of_week, start, 1440],
          [(window.day_of_week + 1) % 7, 0, end],
        ]
      : [[window.day_of_week, start, end]];
    for (const [day, segmentStart, segmentEnd] of segments) {
      const existing = occupied.get(day) ?? [];
      if (existing.some(([from, to]) => segmentStart < to && segmentEnd > from)) return false;
      occupied.set(day, [...existing, [segmentStart, segmentEnd]]);
    }
  }
  return true;
}
