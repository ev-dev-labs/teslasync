// Comprehensive unit + wiring coverage for AISmartChargeScheduleSuggestion.
//
// AISmartChargeScheduleSuggestion is the propose-only smart-charge AI
// surface on the SmartChargePage. `withAiFeature('smart-charge-schedule-
// suggestion', …)` gates its visibility per the ADR-015 AI-Off Contract,
// and the inner card wires a "Draft a schedule" button to POST
// /api/v1/ai/charging/schedule/draft via useAiStream.
//
// The file exports a single symbol (the wrapped component), so this suite
// exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the vehicleId + ratePlanId → canStart validation that mirrors the
//     backend parseDraftBody contract (positive-integer vehicle_id and a
//     non-empty rate_plan_id only — zero, negative, decimal, non-numeric,
//     whitespace, and empty are rejected so the button never fires a
//     request the handler 400s),
//   - the wired SSE POST (route, method, headers, body shape, delta render),
//   - the exact draftRequest body shape (no unknown fields — the handler
//     decodes with DisallowUnknownFields),
//   - vehicleId normalization (leading-zero + whitespace) and rate-plan
//     trimming into the request body,
//   - server-valid defaults for every optional field,
//   - depart_by RFC3339 normalization + now-fallback,
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AIChargingDiagnosis wiring test uses.
// `@testing-library/user-event` is not a dependency of this codebase
// (web/package.json), so interactions go through fireEvent, consistent
// with the other AI SSE-wiring suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AISmartChargeScheduleSuggestion } from './AISmartChargeScheduleSuggestion';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// A complete AppSettings with realistic non-AI defaults. Per-test
// overrides flip ai_mode + the per-feature toggle to walk the gate.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
};

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } };
}

// enableFeature turns the gate fully on so the inner card renders.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'smart-charge-schedule-suggestion': true },
    }),
  );
}

// makeReadableStream turns text chunks into the byte-stream shape
// useAiStream's reader consumes.
function makeReadableStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

// sseFrame formats one SSE event exactly like internal/ai/stream/writer.go.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// installFetch records every call and replies with the given SSE body.
function installFetch(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

const DONE = sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });

const ROOT_TESTID = 'ai-feature-smart-charge-schedule-suggestion-root';
const ROUTE = '/api/v1/ai/charging/schedule/draft';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb as the button's accessible name, so we locate it by
// /Draft a schedule/ regardless of the visible label.
const DRAFT = /Draft a schedule/i;

// The exact key set the backend draftRequest struct accepts. The handler
// decodes with json.Decoder.DisallowUnknownFields(), so ANY extra key
// would 400 the request — this list is the regression net for that.
const EXPECTED_BODY_KEYS = [
  'battery_capacity_kwh',
  'charger_voltage',
  'current_soc',
  'depart_by',
  'max_amps',
  'prefer_off_peak',
  'rate_plan_id',
  'target_soc',
  'vehicle_id',
];

beforeEach(() => {
  mockUseSettings.mockReset();
  // Default fetch mock complains if a test forgets to install its own,
  // turning miswiring into a clear failure instead of a silent hang.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AISmartChargeScheduleSuggestion — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on and valid inputs', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'smart-charge-schedule-suggestion': true },
      }),
    );

    const { container } = render(
      <AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DRAFT })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'smart-charge-schedule-suggestion': false },
      }),
    );

    const { container } = render(
      <AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the draft card (title, description, Helix badge, Draft button) when fully enabled', () => {
    enableFeature();

    render(<AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'smart-charge-schedule-suggestion');

    expect(
      screen.getByRole('heading', { name: /Draft a schedule with Helix/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/time-of-use-optimized charge schedule/i);
    // Badge label is exactly "Helix" (the button's visible CTA is
    // "Ask Helix", so it is not an exact-text match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: DRAFT });
    expect(button).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AISmartChargeScheduleSuggestion — canStart validation (mirrors backend parseDraftBody)', () => {
  // Every vehicleId the backend's parseDraftBody would reject with a 400
  // (vehicle_id must be > 0) must leave the Draft button disabled so the
  // SPA never fires a doomed request. `!!vehicleId` (the pre-hardening
  // guard) wrongly enabled "0", "-5", "abc", "42.5", and whitespace —
  // these cases are the regression net for that fix.
  const disabledVehicleIds: Array<[string, string | number | undefined]> = [
    ['undefined (no vehicle selected yet)', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['string zero', '0'],
    ['numeric zero', 0],
    ['a negative id', '-5'],
    ['a non-numeric id', 'abc'],
    ['a decimal string id', '42.5'],
    ['a decimal number id', 42.5],
  ];

  it.each(disabledVehicleIds)(
    'disables Draft when vehicleId is %s (even with a valid rate plan)',
    (_label, vehicleId) => {
      enableFeature();

      render(
        <AISmartChargeScheduleSuggestion vehicleId={vehicleId} ratePlanId="tou-a" />,
      );

      const button = screen.getByRole('button', { name: DRAFT });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
    },
  );

  const disabledRatePlans: Array<[string, string | undefined]> = [
    ['undefined (plans not loaded yet)', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ];

  it.each(disabledRatePlans)(
    'disables Draft when ratePlanId is %s (even with a valid vehicle)',
    (_label, ratePlanId) => {
      enableFeature();

      render(
        <AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId={ratePlanId} />,
      );

      const button = screen.getByRole('button', { name: DRAFT });
      expect(button).toBeDisabled();
      // The empty-state hint replaces the button affordance's silence.
      expect(
        screen.getByText(/Select a vehicle and a rate plan to draft a schedule/i),
      ).toBeInTheDocument();
    },
  );

  it('enables Draft for a positive-integer numeric vehicleId + non-empty rate plan', () => {
    enableFeature();

    render(<AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />);

    const button = screen.getByRole('button', { name: DRAFT });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('enables Draft for a positive-integer string vehicleId + rate plan with surrounding whitespace', () => {
    enableFeature();

    render(
      <AISmartChargeScheduleSuggestion vehicleId="42" ratePlanId="  tou-a  " />,
    );

    const button = screen.getByRole('button', { name: DRAFT });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('AISmartChargeScheduleSuggestion — wired SSE POST', () => {
  it('clicking Draft POSTs exactly once to the draft route with the normalized draftRequest body', async () => {
    enableFeature();

    const sseBody =
      sseFrame('delta', {
        text: 'Proposed window: 01:20–04:05 on the off-peak tier, adding 42 kWh.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 210, out: 88 } });
    const calls = installFetch(sseBody);

    // "007" exercises leading-zero normalization; the padded rate plan
    // exercises trimming; preferOffPeak={false} exercises the non-default
    // boolean path.
    const departBy = '2026-07-05T14:30';
    render(
      <AISmartChargeScheduleSuggestion
        vehicleId="007"
        targetSoc={90}
        currentSoc={35}
        departBy={departBy}
        ratePlanId="  tou-a  "
        maxAmps={40}
        batteryCapacityKwh={82}
        chargerVoltage={208}
        preferOffPeak={false}
      />,
    );

    const button = screen.getByRole('button', { name: DRAFT });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(calls).toHaveLength(1));
    const { url, init } = calls[0];
    expect(url).toBe(ROUTE);
    expect(init?.method).toBe('POST');

    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    const parsed = JSON.parse(init?.body as string) as Record<string, unknown>;
    // No unknown fields — the handler decodes with DisallowUnknownFields.
    expect(Object.keys(parsed).sort()).toEqual([...EXPECTED_BODY_KEYS].sort());
    expect(parsed).toEqual({
      vehicle_id: 7, // "007" → 7
      target_soc: 90,
      depart_by: new Date(departBy).toISOString(),
      rate_plan_id: 'tou-a', // trimmed
      max_amps: 40,
      battery_capacity_kwh: 82,
      charger_voltage: 208,
      prefer_off_peak: false,
      current_soc: 35,
    });
    // vehicle_id must be a JSON number (int64 on the wire), not a string.
    expect(typeof parsed.vehicle_id).toBe('number');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Proposed window/i,
      );
    });
  });

  it('applies server-valid defaults for every omitted optional field', async () => {
    enableFeature();

    const calls = installFetch(DONE);

    const before = Date.now();
    render(<AISmartChargeScheduleSuggestion vehicleId={5} ratePlanId="tou-b" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT }));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    const parsed = JSON.parse(calls[0].init?.body as string) as Record<string, unknown>;

    expect(parsed.vehicle_id).toBe(5);
    expect(parsed.rate_plan_id).toBe('tou-b');
    expect(parsed.target_soc).toBe(80);
    expect(parsed.current_soc).toBe(20);
    expect(parsed.max_amps).toBe(32);
    expect(parsed.battery_capacity_kwh).toBe(75);
    expect(parsed.charger_voltage).toBe(240);
    expect(parsed.prefer_off_peak).toBe(true);

    // depart_by falls back to "now" as a valid RFC3339 timestamp the
    // handler's time.Parse(RFC3339) accepts.
    const departMs = Date.parse(parsed.depart_by as string);
    expect(Number.isNaN(departMs)).toBe(false);
    expect(departMs).toBeGreaterThanOrEqual(before - 1000);
    expect(departMs).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('does not fire a request when inputs are invalid, even if the disabled button is clicked', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(makeReadableStream([DONE]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    // "0" is truthy as a string, so the pre-hardening `!!vehicleId` guard
    // would have enabled the button and POSTed vehicle_id: 0 — which the
    // backend rejects with 400.
    render(<AISmartChargeScheduleSuggestion vehicleId="0" ratePlanId="tou-a" />);

    const button = screen.getByRole('button', { name: DRAFT });
    expect(button).toBeDisabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchCount).toBe(0);
  });

  it('a second click while streaming does not open a second stream (double-submit guard)', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      // Never enqueue, never close — keeps state === 'streaming'.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />);

    const button = screen.getByRole('button', { name: DRAFT });

    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // Streaming disables the button (computed from stream.state), and
    // useAiStream's runningRef coalesces duplicate start() calls.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('surfaces a terminal Helix error in the output panel when the stream responds non-2xx', async () => {
    enableFeature();

    globalThis.fetch = vi.fn(async () =>
      new Response('bad request', { status: 400 }),
    ) as unknown as typeof globalThis.fetch;

    render(<AISmartChargeScheduleSuggestion vehicleId={42} ratePlanId="tou-a" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT }));
    });

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel');
      expect(panel).toHaveTextContent(/Helix error/i);
      expect(panel).toHaveTextContent('stream_http_400');
    });
  });
});
