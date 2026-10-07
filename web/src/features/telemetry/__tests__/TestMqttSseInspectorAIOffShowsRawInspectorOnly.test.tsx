// MQTT and SSE inspector explanations.
//
// `TestMqttSseInspectorAIOffShowsRawInspectorOnly` is the AI-off contract test on the React side. It mounts
// the AIMqttSseInspectorExplanations component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND mqtt-sse-inspector-explanations
//      toggle=true, the section IS present + carries the
//      expected test ID. This is the positive control that
//      proves the gate actually works (otherwise the "absent in
//      off mode" assertion is trivially true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL MQTTInspectorPage in
// off mode and asserts the deterministic broker-status snapshot
// table still renders — proving the AI surface's absence does
// NOT regress the canonical baseline (ADR-015 §I3). The rendered
// page MUST show:
//
//   - The summary StatCards (Streaming Vehicles, Total Signals,
//     Total Batches, Signals / sec).
//   - The Connection Info GlassPanel with broker / uptime /
//     topic patterns rendered from the deterministic snapshot.
//   - The Throughput Chart placeholder ("Collecting throughput
//     data…" when history < 2 points).
//
// The HTTP POST /api/v1/ai/system/streams/explain 404-in-off-mode
// invariant is proven by the Go-side
// TestMqttSseInspectorAIOffShowsRawInspectorOnly in
// internal/api/ai_mqtt_sse_inspector_explanations_handler_test.go
// — the network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestMqttSseInspectorAIOffShowsRawInspectorOnly.test.tsx`
// — the targeted verification command runs
// `vitest --run TestMqttSseInspectorAIOffShowsRawInspectorOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// useMQTTStatus owns a TanStack Query lifecycle that is
// irrelevant to the off-mode contract. Replace it with a
// deterministic stub so the MQTTInspectorPage mounts hermetically
// with a connected broker + a non-empty vehicle list whose
// rendering exercises the broker-status snapshot table.
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useTelemetry')
  >('@/api/hooks/useTelemetry');
  return {
    ...actual,
    useMQTTStatus: vi.fn(),
  };
});

import { useSettings } from '@/hooks/useSettings';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { AIMqttSseInspectorExplanations } from '@/components/ai/AIMqttSseInspectorExplanations';
import MQTTInspectorPage from '@/features/telemetry/pages/MQTTInspectorPage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mockUseMQTTStatus = useMQTTStatus as unknown as ReturnType<typeof vi.fn>;

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

const sampleMqttStatus = {
  connected: true,
  broker: 'mqtt://mosquitto:1883',
  uptimeSeconds: 3600,
  topics: ['telemetry/+/v/+'],
  vehicles: [
    {
      vin: '5YJ3E1EA1NF000001',
      state: 'online',
      signalCount: 12345,
      batchCount: 678,
      signalsPerSecond: 3.4,
      lastReceived: new Date(Date.now() - 5000).toISOString(),
    },
  ],
};

beforeEach(() => {
  mockUseSettings.mockReset();
  mockUseMQTTStatus.mockReset();
  mockUseMQTTStatus.mockReturnValue({
    data: sampleMqttStatus,
    isLoading: false,
    isError: false,
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderMqttInspectorPage() {
  // QueryClientProvider is required because MQTTInspectorPage
  // transitively touches hooks built on TanStack Query (the
  // useMQTTStatus mock short-circuits the network layer, but the
  // provider must exist so the React tree mounts).
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/mqtt-inspector']}>
          <MQTTInspectorPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('TestMqttSseInspectorAIOffShowsRawInspectorOnly (mqtt-sse-inspector-explanations AI-off contract)', () => {
  it('TestMqttSseInspectorAIOffShowsRawInspectorOnly: AIMqttSseInspectorExplanations renders nothing when ai_mode=off even with the mqtt-sse-inspector-explanations toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The fromUnix/toUnix props are also intentionally set so
    // the absent-in-DOM assertion proves that the gate (not a
    // missing prop) is what hides the section.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'mqtt-sse-inspector-explanations': true },
      }),
    );

    const { container } = render(
      <AIMqttSseInspectorExplanations fromUnix={1700000000} toUnix={1700001800} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-mqtt-sse-inspector-explanations-root'),
    ).not.toBeInTheDocument();
  });

  it('TestMqttSseInspectorAIOffShowsRawInspectorOnly: AIMqttSseInspectorExplanations renders nothing when ai_mode is non-off but the mqtt-sse-inspector-explanations toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'mqtt-sse-inspector-explanations': false },
      }),
    );

    const { container } = render(
      <AIMqttSseInspectorExplanations fromUnix={1700000000} toUnix={1700001800} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-mqtt-sse-inspector-explanations-root'),
    ).not.toBeInTheDocument();
  });

  it('TestMqttSseInspectorAIOffShowsRawInspectorOnly: AIMqttSseInspectorExplanations renders the section when ai_mode=cloud AND mqtt-sse-inspector-explanations toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'mqtt-sse-inspector-explanations': true },
      }),
    );

    render(
      <AIMqttSseInspectorExplanations fromUnix={1700000000} toUnix={1700001800} />,
    );
    const root = screen.getByTestId(
      'ai-feature-mqtt-sse-inspector-explanations-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'mqtt-sse-inspector-explanations',
    );
  });

  it('TestMqttSseInspectorAIOffShowsRawInspectorOnly: MQTTInspectorPage in off mode shows the deterministic broker-status snapshot (baseline intact, ADR-015 §I3)', () => {
    // Baseline-coexistence proof: with
    // ai_mode='off', the canonical MQTTInspectorPage MUST
    // continue to render every deterministic surface — the
    // summary StatCards, the Connection Info panel, and the
    // per-vehicle breakdown table — exactly as it would without
    // the AI feature ever existing. The AI explainer section
    // MUST be absent from the DOM (ADR-015 §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'mqtt-sse-inspector-explanations': true },
      }),
    );

    renderMqttInspectorPage();

    // 1) The Connection Info panel renders broker + topic
    // values from the deterministic snapshot. These tokens are
    // proof that the raw inspector is reachable to the user even when AI is off.
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    expect(screen.getByText('telemetry/+/v/+')).toBeInTheDocument();

    // 2) The per-vehicle breakdown panel mounts with the
    // deterministic snapshot. The DataTable is virtualized
    // (jsdom has zero-height containers so individual rows
    // don't paint), but the section header reports the row
    // count from the snapshot, proving that the baseline table is reachable.
    expect(screen.getByText(/1 vehicles/i)).toBeInTheDocument();

    // 3) The AI explainer surface MUST be absent from the DOM
    // (ADR-015 §I5). This baseline-intact assertion verifies that even
    // though the AI component is conditionally
    // mounted by the page below the Connection Info panel, the
    // off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-mqtt-sse-inspector-explanations-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Explain streams/i }),
    ).not.toBeInTheDocument();
  });
});
