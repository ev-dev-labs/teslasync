/**
 * XRayBucketChart unit tests.
 *
 * The chart wraps the shared `<ChartContainer>` (which pulls in i18next, the
 * useChartExport hook, and the annotations API). We mock those the same way
 * `ChartContainer.test.tsx` / `MetricSwitcherChart.test.tsx` do so the chart
 * renders in isolation, and we mock `useDateFormat` with a recognisable
 * `formatTime` so we can assert the a11y fallback table renders the SAME
 * localized time the visible X axis shows (regression guard for the raw-ISO
 * bug this file fixed).
 *
 * Recharts measures the SVG bounding box, and jsdom returns 0 × 0, so the
 * visible bars never paint. We therefore assert against `<ChartContainer>`'s
 * always-rendered scaffolding: the title/subtitle, the `role="img"` figure,
 * the screen-reader fallback `<table>`, and the loading / empty states.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { XRayBucketChart } from './XRayBucketChart';
import type { IngestXRayBucketPoint } from '@/types/admin-diagnostics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

// Deterministic time formatter — prefixes the raw value so a test can prove
// the fallback table ran the value through `formatTime` instead of echoing the
// bare ISO string. Nullish inputs collapse to the shared em-dash marker.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: string | Date | null | undefined) =>
      value == null ? '—' : `time:${String(value)}`,
  }),
}));

const buckets: IngestXRayBucketPoint[] = [
  { bucket_start: '2026-07-04T16:00:00Z', count: 1234 },
  { bucket_start: '2026-07-04T16:05:00Z', count: 5 },
];

function renderChart(props: { buckets: IngestXRayBucketPoint[]; loading: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <XRayBucketChart buckets={props.buckets} loading={props.loading} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('XRayBucketChart', () => {
  it('renders the title, subtitle, and an accessibly-named chart figure', () => {
    renderChart({ buckets, loading: false });

    expect(
      screen.getByRole('heading', { name: 'Samples per bucket' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Time-series of ingested telemetry rows over the selected window.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Bar chart of ingest sample counts per time bucket.',
      }),
    ).toBeInTheDocument();
  });

  it('renders the a11y fallback table with localized bucket times and thousands-separated counts', () => {
    renderChart({ buckets, loading: false });

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Bucket' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Samples' })).toBeInTheDocument();

    // Bucket column is run through formatTime (not the raw ISO string) so
    // screen-reader users hear the same value the visible axis renders.
    expect(within(table).getByText('time:2026-07-04T16:00:00Z')).toBeInTheDocument();
    expect(within(table).queryByText('2026-07-04T16:00:00Z')).not.toBeInTheDocument();

    // Counts use fmtInt → locale thousands separators.
    expect(within(table).getByText('1,234')).toBeInTheDocument();
    expect(within(table).getByText('5')).toBeInTheDocument();
  });

  it('renders an em dash for a missing (null) sample count', () => {
    const sparse = [
      { bucket_start: '2026-07-04T16:00:00Z', count: null },
    ] as unknown as IngestXRayBucketPoint[];

    renderChart({ buckets: sparse, loading: false });

    const table = screen.getByRole('table');
    // The valid bucket still formats; only the null count collapses to "—".
    expect(within(table).getByText('time:2026-07-04T16:00:00Z')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state and no data table when there are no buckets', () => {
    renderChart({ buckets: [], loading: false });

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The framing (title) still renders — the panel is never left blank.
    expect(
      screen.getByRole('heading', { name: 'Samples per bucket' }),
    ).toBeInTheDocument();
  });

  it('shows a loading spinner instead of the empty state while loading', () => {
    renderChart({ buckets: [], loading: true });

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });

  it('treats undefined buckets defensively as an empty series', () => {
    renderChart({
      buckets: undefined as unknown as IngestXRayBucketPoint[],
      loading: false,
    });

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
