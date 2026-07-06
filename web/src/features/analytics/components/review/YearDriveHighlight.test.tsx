/**
 * YearDriveHighlight — behaviour + hardening contract.
 *
 * The card renders one notable drive (longest / most-efficient / …) in two
 * mutually-exclusive states:
 *   - empty (drive === null) → the label + icon header stay, and the body is a
 *     single <EmptyState> ("No drive data for this year"). No metric tiles leak.
 *   - populated → a from→to address row, a three-tile metric grid
 *     (distance / duration / efficiency) with unit-aware subtitles, and the
 *     drive date caption.
 *
 * These tests pin the unit-conversion behaviour and the null-safety hardening
 * this file carries:
 *   - distance is read as SI metres and formatted for the user's display unit,
 *     so 100 km reads "100" (km) but a different, smaller figure in miles;
 *   - efficiency stays Wh/km for a km user and scales by the 1.609344 km/mi
 *     factor to Wh/mi for a miles user; a non-positive/absent value shows "—";
 *   - REAL BUG FIXED — `formatDuration` now rounds the total to whole minutes
 *     *before* splitting, so 119.7 min renders "2h 0m" (previously the
 *     split-then-round path produced the impossible "1h 60m"). NaN/negative
 *     inputs degrade to "0m" instead of "NaNm";
 *   - a partial payload (null distance/duration/efficiency, blank addresses,
 *     blank date) degrades to "0" / "0m" / "—" placeholders, never "NaN" or a
 *     blank slot;
 *   - a11y — every glyph is decorative (aria-hidden), so nothing is exposed as
 *     an unlabelled image, and the label text carries the tile's meaning.
 *
 * `react-i18next` is mocked to echo the English fallback and `@/hooks/useUnits`
 * is mocked to drive the km/mi branch (mirrors the sibling HeroGauges /
 * AchievementBadge convention); the pure SI converter + integer formatter run
 * for real. The component has no interactive controls, so there is no userEvent
 * surface to exercise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Trophy } from 'lucide-react';

import { YearDriveHighlight } from './YearDriveHighlight';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt } from '@/lib/numberFormat';
import type { YearReviewDriveHighlight } from '@/api/types';

// Mutable mock state. `vi.mock` factories are hoisted above the imports, so the
// shared handle must be created with `vi.hoisted` to be referenceable inside.
const h = vi.hoisted(() => ({ distance: { current: 'km' as 'km' | 'mi' } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: h.distance.current } }),
}));

/** km/mi share the same 1 mile = 1.609344 km factor the source uses. */
const KM_PER_MILE = 1.609344;
const DASH = '—';

/**
 * Build a full YearReviewDriveHighlight. Overrides are intentionally loosely
 * typed so tests can inject the null/NaN the non-null API type forbids at
 * compile time but that a partial payload produces at runtime.
 */
function makeDrive(
  overrides: Partial<Record<keyof YearReviewDriveHighlight, unknown>> = {},
): YearReviewDriveHighlight {
  return {
    drive_id: 42,
    date: 'Jan 15, 2024',
    distance_km: 100,
    duration_min: 84,
    start_address: 'Palo Alto, CA',
    end_address: 'Los Angeles, CA',
    efficiency_wh_km: 150,
    ...overrides,
  } as YearReviewDriveHighlight;
}

function renderCard(drive: YearReviewDriveHighlight | null, label = 'Longest drive') {
  return render(<YearDriveHighlight drive={drive} label={label} icon={Trophy} />);
}

beforeEach(() => {
  h.distance.current = 'km';
});

describe('YearDriveHighlight', () => {
  describe('empty state (no drive)', () => {
    it('keeps the labelled header and shows the empty-state message, no metric tiles', () => {
      renderCard(null, 'Most efficient');

      // Header label survives even with no drive data.
      expect(screen.getByText('Most efficient')).toBeInTheDocument();

      // Body collapses to the localized EmptyState (rendered with role=status).
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      expect(within(status).getByText('No drive data for this year')).toBeInTheDocument();

      // None of the populated-branch captions leak into the empty card.
      expect(screen.queryByText('duration')).not.toBeInTheDocument();
      expect(screen.queryByText('km')).not.toBeInTheDocument();
    });
  });

  describe('populated — kilometres', () => {
    it('renders addresses, km-derived metrics, unit subtitles and the date', () => {
      renderCard(makeDrive());

      // From → to address row.
      expect(screen.getByText('Palo Alto, CA')).toBeInTheDocument();
      expect(screen.getByText('Los Angeles, CA')).toBeInTheDocument();

      // Distance: 100 km routes through the SI-metre helper unchanged → "100".
      expect(screen.getByText(fmtInt(convertDistanceFromSI(100_000, 'km')))).toBeInTheDocument();
      expect(screen.getByText('km')).toBeInTheDocument();

      // Duration: 84 min → "1h 24m".
      expect(screen.getByText('1h 24m')).toBeInTheDocument();
      expect(screen.getByText('duration')).toBeInTheDocument();

      // Efficiency stays Wh/km for a km user → "150".
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('Wh/km')).toBeInTheDocument();

      // Drive date caption.
      expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument();
    });
  });

  describe('populated — miles', () => {
    it('converts distance to miles and efficiency to Wh/mi, swapping the subtitles', () => {
      h.distance.current = 'mi';
      renderCard(makeDrive());

      // Distance routes through the SI-metre helper → miles: a different, smaller
      // figure than the km reading (proves the conversion actually ran).
      const expectedMi = fmtInt(convertDistanceFromSI(100_000, 'mi'));
      expect(screen.getByText(expectedMi)).toBeInTheDocument();
      expect(expectedMi).not.toBe('100');
      expect(screen.queryByText('100')).not.toBeInTheDocument();
      expect(screen.getByText('mi')).toBeInTheDocument();

      // Efficiency scales by 1.609344 → 150 * 1.609344 = 241.4016 → "241".
      expect(screen.getByText(fmtInt(150 * KM_PER_MILE))).toBeInTheDocument();
      expect(screen.getByText('Wh/mi')).toBeInTheDocument();
      // The km-only subtitles are gone.
      expect(screen.queryByText('km')).not.toBeInTheDocument();
      expect(screen.queryByText('Wh/km')).not.toBeInTheDocument();
    });
  });

  describe('duration formatting (regression: minute-rollover bug)', () => {
    it('rolls a rounded-up minute onto the hour boundary → "2h 0m", never "1h 60m"', () => {
      renderCard(makeDrive({ duration_min: 119.7 }));

      expect(screen.getByText('2h 0m')).toBeInTheDocument();
      // The old split-then-round produced the impossible "1h 60m".
      expect(screen.queryByText('1h 60m')).not.toBeInTheDocument();
    });

    it('renders sub-hour durations without an hours segment', () => {
      renderCard(makeDrive({ duration_min: 24 }));

      expect(screen.getByText('24m')).toBeInTheDocument();
      expect(screen.queryByText(/\dh /)).not.toBeInTheDocument();
    });
  });

  describe('efficiency guard', () => {
    it('shows an em-dash for a non-positive efficiency instead of "0"', () => {
      renderCard(makeDrive({ efficiency_wh_km: 0 }));

      // Addresses + date are present, so the only "—" is the efficiency tile.
      expect(screen.getByText(DASH)).toBeInTheDocument();
      // The Wh/km subtitle still renders — the tile is never blanked out.
      expect(screen.getByText('Wh/km')).toBeInTheDocument();
    });

    it('treats a negative efficiency as "no reading"', () => {
      renderCard(makeDrive({ efficiency_wh_km: -50 }));
      expect(screen.getByText(DASH)).toBeInTheDocument();
    });
  });

  describe('null-safety hardening (partial payload)', () => {
    it('degrades null distance/duration/efficiency and blank addresses/date to placeholders', () => {
      const { container } = renderCard(
        makeDrive({
          distance_km: null,
          duration_min: null,
          efficiency_wh_km: null,
          start_address: '',
          end_address: '',
          date: '',
        }),
      );

      // Distance collapses to "0", duration to "0m" — no "NaN" anywhere.
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('0m')).toBeInTheDocument();
      expect(container.textContent).not.toContain('NaN');

      // start / end / efficiency / date all fall back to the em-dash → four.
      expect(screen.getAllByText(DASH)).toHaveLength(4);
    });

    it('never renders "NaNm" for a NaN duration', () => {
      const { container } = renderCard(makeDrive({ duration_min: Number.NaN }));

      expect(screen.getByText('0m')).toBeInTheDocument();
      expect(container.textContent).not.toContain('NaN');
    });
  });

  describe('accessibility', () => {
    it('marks the header glyph decorative and exposes no unlabelled image', () => {
      const { container } = renderCard(makeDrive(), 'Fastest drive');

      // The amber header icon is aria-hidden (its meaning comes from the label).
      const headerIcon = container.querySelector('svg.text-amber-300');
      expect(headerIcon).not.toBeNull();
      expect(headerIcon?.getAttribute('aria-hidden')).toBe('true');

      // No decorative glyph is accidentally exposed to the a11y tree.
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      // The label carries the tile's semantics.
      expect(screen.getByText('Fastest drive')).toBeInTheDocument();
    });
  });
});
