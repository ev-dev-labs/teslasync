/**
 * SignalDiffBreakdown — behaviour + hardening coverage.
 *
 * Exercises the three-panel "change analysis" bento and locks in the fixes
 * made while elevating it:
 *   - the three panel shells (category / source / pinned) are ALWAYS present,
 *     each owning its own loading / empty / error state so a slow or failed
 *     diff never blanks the section;
 *   - category counts distribute rows across the shared CATEGORY_PREFIXES and
 *     render sorted by count desc with a `count (pct%)` readout;
 *   - source counts bucket by the *current* window layer (`source_b`), folding
 *     a missing layer into the "Unknown" bucket;
 *   - the pinned panel is independent of the diff query — it keeps rendering
 *     the user's pins even while the diff itself errors;
 *   - null-safety: `rows`/`pinnedSignals` handed to us as `undefined` degrade
 *     to the empty states instead of throwing on `.length`/`Array.from(...)`.
 *
 * MetricBar animates via framer-motion; jsdom renders it statically, so
 * assertions target the always-present label + `count (pct%)` readout text
 * rather than the animated fill width.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { SignalDiffBreakdown, type SignalDiffBreakdownProps } from './SignalDiffBreakdown';
import type { SignalDiffRow } from '@/api/hooks/useTelemetry';

// i18n stub: echo the English fallback so assertions read the production copy,
// and interpolate `{{count}}` from the options bag so the pinned caption
// resolves to a real number. Mirrors the LiveThroughputPanel.test.tsx
// convention, extended with `{{var}}` substitution.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : _key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const CATEGORY_TITLE = 'Change by category';
const SOURCE_TITLE = 'Source layers';
const PINNED_TITLE = 'Pinned signals';

const CATEGORY_EMPTY = 'No categorized changes to summarize';
const SOURCE_EMPTY = 'No source-layer data yet';
const PINNED_EMPTY = 'No pinned signals — pin a row to track it here';

// Four rows chosen so each name matches exactly ONE category and the source
// distribution is predictable: battery×2 (L1), drive×1 (L2), climate×1 (no
// source_b → Unknown). total = 4.
function sampleRows(): SignalDiffRow[] {
  return [
    { name: 'battery_level', value_a: 80, value_b: 82, source_b: 'l1', changed: true },
    { name: 'charge_current', value_a: 10, value_b: 12, source_b: 'l1', changed: true },
    { name: 'vehicle_speed', value_a: 0, value_b: 35, source_b: 'l2', changed: true },
    { name: 'cabin_temp', value_a: 20, value_b: 22, changed: true },
  ];
}

function renderBreakdown(over: Partial<SignalDiffBreakdownProps> = {}) {
  const props: SignalDiffBreakdownProps = {
    rows: sampleRows(),
    pinnedSignals: new Set<string>(),
    ...over,
  };
  return render(
    <MemoryRouter>
      <SignalDiffBreakdown {...props} />
    </MemoryRouter>,
  );
}

// Scope helper — the GlassPanel wrapper carries `data-print-card`, so the
// closest one to a panel heading is that panel's root.
function panelFor(headingName: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingName });
  const panel = heading.closest('[data-print-card]');
  if (!(panel instanceof HTMLElement)) {
    throw new Error(`no panel wrapper found for heading "${headingName}"`);
  }
  return panel;
}

describe('SignalDiffBreakdown', () => {
  it('always renders the three labelled panel shells inside a named region', () => {
    renderBreakdown({ rows: sampleRows(), pinnedSignals: new Set(['battery_level']) });

    // The <section> exposes an accessible name so AT users can jump to it.
    expect(
      screen.getByRole('region', { name: 'Change analysis' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: CATEGORY_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: SOURCE_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: PINNED_TITLE })).toBeInTheDocument();
  });

  it('distributes changed rows across categories, sorted by count desc, with count + percentage', () => {
    renderBreakdown();
    const panel = panelFor(CATEGORY_TITLE);

    // battery(2) → drive(1) → climate(1). Sort is by count desc; equal counts
    // preserve the CATEGORY_PREFIXES order (drive before climate).
    const labels = within(panel).getAllByText(/^(Battery|Drive|Climate)$/);
    expect(labels.map((el) => el.textContent)).toEqual(['Battery', 'Drive', 'Climate']);

    // Percentages are computed against the total row count (4), not the number
    // of categories: battery = 2/4 = 50%.
    expect(within(panel).getByText('2 (50%)')).toBeInTheDocument();
    expect(within(panel).getAllByText('1 (25%)')).toHaveLength(2);

    // Categories with no matching rows are omitted entirely.
    expect(within(panel).queryByText('Security')).toBeNull();
    expect(within(panel).queryByText('Motor')).toBeNull();
  });

  it('buckets source layers by the current window (source_b), folding a missing layer into Unknown', () => {
    renderBreakdown();
    const panel = panelFor(SOURCE_TITLE);

    // l1(2) → l2(1) → unknown(1), in SOURCE_META reporting order.
    expect(within(panel).getByText('L1 · In-process')).toBeInTheDocument();
    expect(within(panel).getByText('L2 · Redis')).toBeInTheDocument();
    // The row with no `source_b` is attributed to the Unknown bucket.
    expect(within(panel).getByText('Unknown')).toBeInTheDocument();

    expect(within(panel).getByText('2 (50%)')).toBeInTheDocument();

    // Layers with zero rows never render (no LOG / STALE rows in the fixture).
    expect(within(panel).queryByText('LOG · History')).toBeNull();
    expect(within(panel).queryByText('STALE')).toBeNull();
  });

  it('lists pinned signals sorted alphabetically with a live count caption', () => {
    renderBreakdown({ pinnedSignals: new Set(['vehicle_speed', 'battery_level']) });
    const panel = panelFor(PINNED_TITLE);

    expect(within(panel).getByText('2 pinned')).toBeInTheDocument();

    const badges = within(panel).getAllByText(/^(battery_level|vehicle_speed)$/);
    expect(badges.map((el) => el.textContent)).toEqual(['battery_level', 'vehicle_speed']);
  });

  it('shows a per-panel empty state (never a blank panel) when there are no rows or pins', () => {
    renderBreakdown({ rows: [], pinnedSignals: new Set() });

    expect(within(panelFor(CATEGORY_TITLE)).getByText(CATEGORY_EMPTY)).toBeInTheDocument();
    expect(within(panelFor(SOURCE_TITLE)).getByText(SOURCE_EMPTY)).toBeInTheDocument();
    expect(within(panelFor(PINNED_TITLE)).getByText(PINNED_EMPTY)).toBeInTheDocument();

    // Headings survive the empty state — the shells stay mounted.
    expect(screen.getByRole('heading', { name: CATEGORY_TITLE })).toBeInTheDocument();
  });

  it('prefers the loading skeleton over rendered bars, even when row data is already present', () => {
    // loading=true with real rows: the diff/category panels must show the
    // skeleton (a background refetch shouldn't flash stale-looking bars).
    renderBreakdown({ loading: true, rows: sampleRows() });

    const catPanel = panelFor(CATEGORY_TITLE);
    expect(catPanel.querySelector('.animate-pulse')).not.toBeNull();
    expect(within(catPanel).queryByText('Battery')).toBeNull();
    expect(within(catPanel).queryByText(CATEGORY_EMPTY)).toBeNull();

    expect(panelFor(SOURCE_TITLE).querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a retryable error in the diff panels while keeping the pinned panel alive', () => {
    const onRetry = vi.fn();
    renderBreakdown({
      error: new Error('diff failed'),
      onRetry,
      rows: [],
      pinnedSignals: new Set(['odometer']),
    });

    // Both diff-driven panels render the error (role=alert) with a Retry CTA.
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    expect(retryButtons).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    // The pinned panel does NOT depend on the diff query — it still shows the
    // user's pins during an error.
    const pinnedPanel = panelFor(PINNED_TITLE);
    expect(within(pinnedPanel).getByText('odometer')).toBeInTheDocument();
    expect(within(pinnedPanel).getByText('1 pinned')).toBeInTheDocument();

    fireEvent.click(retryButtons[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: undefined rows/pinnedSignals degrade to empty states instead of throwing', () => {
    // Callers should never do this, but a bad upstream value must not blank the
    // whole section with a crash on `.length` / `Array.from(undefined)`.
    const bad = {
      rows: undefined,
      pinnedSignals: undefined,
    } as unknown as SignalDiffBreakdownProps;

    expect(() =>
      render(
        <MemoryRouter>
          <SignalDiffBreakdown {...bad} />
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(within(panelFor(CATEGORY_TITLE)).getByText(CATEGORY_EMPTY)).toBeInTheDocument();
    expect(within(panelFor(PINNED_TITLE)).getByText(PINNED_EMPTY)).toBeInTheDocument();
  });

  it('forwards a custom className onto the region wrapper without dropping the grid layout', () => {
    const { container } = renderBreakdown({ className: 'test-marker col-span-2' });
    const section = container.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.className).toContain('test-marker');
    // Base responsive grid classes are merged, not replaced.
    expect(section?.className).toContain('grid');
  });

  it('marks the decorative panel icons as hidden from assistive tech', () => {
    const { container } = renderBreakdown();
    // Each of the three panel titles carries an aria-hidden lucide icon; the
    // accessible name of every heading is therefore text-only.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { name: CATEGORY_TITLE }).textContent).toContain(
      CATEGORY_TITLE,
    );
  });
});
