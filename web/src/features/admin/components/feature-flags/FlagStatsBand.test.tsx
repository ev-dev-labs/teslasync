/**
 * FlagStatsBand — KPI summary band contract.
 *
 * The band derives six operator-facing metrics from two independent feeds
 * (the flag registry + the change-audit log) and owns its own loading /
 * error / empty states so it never gates the rest of the page. These tests
 * pin:
 *   - the loading branch (skeleton grid) and its "keep stale data" guard,
 *   - the error branch (QueryError with a working Retry),
 *   - the full stats derivation (classification, delete filter, actor
 *     dedupe/trim/empty-exclusion),
 *   - the empty state (a zeroed grid, never a blank panel),
 *   - defensive null-safety against undefined feeds and null entries.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { FlagStatsBand } from './FlagStatsBand';
import type {
  FeatureFlagChange,
  FeatureFlagEntry,
} from '@/types/admin-diagnostics';

// QueryError reaches for the browser online-state; pin it to the online
// (network-error → role="alert") branch so the Retry button is enabled and
// assertions don't depend on the jsdom navigator default. Mirrors the
// convention used in QueryError.test.tsx.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

function makeChange(
  overrides: Partial<FeatureFlagChange> = {},
): FeatureFlagChange {
  return {
    id: 1,
    changed_at: '2026-01-01T00:00:00Z',
    actor: 'system',
    actor_ip: '127.0.0.1',
    flag_key: 'flag',
    operation: 'set',
    old_value: null,
    new_value: null,
    reason: '',
    trace_id: 'trace-1',
    ...overrides,
  };
}

type BandProps = ComponentProps<typeof FlagStatsBand>;

function renderBand(overrides: Partial<BandProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: BandProps = {
    flags: [],
    changes: [],
    loading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <FlagStatsBand {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/**
 * Read the numeric value rendered next to a metric's label. MetricCard
 * renders `<p class="metric-label"><span>{label}</span></p>` immediately
 * followed by `<p class="text-xl">{value}</p>`, so we navigate label → value
 * without coupling to brittle class selectors on the value node itself.
 */
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const valueEl = labelSpan.parentElement?.nextElementSibling;
  return valueEl?.textContent ?? '';
}

const ALL_LABELS = [
  'Total Flags',
  'Boolean Toggles',
  'Structured',
  'Recent Changes',
  'Deletes',
  'Contributors',
];

describe('FlagStatsBand — loading', () => {
  it('renders a 6-cell aria-hidden skeleton grid while loading with no data', () => {
    const { container } = renderBand({ loading: true, flags: [] });

    const skeletonGrid = container.querySelector('[aria-hidden="true"]');
    expect(skeletonGrid).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(6);
    // The KPI cards must not render yet.
    expect(screen.queryByText('Total Flags')).toBeNull();
  });

  it('keeps showing stats (not a skeleton) when refetching over existing data', () => {
    const { container } = renderBand({
      loading: true,
      flags: [{ key: 'beta', value: true }],
    });

    // Guard `(flags?.length ?? 0) === 0` means non-empty data suppresses the
    // skeleton so the band updates progressively instead of flashing empty.
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(metricValue('Total Flags')).toBe('1');
    expect(metricValue('Boolean Toggles')).toBe('1');
  });
});

describe('FlagStatsBand — error', () => {
  it('renders a QueryError alert with a Retry that invokes onRetry', () => {
    const { onRetry } = renderBand({ error: new Error('boom') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Total Flags')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error over stale stats when the query has settled', () => {
    renderBand({
      error: new Error('down'),
      flags: [{ key: 'a', value: true }],
      changes: [makeChange()],
      loading: false,
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Total Flags')).toBeNull();
  });
});

describe('FlagStatsBand — stats derivation', () => {
  it('classifies flag value kinds and aggregates the change audit', () => {
    const flags: FeatureFlagEntry[] = [
      { key: 'boolOn', value: true },
      { key: 'boolOff', value: false },
      { key: 'obj', value: { nested: 1 } },
      { key: 'arr', value: [1, 2, 3] },
      { key: 'num', value: 42 },
      { key: 'str', value: 'hello' },
      { key: 'nil', value: null },
    ];
    const changes: FeatureFlagChange[] = [
      makeChange({ operation: 'set', actor: 'alice' }),
      makeChange({ operation: 'delete', actor: 'bob' }),
      makeChange({ operation: 'delete', actor: '  alice  ' }), // trims → dup
      makeChange({ operation: 'set', actor: '' }), // empty → excluded
    ];

    renderBand({ flags, changes });

    expect(metricValue('Total Flags')).toBe('7');
    expect(metricValue('Boolean Toggles')).toBe('2');
    expect(metricValue('Structured')).toBe('2'); // object + array
    expect(metricValue('Recent Changes')).toBe('4');
    expect(metricValue('Deletes')).toBe('2');
    expect(metricValue('Contributors')).toBe('2'); // alice, bob
  });

  it('exposes the grid as a labelled region for assistive tech', () => {
    renderBand({ flags: [{ key: 'x', value: true }] });
    expect(
      screen.getByRole('region', { name: /feature flag summary metrics/i }),
    ).toBeInTheDocument();
  });
});

describe('FlagStatsBand — empty & null-safety', () => {
  it('renders a zeroed grid (never a blank panel) when both feeds are empty', () => {
    renderBand({ flags: [], changes: [] });

    expect(
      screen.getByRole('region', { name: /feature flag summary metrics/i }),
    ).toBeInTheDocument();
    for (const label of ALL_LABELS) {
      expect(metricValue(label)).toBe('0');
    }
  });

  it('tolerates undefined feeds without crashing (defensive ?? [])', () => {
    renderBand({
      flags: undefined as unknown as FeatureFlagEntry[],
      changes: undefined as unknown as FeatureFlagChange[],
    });

    expect(metricValue('Total Flags')).toBe('0');
    expect(metricValue('Contributors')).toBe('0');
  });

  it('skips null entries inside the feeds without throwing', () => {
    renderBand({
      flags: [
        null as unknown as FeatureFlagEntry,
        { key: 'real', value: true },
      ],
      changes: [
        null as unknown as FeatureFlagChange,
        makeChange({ operation: 'delete', actor: 'zoe' }),
      ],
    });

    expect(metricValue('Total Flags')).toBe('2'); // length counts both
    expect(metricValue('Boolean Toggles')).toBe('1'); // only the real boolean
    expect(metricValue('Recent Changes')).toBe('2');
    expect(metricValue('Deletes')).toBe('1');
    expect(metricValue('Contributors')).toBe('1'); // 'zoe' only
  });
});
