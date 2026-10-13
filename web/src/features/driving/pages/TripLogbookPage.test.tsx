import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TripLogbookPage.tsx', import.meta.url), 'utf8');

describe('TripLogbookPage source preservation contract', () => {
  it('retains all three original sections and isolates render failures', () => {
    for (const section of ['TripLogbookSummary', 'TripLogbookReimbursement', 'TripLogbookDrives']) {
      expect(source).toContain(`name="${section}"`);
    }
    expect(source.match(/<LayoutCard /g)).toHaveLength(2);
    expect(source).toContain('<DrivingSummaryBrief');
  });
  it('keeps all five mobile fields reachable in the canonical embedded table', () => {
    expect(source).toContain("mobileColumns={['date', 'route', 'distanceM', 'category', 'amount']}");
    expect(source).toContain('variant="embedded"');
    expect(source).not.toContain('truncate');
  });
  it('uses timezone-aware inclusive lower and exclusive upper instants', () => {
    expect(source).toContain('Date.parse(startInstant)');
    expect(source).toContain('Date.parse(endInstantExclusive)');
    expect(source).toContain('ts >= startMs && ts < endMs');
  });
  it('distinguishes unknown from measured zero and retains refresh-error data', () => {
    expect(source).toContain('const sourceAvailable = drivesState.hasData;');
    expect(source).toContain('drivesState.isRefreshBlocked || drivesState.refreshError != null');
    expect(source).toContain('rawValue: sourceAvailable ? totals.distanceM : null');
  });
  it('preserves rates, visible-range suggestions, loaded exports and pagination', () => {
    for (const contract of ['perMile ? n / KM_PER_MILE : n', 'visible.has(s.driveId)', 'setCategories(suggestions)', 'tableId="driving:trip-logbook"', 'exportFilename="trip-logbook"', 'pagination', 'exportRow={(r)']) expect(source).toContain(contract);
    expect(source).not.toContain('as CategoryFilter');
  });
});
