import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IngestOperationalBrief } from './IngestOperationalBrief';
import { DLQOperationalBrief } from './DLQOperationalBrief';
import { RedisOperationalBrief } from './RedisOperationalBrief';
import type { IngestXRayResponse } from '@/types/admin-diagnostics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace('{{title}}', String(options?.title ?? '')),
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', duration: 'h', power: 'W', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useDateFormat', () => ({ useDateFormat: () => ({ formatDateTime: (value: string) => value }) }));
afterEach(cleanup);

const snapshot: IngestXRayResponse = {
  vehicle_id: 1, window: '1h', bucket: '1m', generated_at: '2026-10-06T12:00:00Z',
  total_samples: 11, unique_fields: 1, fields: [],
  buckets: [{ bucket_start: '2026-10-06T11:58:00Z', count: 2 },
    { bucket_start: '2026-10-06T11:59:00Z', count: 9 }],
};

describe('shared OperationalBrief source-state integration', () => {
  it('keeps unknown and real zero ingest measurements distinct with all six full contexts', () => {
    const { rerender } = render(<IngestOperationalBrief data={undefined} windowSel="1h" bucketSel="1m"
      enabled={false} loading={false} retained={false} />);
    const brief = screen.getByTestId('ingest-xray-operational-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(brief).toHaveTextContent('No vehicle selected');
    expect(brief).toHaveTextContent('observation horizon');
    expect(brief).toHaveTextContent('aggregation interval');
    expect(brief).toHaveTextContent('Exact query bounds are not supplied');
    rerender(<IngestOperationalBrief data={{ ...snapshot, total_samples: 0, unique_fields: 0, buckets: [] }}
      windowSel="1h" bucketSel="1m" enabled loading={false} retained />);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
    expect(screen.getByTestId('ingest-xray-summary')).toHaveAttribute('data-retained', 'true');
    expect(brief.querySelector('[data-operational-metric="samples"] [data-operational-value]')).toHaveTextContent('0');
    expect(brief).toHaveTextContent('Generated at: 2026-10-06T12:00:00Z');
  });

  it('exposes first-load skeletons but retains real measurements on a later failed read', () => {
    const { rerender } = render(<IngestOperationalBrief data={undefined} windowSel="1h" bucketSel="1m"
      enabled loading retained={false} />);
    const brief = screen.getByTestId('ingest-xray-operational-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief).toHaveTextContent('Loading measurements');
    rerender(<IngestOperationalBrief data={snapshot} windowSel="1h" bucketSel="1m" enabled loading retained />);
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    expect(brief.querySelector('[data-operational-metric="mean"]')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(brief).toHaveTextContent('Retained measurements');
  });

  it('does not announce disabled DLQ replay or healthy status from a failed or missing list', () => {
    const { rerender } = render(<DLQOperationalBrief data={undefined} loading={false} retained={false}
      error={new Error('List failed')} />);
    const brief = screen.getByTestId('dlq-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(brief).toHaveTextContent('Read failed');
    expect(screen.queryByText('DLQ replay is disabled')).not.toBeInTheDocument();
    expect(brief).not.toHaveTextContent('Disabled');
    rerender(<DLQOperationalBrief data={{ count: 0, entries: [], replay_enabled: false }} loading={false} retained={false} />);
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    expect(brief).toHaveTextContent('Source loaded');
    expect(brief).toHaveTextContent('Disabled');
    expect(screen.getByText('DLQ replay is disabled')).toBeInTheDocument();
    expect(brief).toHaveTextContent('DLQ_REPLAY_ENABLED env');
  });

  it('keeps Redis unknown metadata unknown while confirmed empty counts stay zero', () => {
    const { rerender } = render(<RedisOperationalBrief data={undefined} enabled={false} loading={false} retained={false} />);
    const brief = screen.getByTestId('redis-signals-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    rerender(<RedisOperationalBrief data={{ vehicle_id: 1, signal_count: 0, signals: {} }} enabled loading={false} retained />);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(brief).toHaveTextContent('In-process store · L1 last seen: —');
    expect(brief).toHaveTextContent('Redis HSET · L2 last seen: —');
    expect(brief).toHaveTextContent('Cached signals');
    expect(screen.getByTestId('redis-signals-summary')).toHaveAttribute('data-retained', 'true');
  });

  it('opens the actual review drawer with full source captions and numeric values, then closes it', () => {
    render(<DLQOperationalBrief data={{ count: 0, entries: [], replay_enabled: true }} loading={false} retained={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Dead-letter queue summary details' });
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getByText('Enabled')).toBeInTheDocument();
    expect(within(drawer).getByText('DLQ_REPLAY_ENABLED env')).toBeInTheDocument();
    expect(within(drawer).getByText('raw bytes queued')).toBeInTheDocument();
    expect(within(drawer).getByText('0 B')).toBeInTheDocument();
    const close = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(close[close.length - 1]);
    expect(screen.queryByRole('dialog', { name: 'Dead-letter queue summary details' })).not.toBeInTheDocument();
  });
});
