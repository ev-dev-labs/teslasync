import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { TransportAgreementResponse } from '@/api/types';
import { useTransportAgreement } from '@/api/hooks/useSignals';
import { TransportAgreementPanel, transportAgreementWindowHours } from './TransportAgreementPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? '')),
  }),
}));

vi.mock('@/api/hooks/useSignals', () => ({
  useTransportAgreement: vi.fn(),
}));

const mockUseTransportAgreement = vi.mocked(useTransportAgreement);

function response(
  overrides: Partial<TransportAgreementResponse> = {},
): TransportAgreementResponse {
  return {
    vehicle_id: 7,
    from: '2026-08-27T00:00:00Z',
    to: '2026-08-28T00:00:00Z',
    pair_tolerance_ms: 2000,
    row_limit: 10000,
    truncated: false,
    source_time_only: true,
    generated_at: '2026-08-28T00:00:01Z',
    status: 'measured',
    agreement_pct: 99.5,
    scanned_rows: 402,
    invalid_value_rows: 0,
    http_evidence_rows: 201,
    mqtt_evidence_rows: 201,
    comparable_pairs: 200,
    agreeing_pairs: 199,
    disagreeing_pairs: 1,
    fields: [
      {
        field: 'VehicleSpeed',
        status: 'measured',
        agreement_pct: 99.5,
        http_evidence_rows: 201,
        mqtt_evidence_rows: 201,
        comparable_pairs: 200,
        agreeing_pairs: 199,
        disagreeing_pairs: 1,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockUseTransportAgreement.mockReturnValue({
    data: response(),
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTransportAgreement>);
});

describe('TransportAgreementPanel', () => {
  it('renders measured agreement and per-signal evidence', () => {
    render(
      <TransportAgreementPanel
        vehicleId={7}
        from="2026-08-27T00:00:00Z"
        to="2026-08-28T00:00:00Z"
        enabled
      />,
    );

    expect(screen.getByRole('region', { name: 'HTTP / MQTT Agreement' })).toBeInTheDocument();
    expect(screen.getAllByText('99.5%').length).toBeGreaterThan(0);
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
    expect(screen.getByText('Disagreements: 1')).toBeInTheDocument();
    expect(screen.getByText('Producer time only; receipt fallbacks excluded')).toBeInTheDocument();
  });

  it('does not turn missing overlap into zero percent', () => {
    mockUseTransportAgreement.mockReturnValue({
      data: response({
        status: 'insufficient_overlap',
        agreement_pct: null,
        comparable_pairs: 0,
        agreeing_pairs: 0,
        disagreeing_pairs: 0,
        http_evidence_rows: 0,
        mqtt_evidence_rows: 5,
        fields: [],
      }),
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTransportAgreement>);

    render(
      <TransportAgreementPanel
        vehicleId={7}
        from="2026-08-27T00:00:00Z"
        to="2026-08-28T00:00:00Z"
        enabled
      />,
    );

    expect(screen.getByText('Not enough overlapping evidence')).toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('waits for the explicit signal query', () => {
    render(<TransportAgreementPanel vehicleId={7} from="" to="" enabled={false} />);

    expect(
      screen.getByText(
        'Run a signal query to audit HTTP and MQTT evidence for the same time window.',
      ),
    ).toBeInTheDocument();
  });
});

// ── Seven-day agreement limit ─────────────────────────────────────────────
// The audit endpoint caps its window at 168 hours and REJECTS anything wider
// (internal/api/signalinspect/handler.go). The 30-day / 90-day / all Signal Log
// presets therefore must not be sent: the panel keeps the submitted range as it
// is, withholds the request, and says so.
describe('TransportAgreementPanel seven-day limit', () => {
  it.each([
    ['thirty day preset', '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', 30],
    ['ninety day preset', '2026-04-02T00:00:00Z', '2026-07-01T00:00:00Z', 90],
    ['just over the cap', '2026-06-23T00:00:00Z', '2026-07-01T00:00:00Z', 8],
  ])('renders the limit state and issues no request for a %s', (_name, from, to, days) => {
    render(<TransportAgreementPanel vehicleId={7} from={from} to={to} enabled />);

    expect(screen.getByText('Agreement is limited to seven days')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Cross-transport agreement is evaluated over at most 7 days (168 hours). This query covers ${days} days and is kept exactly as submitted — the signal history below is unchanged. Re-run with a shorter range to audit HTTP and MQTT evidence.`,
      ),
    ).toBeInTheDocument();

    // The hook is still called (hooks are unconditional) but with enabled=false,
    // and with the UNCHANGED submitted window — the range is never narrowed.
    const call = mockUseTransportAgreement.mock.calls.at(-1);
    expect(call?.[0]).toBe(7);
    expect(call?.[1]).toEqual({ from, to });
    expect(call?.[2]).toBe(false);

    // Measured evidence from a previous render must not leak into the limit state.
    expect(screen.queryByText('VehicleSpeed')).toBeNull();
    expect(screen.queryAllByText('99.5%')).toHaveLength(0);
  });

  it('still queries at exactly the 168-hour boundary', () => {
    render(
      <TransportAgreementPanel
        vehicleId={7}
        from="2026-06-24T00:00:00Z"
        to="2026-07-01T00:00:00Z"
        enabled
      />,
    );

    expect(screen.queryByText('Agreement is limited to seven days')).toBeNull();
    expect(mockUseTransportAgreement.mock.calls.at(-1)?.[2]).toBe(true);
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
  });

  it('does not claim a limit before a query has been submitted', () => {
    render(
      <TransportAgreementPanel
        vehicleId={7}
        from="2026-04-02T00:00:00Z"
        to="2026-07-01T00:00:00Z"
        enabled={false}
      />,
    );

    expect(screen.queryByText('Agreement is limited to seven days')).toBeNull();
    expect(
      screen.getByText(
        'Run a signal query to audit HTTP and MQTT evidence for the same time window.',
      ),
    ).toBeInTheDocument();
  });

  it('defers an unusable range to the API instead of inventing a limit verdict', () => {
    render(<TransportAgreementPanel vehicleId={7} from="not-a-date" to="also-bad" enabled />);

    expect(screen.queryByText('Agreement is limited to seven days')).toBeNull();
    expect(mockUseTransportAgreement.mock.calls.at(-1)?.[2]).toBe(true);
  });

  it('surfaces the error state for an in-limit window that fails', () => {
    mockUseTransportAgreement.mockReturnValue({
      data: undefined,
      error: new Error('boom'),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTransportAgreement>);

    render(
      <MemoryRouter>
        <TransportAgreementPanel
          vehicleId={7}
          from="2026-06-30T00:00:00Z"
          to="2026-07-01T00:00:00Z"
          enabled
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Agreement is limited to seven days')).toBeNull();
    expect(screen.getByRole('region', { name: 'HTTP / MQTT Agreement' })).toBeInTheDocument();
  });
});

describe('transportAgreementWindowHours', () => {
  it.each([
    ['one day', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 24],
    ['seven days', '2026-06-24T00:00:00Z', '2026-07-01T00:00:00Z', 168],
    ['ninety days', '2026-04-02T00:00:00Z', '2026-07-01T00:00:00Z', 2160],
  ])('measures %s', (_name, from, to, want) => {
    expect(transportAgreementWindowHours(from, to)).toBe(want);
  });

  it.each([
    ['empty boundaries', '', ''],
    ['unparsable start', 'not-a-date', '2026-07-01T00:00:00Z'],
    ['unparsable end', '2026-07-01T00:00:00Z', 'not-a-date'],
    ['inverted window', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z'],
    ['zero-width window', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'],
  ])('returns null for %s', (_name, from, to) => {
    expect(transportAgreementWindowHours(from, to)).toBeNull();
  });
});
