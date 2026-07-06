/**
 * StatusHeader — DLQ Inspector KPI band contract.
 *
 * `StatusHeader` is a pure, prop-driven presentational band (no network of
 * its own — the page hands it the `useDLQList()` payload). These tests pin,
 * facet by facet:
 *
 *   - the six derived KPIs (total / replayable / blocked / distinct reasons /
 *     total payload / replay mode) render the right values from one payload;
 *   - the `blocked` tally clamps at 0 and never renders a negative number;
 *   - empty / whitespace reasons collapse into a single "unknown" bucket and
 *     surrounding whitespace is trimmed before de-duping;
 *   - a fetch error degrades EVERY metric to an em-dash (never a lying "0")
 *     and suppresses the disabled-replay warning;
 *   - the loading state renders skeletons instead of labels and hides the
 *     banner;
 *   - the warning banner appears only when a loaded payload actually reports
 *     `replay_enabled: false` — an indeterminate (undefined) payload must NOT
 *     flash the HTTP-403 warning;
 *   - the band is an accessible, labelled region.
 *
 * i18n is stubbed to return each call's default string so the assertions can
 * match the shipped English copy without booting the real i18n backend.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { StatusHeader } from './StatusHeader';
import type { DLQEntrySummary, DLQListResponse } from '@/types/admin-diagnostics';

function entry(over: Partial<DLQEntrySummary> = {}): DLQEntrySummary {
  return {
    id: 1,
    arrived_at: '2026-01-01T00:00:00Z',
    dlq_topic: 'dlq/telemetry',
    parsed_reason: 'codec',
    parsed_vehicle_id: null,
    parsed_vin: null,
    parsed_source_topic: null,
    parsed_redeliveries: null,
    parsed_timestamp: null,
    parse_error: null,
    replayable: true,
    raw_payload_size: 100,
    inner_payload_size: 50,
    ...over,
  };
}

function response(over: Partial<DLQListResponse> = {}): DLQListResponse {
  const entries = over.entries ?? [entry()];
  return {
    count: over.count ?? entries.length,
    replay_enabled: over.replay_enabled ?? true,
    entries,
  };
}

/** Full text of the StatCard (label + value + sublabel) for a given label. */
function cardText(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement?.parentElement?.textContent ?? '';
}

const DASH = '—';

describe('StatusHeader', () => {
  it('derives all six KPIs from a single payload', () => {
    const data = response({
      count: 3,
      replay_enabled: true,
      entries: [
        entry({ id: 1, replayable: true, parsed_reason: 'codec', raw_payload_size: 100 }),
        entry({ id: 2, replayable: true, parsed_reason: 'codec', raw_payload_size: 200 }),
        entry({ id: 3, replayable: false, parsed_reason: 'schema', raw_payload_size: 300 }),
      ],
    });

    render(<StatusHeader data={data} loading={false} />);

    expect(cardText('Total entries')).toContain('3');
    expect(cardText('Replayable')).toContain('2');
    expect(cardText('Blocked')).toContain('1');
    // Distinct reasons: {codec, schema} → 2.
    expect(cardText('Distinct reasons')).toContain('2');
    // 100 + 200 + 300 = 600 bytes, below 1 KiB → "600 B".
    expect(cardText('Total payload')).toContain('600 B');
    expect(cardText('Replay mode')).toContain('Enabled');

    // Replay is enabled → no disabled warning.
    expect(screen.queryByText('DLQ replay is disabled')).not.toBeInTheDocument();
    // Accessible, labelled region.
    expect(
      screen.getByRole('region', { name: 'Dead-letter queue summary' }),
    ).toBeInTheDocument();
  });

  it('clamps the blocked tally at zero, never rendering a negative number', () => {
    // `count` deliberately trails the entries list (a stale count vs a fresher
    // set). blocked = max(0, 1 - 2) must clamp to 0, not "-1".
    const data = response({
      count: 1,
      replay_enabled: true,
      entries: [entry({ id: 1, replayable: true }), entry({ id: 2, replayable: true })],
    });

    render(<StatusHeader data={data} loading={false} />);

    expect(cardText('Replayable')).toContain('2');
    expect(cardText('Blocked')).toContain('0');
    expect(cardText('Blocked')).not.toContain('-1');
  });

  it('collapses empty / whitespace reasons into one "unknown" bucket and trims before de-duping', () => {
    const data = response({
      replay_enabled: true,
      entries: [
        entry({ id: 1, parsed_reason: '' }),
        entry({ id: 2, parsed_reason: '   ' }),
        entry({ id: 3, parsed_reason: 'codec' }),
        entry({ id: 4, parsed_reason: ' codec ' }),
      ],
    });

    render(<StatusHeader data={data} loading={false} />);

    // '' and '   ' → single "unknown"; ' codec ' trims to 'codec' → 2 distinct.
    expect(cardText('Distinct reasons')).toContain('2');
  });

  it('shows the disabled-replay warning and "Disabled" mode when replay is off', () => {
    const data = response({ replay_enabled: false, entries: [entry()] });

    render(<StatusHeader data={data} loading={false} />);

    expect(cardText('Replay mode')).toContain('Disabled');
    expect(screen.getByText('DLQ replay is disabled')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
  });

  it('degrades every metric to an em-dash on error and suppresses the banner', () => {
    // Stale data is present (react-query keeps prior data on refetch error),
    // but the error must win: honest "—" placeholders, never the real numbers.
    const data = response({
      count: 5,
      replay_enabled: false,
      entries: [entry({ raw_payload_size: 1024 })],
    });

    render(<StatusHeader data={data} loading={false} error={new Error('boom')} />);

    expect(cardText('Total entries')).toContain(DASH);
    expect(cardText('Total entries')).not.toContain('5');
    expect(cardText('Total payload')).toContain(DASH);
    expect(cardText('Total payload')).not.toContain('KB');
    expect(cardText('Replay mode')).toContain(DASH);
    // Error suppresses the banner even though replay_enabled is false.
    expect(screen.queryByText('DLQ replay is disabled')).not.toBeInTheDocument();
  });

  it('renders skeletons (not labels or the banner) while loading', () => {
    const { container } = render(
      <StatusHeader data={undefined} loading={true} />,
    );

    // StatCard swaps its label/value for skeletons while loading.
    expect(screen.queryByText('Total entries')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('DLQ replay is disabled')).not.toBeInTheDocument();
  });

  it('does not flash the disabled warning for an indeterminate (undefined) payload', () => {
    // No payload yet, but not loading and no error: we cannot claim replay is
    // disabled, so the HTTP-403 warning must stay hidden. Numbers still render
    // honest zeros (no error → not dashes).
    render(<StatusHeader data={undefined} loading={false} />);

    expect(screen.queryByText('DLQ replay is disabled')).not.toBeInTheDocument();
    expect(cardText('Total entries')).toContain('0');
  });
});
