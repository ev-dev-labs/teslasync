import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FSMStateDiagram } from './FSMStateDiagram';
import type { FSMTransition } from '@/types/fsm';

// Deterministic i18n: every `t(key, fallback)` resolves to the English
// fallback so assertions can target the human-readable copy. Mirrors the
// convention used by the sibling StateTimeline test.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

// Multiplication sign used in the edge-summary count chips (`×N`). Built
// from its code point so the assertion is immune to source-encoding drift.
const MUL = '\u00d7';

let nextId = 1;
function mk(overrides: Partial<FSMTransition>): FSMTransition {
  return {
    id: nextId++,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_detected',
    ts: '2025-01-01T10:00:00Z',
    ...overrides,
  };
}

const VEHICLE_STATE_NAMES = [
  'online',
  'driving',
  'charging',
  'parked',
  'updating',
  'asleep',
  'offline',
] as const;

describe('FSMStateDiagram', () => {
  it('renders the select-a-type placeholder for the aggregate "all" view', () => {
    render(<FSMStateDiagram fsmType="all" transitions={[]} />);

    expect(
      screen.getByRole('heading', { name: 'State Diagram' }),
    ).toBeInTheDocument();
    // EmptyState renders with role="status".
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText('Select a specific FSM type to view its state diagram'),
    ).toBeInTheDocument();
    // No state graph is rendered in the placeholder branch.
    expect(screen.queryByTestId('fsm-node-online')).not.toBeInTheDocument();
  });

  it('renders the placeholder for an FSM type with no registered states', () => {
    render(<FSMStateDiagram fsmType="does_not_exist" transitions={[]} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('fsm-node-driving')).not.toBeInTheDocument();
  });

  it('renders every registered state node and hides the edge summary with no data', () => {
    render(<FSMStateDiagram fsmType="vehicle" transitions={[]} />);

    for (const state of VEHICLE_STATE_NAMES) {
      expect(screen.getByTestId(`fsm-node-${state}`)).toBeInTheDocument();
    }
    // No transitions => no edge summary and no "current" marker.
    expect(screen.queryByTestId('fsm-edge-summary')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('marks the decorative arrows and status dots as aria-hidden', () => {
    render(<FSMStateDiagram fsmType="vehicle" transitions={[]} />);

    // 7 states => 6 connecting arrows, all hidden from the a11y tree.
    const svgs = document.querySelectorAll('svg');
    expect(svgs).toHaveLength(VEHICLE_STATE_NAMES.length - 1);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });

  it('tallies how many times each state participates (as source and target)', () => {
    const transitions = [
      mk({ from_state: 'parked', to_state: 'driving', ts: '2025-01-01T10:00:00Z' }),
      mk({ from_state: 'driving', to_state: 'parked', ts: '2025-01-01T11:00:00Z' }),
    ];
    render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);

    // parked: target once + source once = 2. driving: same = 2.
    expect(within(screen.getByTestId('fsm-node-parked')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('fsm-node-driving')).getByText('2')).toBeInTheDocument();
    // A state never touched shows no numeric badge.
    expect(within(screen.getByTestId('fsm-node-asleep')).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('flags the target of the newest transition as current (by timestamp, not array order)', () => {
    const transitions = [
      mk({ to_state: 'driving', ts: '2025-01-01T10:00:00Z' }),
      // Newest by timestamp but not last in the array — must still win.
      mk({ to_state: 'charging', ts: '2025-01-01T12:00:00Z' }),
      mk({ to_state: 'parked', ts: '2025-01-01T09:00:00Z' }),
      // Malformed timestamp must be ignored, not crash or become "current".
      mk({ to_state: 'offline', ts: 'not-a-real-date' }),
    ];
    render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);

    const current = document.querySelector('[aria-current="true"]');
    expect(current).not.toBeNull();
    expect(current).toHaveAttribute('data-testid', 'fsm-node-charging');
    // Exactly one node is current, and it exposes an SR-only announcement.
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(within(current as HTMLElement).getByText('current state')).toBeInTheDocument();
    // The malformed-timestamp target did not hijack the current marker.
    expect(screen.getByTestId('fsm-node-offline')).not.toHaveAttribute('aria-current');
  });

  it('ignores transitions whose fsm_name does not match the selected type', () => {
    const transitions = [
      mk({ fsm_name: 'vehicle', from_state: 'online', to_state: 'driving', ts: '2025-01-01T10:00:00Z' }),
      // Later, but a different FSM — must be filtered out entirely.
      mk({ fsm_name: 'charge_session', from_state: 'driving', to_state: 'charging', ts: '2025-01-01T11:00:00Z' }),
    ];
    render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);

    // Only the vehicle transition contributes: online source count = 1 (not 2).
    expect(within(screen.getByTestId('fsm-node-online')).getByText('1')).toBeInTheDocument();
    // charging is untouched because the charge_session row was filtered.
    expect(within(screen.getByTestId('fsm-node-charging')).queryByText(/\d/)).not.toBeInTheDocument();
    // The current marker follows the vehicle row (driving), not the later charge row.
    expect(screen.getByTestId('fsm-node-driving')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('fsm-node-charging')).not.toHaveAttribute('aria-current');

    const summary = screen.getByTestId('fsm-edge-summary');
    expect(within(summary).getAllByText('\u2192')).toHaveLength(1);
    expect(within(summary).queryByText('charging')).not.toBeInTheDocument();
  });

  it('sorts the edge summary by descending frequency', () => {
    const transitions = [
      // online->driving x3
      mk({ from_state: 'online', to_state: 'driving', ts: '2025-01-01T10:00:00Z' }),
      mk({ from_state: 'online', to_state: 'driving', ts: '2025-01-01T10:01:00Z' }),
      mk({ from_state: 'online', to_state: 'driving', ts: '2025-01-01T10:02:00Z' }),
      // charging->parked x2
      mk({ from_state: 'charging', to_state: 'parked', ts: '2025-01-01T10:03:00Z' }),
      mk({ from_state: 'charging', to_state: 'parked', ts: '2025-01-01T10:04:00Z' }),
      // driving->charging x1
      mk({ from_state: 'driving', to_state: 'charging', ts: '2025-01-01T10:05:00Z' }),
    ];
    render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);

    const summary = screen.getByTestId('fsm-edge-summary');
    const chips = within(summary).getAllByText(new RegExp(`^${MUL}\\d+$`));
    expect(chips.map((c) => c.textContent)).toEqual([`${MUL}3`, `${MUL}2`, `${MUL}1`]);
  });

  it('caps the edge summary at the ten most frequent edges', () => {
    const pairs: [string, string][] = [
      ['online', 'driving'],
      ['driving', 'charging'],
      ['charging', 'parked'],
      ['parked', 'updating'],
      ['updating', 'asleep'],
      ['asleep', 'offline'],
      ['offline', 'online'],
      ['online', 'charging'],
      ['driving', 'parked'],
      ['charging', 'updating'],
      ['parked', 'asleep'],
      ['updating', 'offline'],
    ];
    expect(pairs.length).toBeGreaterThan(10);
    const transitions = pairs.map(([from_state, to_state], i) =>
      mk({ from_state, to_state, ts: `2025-01-01T10:${String(i).padStart(2, '0')}:00Z` }),
    );
    render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);

    const summary = screen.getByTestId('fsm-edge-summary');
    expect(within(summary).getAllByText('\u2192')).toHaveLength(10);
  });

  it('does not crash when the transitions prop is omitted', () => {
    render(<FSMStateDiagram fsmType="vehicle" />);

    expect(screen.getByTestId('fsm-node-online')).toBeInTheDocument();
    expect(screen.queryByTestId('fsm-edge-summary')).not.toBeInTheDocument();
  });
});
