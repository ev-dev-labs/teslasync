import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MetricBar } from '@/components/data-display';
import type { NormalizationSummary } from '@/types/admin-operator-confidence';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { NormalizationVersionPanel } from './NormalizationVersionPanel';

const { barProps } = vi.hoisted(() => ({
  barProps: vi.fn<(props: ComponentProps<typeof MetricBar>) => void>(),
}));

vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return {
    ...actual,
    MetricBar: (props: ComponentProps<typeof actual.MetricBar>) => {
      barProps(props);
      return <actual.MetricBar {...props} />;
    },
  };
});

const summary: NormalizationSummary = {
  required_version: 2, total_sample_count: 5000, versioned_sample_count: 3800, unversioned_sample_count: 1200,
  coverage_pct: 76, coverage_state: 'measured',
  versions: [
    { version: 3, sample_count: 1050, share_pct: 21 },
    { version: 1, sample_count: 0, share_pct: 0 },
    { version: null, sample_count: 1200, share_pct: 24 },
    { version: 2, sample_count: 2750, share_pct: 55 },
  ],
};

function renderPanel(props: Partial<ComponentProps<typeof NormalizationVersionPanel>> = {}) {
  return render(<MemoryRouter><NormalizationVersionPanel
    normalization={summary} loading={false} error={null} onRetry={() => {}} {...props}
  /></MemoryRouter>);
}

describe('NormalizationVersionPanel semantic attestation contract', () => {
  let previousPreferences: ReturnType<typeof getFormatterPreferences>;
  beforeEach(() => {
    previousPreferences = getFormatterPreferences();
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    barProps.mockClear();
  });
  afterEach(() => {
    cleanup();
    setGlobalLocale(previousPreferences.locale);
    setGlobalPrecision(previousPreferences.precision);
  });

  it('preserves ordered buckets, counts and below-at-above threshold labels with semantic solid fills', () => {
    renderPanel();
    const rows = screen.getAllByRole('listitem');
    const expected = [
      { label: 'Legacy / unknown', status: 'Unattested', count: '1,200 rows', share: 24, color: 'var(--semantic-warning)' },
      { label: 'v1', status: 'Unattested', count: '0 rows', share: 0, color: 'var(--semantic-warning)' },
      { label: 'v2', status: 'Attested', count: '2,750 rows', share: 55, color: 'var(--semantic-success)' },
      { label: 'v3', status: 'Attested', count: '1,050 rows', share: 21, color: 'var(--semantic-success)' },
    ];
    expect(rows).toHaveLength(4);
    expect(barProps).toHaveBeenCalledTimes(4);
    expected.forEach((bucket, index) => {
      const row = within(rows[index]);
      expect(row.getByText(bucket.label)).toHaveClass('text-sm', 'font-medium', 'text-[var(--text-primary)]');
      expect(row.getByText(bucket.status)).toHaveClass(`text-[${bucket.color}]`);
      expect(row.getByText(bucket.count)).toHaveClass('text-sm', 'text-[var(--text-secondary)]', 'tabular-nums');
      expect(row.getByText(`${bucket.share.toFixed(2)}% of window`)).toHaveClass('text-xs', 'text-[var(--text-muted)]');
      const bar = row.getByRole('progressbar', { name: bucket.label });
      expect(bar).toHaveAttribute('aria-valuenow', String(bucket.share));
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar.querySelector('[data-metric-track]')).toHaveClass('h-1');
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: bucket.color });
      expect(barProps).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        value: bucket.share, max: 100, label: bucket.label, showHeader: false, size: 'slim', fill: 'solid', color: bucket.color,
      }));
    });
    expect(summary.versions.map((bucket) => bucket.version)).toEqual([3, 1, null, 2]);
  });

  it.each([
    { name: 'missing', value: undefined },
    { name: 'null', value: null },
  ])('preserves numeric attestation and the legacy warning with a $name required version', ({ value }) => {
    const normalization = { ...summary };
    Object.defineProperty(normalization, 'required_version', { value });
    renderPanel({ normalization });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Unattested')).toBeInTheDocument();
    rows.slice(1).forEach((row) => expect(within(row).getByText('Attested')).toBeInTheDocument());
    expect(barProps.mock.calls.map(([props]) => props.color)).toEqual([
      'var(--semantic-warning)', 'var(--semantic-success)', 'var(--semantic-success)', 'var(--semantic-success)',
    ]);
  });

  it.each([
    { requiredVersion: 0, status: 'Attested', color: 'var(--semantic-success)' },
    { requiredVersion: 2, status: 'Unattested', color: 'var(--semantic-warning)' },
  ])('keeps explicit v0 distinct from missing evidence at required version $requiredVersion', ({ requiredVersion, status, color }) => {
    const normalization: NormalizationSummary = {
      ...summary,
      required_version: requiredVersion,
      versions: [
        { version: 0, sample_count: 0, share_pct: 0 },
        { version: null, sample_count: 1200, share_pct: null },
      ],
    };
    renderPanel({ normalization });
    const rows = screen.getAllByRole('listitem');
    const missing = within(rows[0]);
    expect(missing.getByText('Legacy / unknown')).toBeInTheDocument();
    expect(missing.getByText('Unattested')).toHaveClass('text-[var(--semantic-warning)]');
    expect(missing.getByText('Share unknown')).toBeInTheDocument();
    expect(missing.getByRole('progressbar', { name: 'Legacy / unknown' })).not.toHaveAttribute('aria-valuenow');
    const zero = within(rows[1]);
    expect(zero.getByText('v0')).toBeInTheDocument();
    expect(zero.getByText(status)).toHaveClass(`text-[${color}]`);
    expect(zero.getByText('0 rows')).toBeInTheDocument();
    expect(zero.getByText('0.00% of window')).toBeInTheDocument();
    expect(zero.getByRole('progressbar', { name: 'v0' })).toHaveAttribute('aria-valuenow', '0');
    expect(barProps).toHaveBeenNthCalledWith(2, expect.objectContaining({
      value: 0, label: 'v0', fill: 'solid', color,
    }));
    expect(normalization.versions.map((bucket) => bucket.version)).toEqual([0, null]);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'NaN', value: Number.NaN },
    { name: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { name: 'negative infinity', value: Number.NEGATIVE_INFINITY },
  ])('keeps a $name share unknown without fabricating zero or losing its count and attestation', ({ value }) => {
    renderPanel({ normalization: { ...summary, versions: [{ version: 2, sample_count: 2750, share_pct: value }] } });
    const bar = screen.getByRole('progressbar', { name: 'v2' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
    expect(bar.querySelector('[data-metric-fill]')).toBeNull();
    expect(screen.getByText('Share unknown')).toHaveClass('text-[var(--text-muted)]');
    expect(screen.getByText('2,750 rows')).toBeInTheDocument();
    expect(screen.getByText('Attested')).toBeInTheDocument();
    expect(screen.queryByText('0.00% of window')).not.toBeInTheDocument();
    expect(barProps).toHaveBeenCalledWith(expect.objectContaining({
      value, fill: 'solid', color: 'var(--semantic-success)',
    }));
  });

  it('retains saved locale and precision for shares and integer counters', () => {
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(1);
    });
    renderPanel({ normalization: { ...summary, versions: [{ version: 2, sample_count: 1200, share_pct: 12.25 }] } });
    expect(screen.getByText('1.200 rows')).toBeInTheDocument();
    expect(screen.getByText('12,3% of window')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'v2' })).toHaveAttribute('aria-valuenow', '12.25');
  });

  it('keeps an omitted runtime share unknown while preserving attestation and count', () => {
    const bucket = { ...summary.versions[0] };
    Object.defineProperty(bucket, 'share_pct', { value: undefined });
    renderPanel({ normalization: { ...summary, versions: [bucket] } });
    const bar = screen.getByRole('progressbar', { name: 'v3' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
    expect(bar.querySelector('[data-metric-fill]')).toBeNull();
    expect(screen.getByText('Share unknown')).toBeInTheDocument();
    expect(screen.getByText('1,050 rows')).toBeInTheDocument();
    expect(screen.getByText('Attested')).toBeInTheDocument();
    expect(barProps).toHaveBeenCalledWith(expect.objectContaining({
      value: undefined, fill: 'solid', color: 'var(--semantic-success)',
    }));
  });

  it.each([
    { name: 'null', value: null },
    { name: 'omitted', value: undefined },
  ])('keeps the empty shell and retry for $name runtime buckets', ({ value }) => {
    const normalization = { ...summary };
    Object.defineProperty(normalization, 'versions', { value });
    const onRetry = vi.fn();
    renderPanel({ normalization, onRetry });
    expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
    expect(screen.getByText('No version evidence')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(barProps).not.toHaveBeenCalled();
  });

  it('keeps the section shell and loading branch without fabricating buckets', () => {
    const { container } = renderPanel({ normalization: undefined, loading: true });
    expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
    expect(container.querySelector('[data-card-desc="true"]')).toHaveTextContent('Row counts per normalization contract version over the scoring window.');
    expect(container.querySelector('div[aria-hidden="true"]')).toHaveStyle({ height: '180px' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('No version evidence')).not.toBeInTheDocument();
    expect(barProps).not.toHaveBeenCalled();
  });

  it('retains all evidence while a refresh is loading', () => {
    renderPanel({ loading: true });
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(screen.getByText('1,200 rows')).toBeInTheDocument();
    expect(screen.getByText('55.00% of window')).toBeInTheDocument();
    expect(screen.queryByText('No version evidence')).not.toBeInTheDocument();
  });

  it('keeps the empty section and its working refresh action', () => {
    const onRetry = vi.fn();
    renderPanel({ normalization: { ...summary, versions: [] }, onRetry });
    expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
    expect(screen.getByText('No version evidence')).toBeInTheDocument();
    expect(screen.getByText('No signal rows were persisted in this window, so no normalization version could be observed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(barProps).not.toHaveBeenCalled();
  });

  it('prioritizes the error branch over retained buckets and loading and keeps retry working', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('Fixture failure'), loading: true, onRetry });
    expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('No version evidence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(barProps).not.toHaveBeenCalled();
  });
});
