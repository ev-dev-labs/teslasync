import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInstance, type TOptions } from 'i18next';

// Read from the web test root; Vite rewrites source-relative URLs as browser assets.
const source = readFileSync('src/features/driving/pages/TripLogbookPage.tsx', 'utf8');

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

describe('TripLogbookPage localized drive count', () => {
  it('keeps numeric plural selection separate from formatted interpolation in the page', () => {
    expect(source).toContain("t('logbook.driveCount', '{{count}} drives', { count: totals.count, replace: { count: fmtInt(totals.count) } })");
    expect(source).not.toContain('{ count: fmtInt(totals.count) })');
  });

  it.each([
    ['en-US', 0, '0 drives'],
    ['en-US', 1, '1 drive'],
    ['en-US', 12345, '12,345 drives'],
    ['de-DE', 0, '0 drives'],
    ['de-DE', 1, '1 drive'],
    ['de-DE', 12345, '12.345 drives'],
  ])('uses numeric count and locale text for %s with %i drives', async (locale, count, expected) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: {
        en: { translation: { logbook: { driveCount_one: '{{count}} drive', driveCount_other: '{{count}} drives' } } },
        de: { translation: { logbook: { driveCount_one: '{{count}} drive', driveCount_other: '{{count}} drives' } } },
      },
    });
    // i18next selects plural forms using the numeric count, then interpolates
    // the already locale-formatted text, matching the existing page pattern.
    const options = {
      count,
      replace: { count: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count) },
    } satisfies TOptions;
    expect(i18n.t('logbook.driveCount', '{{count}} drives', options)).toBe(expected);
  });
});