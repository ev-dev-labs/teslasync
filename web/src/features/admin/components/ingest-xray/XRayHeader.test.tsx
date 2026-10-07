import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@/i18n';

import { XRayHeader } from './XRayHeader';
import type {
  IngestXRayBucket,
  IngestXRayResponse,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

/** Em-dash placeholder rendered until a vehicle is selected and data arrives. */
const DASH = '—';

interface HeaderProps {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
}

function makeResponse(
  overrides: Partial<IngestXRayResponse> = {},
): IngestXRayResponse {
  return {
    vehicle_id: 1,
    window: '1h',
    bucket: '1m',
    generated_at: '2026-07-04T00:00:00Z',
    total_samples: 12345,
    unique_fields: 87,
    fields: [],
    buckets: [
      { bucket_start: '2026-07-04T00:00:00Z', count: 10 },
      { bucket_start: '2026-07-04T00:01:00Z', count: 41 },
      { bucket_start: '2026-07-04T00:02:00Z', count: 25 },
    ],
    ...overrides,
  };
}

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    data: undefined,
    loading: false,
    windowSel: '1h',
    bucketSel: '1m',
    ...overrides,
  };
  return render(<XRayHeader {...props} />);
}

/**
 * Read the value paragraph rendered immediately after a MetricCard's label.
 * Scoping by label keeps assertions unambiguous even when several cards share
 * a formatted value (e.g. every data KPI shows the em-dash before data loads).
 */
function valueFor(label: string): string {
  const labelEl = screen.getByText(label);
  const labelParagraph = labelEl.closest('p');
  const valueParagraph = labelParagraph?.nextElementSibling as HTMLElement | null;
  return valueParagraph?.textContent?.trim() ?? '';
}

describe('XRayHeader', () => {
  it('exposes a labelled summary region containing all six KPI cards', () => {
    renderHeader({ data: makeResponse() });

    const region = screen.getByRole('region', {
      name: /ingest summary metrics/i,
    });
    expect(region).toBeInTheDocument();

    for (const label of [
      'Total samples',
      'Distinct fields',
      'Peak / bucket',
      'Avg / bucket',
      'Window',
      'Bucket',
    ]) {
      expect(within(region).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the em-dash for every data KPI before data arrives', () => {
    renderHeader({ data: undefined, loading: false });

    // Four data-driven KPIs fall back to the dash; the two selection KPIs
    // always echo the current picker choice.
    expect(screen.getAllByText(DASH)).toHaveLength(4);
    expect(valueFor('Total samples')).toBe(DASH);
    expect(valueFor('Distinct fields')).toBe(DASH);
    expect(valueFor('Peak / bucket')).toBe(DASH);
    expect(valueFor('Avg / bucket')).toBe(DASH);
    expect(valueFor('Window')).toBe('1 hour');
    expect(valueFor('Bucket')).toBe('1 minute');
  });

  it('keeps the dash while loading even when stale data is present', () => {
    // `ready = !loading && !!data` — a background refetch must never flash a
    // real 0 or a stale value onto the data KPIs.
    renderHeader({ data: makeResponse(), loading: true });

    expect(valueFor('Total samples')).toBe(DASH);
    expect(valueFor('Peak / bucket')).toBe(DASH);
    expect(valueFor('Avg / bucket')).toBe(DASH);
    // Selection KPIs remain live regardless of loading state.
    expect(valueFor('Window')).toBe('1 hour');
  });

  it('formats totals and derives peak/avg from the bucket series when ready', () => {
    renderHeader({ data: makeResponse(), loading: false });

    expect(valueFor('Total samples')).toBe('12,345');
    expect(valueFor('Distinct fields')).toBe('87');
    // Buckets [10, 41, 25]: peak = max = 41, avg = 76 / 3 = 25.3 (1 dp).
    expect(valueFor('Peak / bucket')).toBe('41');
    expect(valueFor('Avg / bucket')).toBe('25.3');
    // Nothing should be dashed once real data is in.
    expect(screen.queryByText(DASH)).toBeNull();
  });

  it('renders zeros (not dashes) for peak/avg when the bucket series is empty', () => {
    renderHeader({ data: makeResponse({ buckets: [] }), loading: false });

    expect(valueFor('Total samples')).toBe('12,345');
    expect(valueFor('Peak / bucket')).toBe('0');
    expect(valueFor('Avg / bucket')).toBe('0.0');
  });

  it('coerces missing totals and bucket counts to zero (null-safety)', () => {
    // Simulate a sparse payload where the server omitted numeric fields.
    const sparse = {
      vehicle_id: 1,
      window: '1h',
      bucket: '1m',
      generated_at: '2026-07-04T00:00:00Z',
      fields: [],
      buckets: [{ bucket_start: '2026-07-04T00:00:00Z' }],
    } as unknown as IngestXRayResponse;

    renderHeader({ data: sparse, loading: false });

    expect(valueFor('Total samples')).toBe('0');
    expect(valueFor('Distinct fields')).toBe('0');
    expect(valueFor('Peak / bucket')).toBe('0');
    expect(valueFor('Avg / bucket')).toBe('0.0');
  });

  it('maps every window/bucket selection to its human label', () => {
    const { rerender } = renderHeader({
      windowSel: '5m',
      bucketSel: '30s',
    });
    expect(valueFor('Window')).toBe('5 minutes');
    expect(valueFor('Bucket')).toBe('30 seconds');

    rerender(
      <XRayHeader
        data={undefined}
        loading={false}
        windowSel="24h"
        bucketSel="1h"
      />,
    );
    expect(valueFor('Window')).toBe('24 hours');
    expect(valueFor('Bucket')).toBe('1 hour');
  });

  it('falls back to the raw selection when the label map has no entry', () => {
    // Guards against a stale/persisted selection value that is no longer a
    // known literal — the operator must see the raw token, never a raw i18n
    // key like "admin.xray.windowLabel.99z".
    renderHeader({
      windowSel: '99z' as IngestXRayWindow,
      bucketSel: '7d' as IngestXRayBucket,
    });

    expect(valueFor('Window')).toBe('99z');
    expect(valueFor('Bucket')).toBe('7d');
    expect(valueFor('Window')).not.toContain('admin.xray');
  });
});
