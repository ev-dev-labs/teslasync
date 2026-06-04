// State-machine debugger narrator.
//
// `TestStateMachineNarratorAIOffShowsDebuggerOnly` is the
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIStateMachineDebuggerNarrator component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND state-machine-debugger-narrator
//      toggle=true, the section IS present + carries the
//      expected test ID. This is the positive control that
//      proves the gate actually works (otherwise the "absent in
//      off mode" assertion is trivially true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section, proving per-feature opt-in.
//
// In addition, this file asserts the canonical StateMachineDebuggerPage
// baseline surfaces (transition table, state diagram, FSM health
// panel, timeline chart) are NOT replaced or hidden by this
// feature. Because the full StateMachineDebuggerPage transitively
// owns ~15 hooks, the baseline-coexistence half of the proof is
// covered by the Go-side
// TestStateMachineNarratorAIOffShowsDebuggerOnly in
// internal/api/ai_state_machine_debugger_narrator_handler_test.go,
// which proves the baseline `/api/v1/fsm/transitions` snapshot
// route remains reachable when ai_mode='off' AND the AI route
// returns 404.
//
// The HTTP POST /api/v1/ai/system/fsm/narrate 404-in-off-mode
// invariant is proven by the Go-side
// TestStateMachineNarratorAIOffShowsDebuggerOnly in
// internal/api/ai_state_machine_debugger_narrator_handler_test.go
// — the network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestStateMachineNarratorAIOffShowsDebuggerOnly.test.tsx`
// — the targeted verification command runs
// `vitest --run TestStateMachineNarratorAIOffShowsDebuggerOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIStateMachineDebuggerNarrator } from '@/components/ai/AIStateMachineDebuggerNarrator';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  mockUseSettings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestStateMachineNarratorAIOffShowsDebuggerOnly (state-machine-debugger-narrator AI-off contract)', () => {
  it('TestStateMachineNarratorAIOffShowsDebuggerOnly: AIStateMachineDebuggerNarrator renders nothing when ai_mode=off even with the state-machine-debugger-narrator toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle, proving per-feature opt-in.
    //
    // The vehicleId/fromUnix/toUnix props are also intentionally
    // set so the absent-in-DOM assertion proves that the gate
    // (not a missing prop) is what hides the section.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'state-machine-debugger-narrator': true },
      }),
    );

    const { container } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={42}
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-state-machine-debugger-narrator-root'),
    ).not.toBeInTheDocument();
    // Defence-in-depth: the visible AI verb MUST be absent from
    // the DOM in off mode. Use an unanchored regex per the HX
    // addendum — the accessible name reads "Ask Helix · <verb>"
    // when the card paints (positive control below).
    expect(
      screen.queryByRole('button', { name: /Narrate transitions/i }),
    ).not.toBeInTheDocument();
  });

  it('TestStateMachineNarratorAIOffShowsDebuggerOnly: AIStateMachineDebuggerNarrator renders nothing when ai_mode is non-off but the state-machine-debugger-narrator toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // proving per-feature opt-in.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'state-machine-debugger-narrator': false },
      }),
    );

    const { container } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={42}
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-state-machine-debugger-narrator-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Narrate transitions/i }),
    ).not.toBeInTheDocument();
  });

  it('TestStateMachineNarratorAIOffShowsDebuggerOnly: AIStateMachineDebuggerNarrator renders the section when ai_mode=cloud AND state-machine-debugger-narrator toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'state-machine-debugger-narrator': true },
      }),
    );

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={42}
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );
    const root = screen.getByTestId(
      'ai-feature-state-machine-debugger-narrator-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'state-machine-debugger-narrator',
    );
    // Visible button uses the per-feature verb ("Narrate
    // transitions") inside the accessible name (which reads
    // "Ask Helix · Narrate transitions" once the HX card paints).
    // The regex MUST be unanchored per the HX addendum.
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeInTheDocument();
  });
});
