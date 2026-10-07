/**
 * LiveSignalTail — behaviour + hardening coverage.
 *
 * LiveSignalTail is the pure-render scrolling tail shared by the Live Monitor
 * and the Signals workspace. Its state (entries / rate / paused) is owned by
 * `useLiveSignalStream`; the component only renders and surfaces controls, so
 * these specs drive it purely through props and assert its OWN behaviour:
 *
 *   1. The four stat cards derive the right figures (rate, buffer/max, unique,
 *      filtered) and collapse when showStats={false}.
 *   2. Each entry renders as a row: signal name (<code>), a type-tinted value,
 *      and a type <Badge>; all five columns are present.
 *   3. The signal-name filter is case-insensitive, updates the Filtered stat,
 *      and swaps the empty message between "Waiting…" (no entries) and
 *      "No signals match filter" (entries but no match).
 *   4. Pause / Clear / Auto-scroll controls fire their callbacks and reflect
 *      state (the pause label toggles; auto-scroll toggles aria-pressed).
 *   5. Title + headerExtra slots render only when supplied.
 *   6. Null-safety: an undefined `entries` prop renders the waiting state
 *      rather than throwing (LiveSignalMonitorPage hands us the raw hook
 *      buffer, which is undefined before the first SSE frame).
 *
 * The real shared UI (DataTable, StatCard, Button, Input, Badge, FadeIn) is
 * rendered — only react-i18next is mocked to resolve the developer fallback
 * strings, matching ../pages/SignalGapDetectorPage.test.tsx. Interactions use
 * fireEvent (user-event is not a dependency of this codebase — see
 * web/package.json).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// jsdom lacks matchMedia; framer-motion (<FadeIn> via useReducedMotion) reads
// it during render. Install a benign stub before any module imports it.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string so assertions read like the
// English UI (the real en.json values are identical to these fallbacks).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { LiveSignalTail, type LiveSignalTailProps } from './LiveSignalTail';
import type { SignalEntry } from '@/types/telemetry';

let idSeq = 0;
function makeEntry(over: Partial<SignalEntry> = {}): SignalEntry {
  idSeq += 1;
  return {
    id: idSeq,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    name: `signal_${idSeq}`,
    value: '1',
    type: 'number',
    ...over,
  };
}

function renderTail(over: Partial<LiveSignalTailProps> = {}) {
  const onPauseToggle = vi.fn();
  const onClear = vi.fn();
  const props: LiveSignalTailProps = {
    entries: [],
    rate: 0,
    paused: false,
    onPauseToggle,
    onClear,
    bufferMax: 500,
    ...over,
  };
  const utils = render(<LiveSignalTail {...props} />);
  return { ...utils, onPauseToggle, onClear, props };
}

// Scope a query to a single StatCard by its label — the Card root carries the
// `flex-col` utility, so we climb to it and search within.
function statCard(label: string) {
  const card = screen.getByText(label).closest('div.flex-col') as HTMLElement;
  return within(card);
}

beforeEach(() => {
  idSeq = 0;
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('LiveSignalTail — stat band', () => {
  it('derives rate, buffer/max, unique-signal and filtered figures', () => {
    const entries = [
      makeEntry({ name: 'battery_level' }),
      makeEntry({ name: 'vehicle_speed' }),
      makeEntry({ name: 'battery_level' }), // duplicate name → still 2 unique
    ];
    renderTail({ entries, rate: 7, bufferMax: 500 });

    expect(statCard('Signals / sec').getByText('7')).toBeInTheDocument();

    const buffer = statCard('Buffer Size');
    expect(buffer.getByText('3')).toBeInTheDocument();
    expect(buffer.getByText('/ 500')).toBeInTheDocument();

    expect(statCard('Unique Signals').getByText('2')).toBeInTheDocument();
    expect(statCard('Filtered').getByText('3')).toBeInTheDocument();
  });

  it('collapses the stat band when showStats is false but keeps the tail', () => {
    renderTail({
      entries: [makeEntry({ name: 'battery_level' })],
      showStats: false,
      title: 'Live Signal Tail',
    });

    expect(screen.queryByText('Signals / sec')).not.toBeInTheDocument();
    expect(screen.queryByText('Buffer Size')).not.toBeInTheDocument();
    // The tail itself (title + row) still renders.
    expect(screen.getByText('Live Signal Tail')).toBeInTheDocument();
    expect(screen.getByText('battery_level')).toBeInTheDocument();
  });
});

describe('LiveSignalTail — signal rows', () => {
  it('renders all five signal columns', () => {
    renderTail({ entries: [makeEntry()] });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    for (const label of ['Time', 'Signal', 'Value', 'Type', 'Freshness']) {
      expect(headers.some((text) => text.includes(label))).toBe(true);
    }
  });

  it('renders each entry as a code-formatted name, its value and a type badge', () => {
    renderTail({
      entries: [
        makeEntry({ name: 'battery_level', value: '82', type: 'number' }),
        makeEntry({ name: 'charge_port_open', value: 'true', type: 'boolean' }),
      ],
    });

    expect(screen.getByText('battery_level').tagName).toBe('CODE');
    expect(screen.getByText('charge_port_open').tagName).toBe('CODE');
    expect(screen.getByText('82')).toBeInTheDocument();
    // Each row surfaces its value type as a badge.
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getByText('boolean')).toBeInTheDocument();
  });

  it('tints numeric / string / boolean values distinctly by type', () => {
    renderTail({
      entries: [
        makeEntry({ name: 'a', value: 'num', type: 'number' }),
        makeEntry({ name: 'b', value: 'str', type: 'string' }),
        makeEntry({ name: 'c', value: 'bool', type: 'boolean' }),
      ],
    });

    expect(screen.getByText('num').className).toContain('text-cyan-300');
    expect(screen.getByText('str').className).toContain('text-emerald-300');
    expect(screen.getByText('bool').className).toContain('text-amber-300');
  });
});

describe('LiveSignalTail — filtering + empty states', () => {
  it('shows the waiting message and a zero buffer when there are no entries', () => {
    renderTail({ entries: [] });
    expect(screen.getByText('Waiting for signals…')).toBeInTheDocument();
    expect(statCard('Buffer Size').getByText('0')).toBeInTheDocument();
  });

  it('filters rows case-insensitively and updates the Filtered stat', () => {
    renderTail({
      entries: [makeEntry({ name: 'battery_level' }), makeEntry({ name: 'vehicle_speed' })],
    });

    // Both rows visible before filtering.
    expect(screen.getByText('battery_level')).toBeInTheDocument();
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
    expect(statCard('Filtered').getByText('2')).toBeInTheDocument();

    // Upper-case query still matches the lower-case name.
    fireEvent.change(screen.getByLabelText('Filter signals'), { target: { value: 'BATTERY' } });

    expect(screen.getByText('battery_level')).toBeInTheDocument();
    expect(screen.queryByText('vehicle_speed')).not.toBeInTheDocument();
    expect(statCard('Filtered').getByText('1')).toBeInTheDocument();
  });

  it('swaps to the no-match message when the filter excludes everything', () => {
    renderTail({ entries: [makeEntry({ name: 'battery_level' })] });

    fireEvent.change(screen.getByLabelText('Filter signals'), { target: { value: 'zzz-nope' } });

    expect(screen.getByText('No signals match filter')).toBeInTheDocument();
    expect(screen.queryByText('battery_level')).not.toBeInTheDocument();
    expect(statCard('Filtered').getByText('0')).toBeInTheDocument();
  });
});

describe('LiveSignalTail — controls', () => {
  it('fires onPauseToggle and reflects the paused label', () => {
    const { onPauseToggle, rerender, props } = renderTail({ paused: false });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPauseToggle).toHaveBeenCalledTimes(1);

    // When paused, the control invites resuming instead.
    rerender(<LiveSignalTail {...props} paused />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('fires onClear when the clear button is pressed', () => {
    const { onClear } = renderTail({ entries: [makeEntry()] });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('toggles the auto-scroll control and exposes its state via aria-pressed', () => {
    renderTail();
    const toggle = screen.getByRole('button', { name: 'Auto-scroll' });

    // Auto-scroll defaults on.
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('LiveSignalTail — optional slots + resilience', () => {
  it('renders the title and headerExtra slot when provided', () => {
    renderTail({
      title: 'Live Signal Tail',
      headerExtra: <span data-testid="conn-badge">Connected</span>,
    });

    expect(screen.getByText('Live Signal Tail')).toBeInTheDocument();
    expect(screen.getByTestId('conn-badge')).toHaveTextContent('Connected');
  });

  it('omits the title header when none is given but still renders the filter + tail', () => {
    renderTail({ entries: [makeEntry({ name: 'battery_level' })] });

    expect(screen.queryByText('Live Signal Tail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter signals')).toBeInTheDocument();
    expect(screen.getByText('battery_level')).toBeInTheDocument();
  });

  it('renders the waiting state instead of throwing when entries is undefined', () => {
    expect(() =>
      renderTail({ entries: undefined as unknown as SignalEntry[] }),
    ).not.toThrow();

    expect(screen.getByText('Waiting for signals…')).toBeInTheDocument();
    expect(statCard('Buffer Size').getByText('0')).toBeInTheDocument();
  });
});
