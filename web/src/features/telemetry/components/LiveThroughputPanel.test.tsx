/**
 * LiveThroughputPanel — behaviour + hardening coverage.
 *
 * This file both exercises the panel and locks in the fixes made while
 * elevating it:
 *   - the panel shell (title + now/peak caption) is ALWAYS visible, even with
 *     no data, and the caption is null-safe (`rate`/`peak` undefined → "0");
 *   - the plot threshold is 2 samples — a single point degrades to the "waiting"
 *     empty state rather than an unplottable chart;
 *   - connected vs disconnected swaps the empty-state message + icon;
 *   - a11y regression: the chart's `role="img"` used to wrap the empty state,
 *     so screen readers swallowed the "waiting/offline" message as image
 *     internals. `role="img"` now scopes to the rendered chart only, and the
 *     colour-only "live" dot has a VisuallyHidden text alternative.
 *
 * Recharts' <ResponsiveContainer> measures 0×0 in jsdom, so the SVG body never
 * renders — assertions target the always-present panel header, the empty state,
 * the labelled chart region, and the screen-reader status text.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { LiveThroughputPanel, type LiveThroughputPanelProps } from './LiveThroughputPanel';
import type { ThroughputPoint } from '../hooks/useThroughputHistory';

// i18n stub: echo the English fallback so assertions read naturally. Every t()
// call in this component passes a string fallback with no interpolation.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const CHART_LABEL = 'Live signals per second over the recent window';
const WAITING = 'Waiting for live throughput…';
const OFFLINE = 'Stream disconnected — no live throughput';

function points(n: number, rate = 3): ThroughputPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 6, 4, 12, 0, i)).toISOString(),
    rate,
  }));
}

function renderPanel(over: Partial<LiveThroughputPanelProps> = {}) {
  const props: LiveThroughputPanelProps = {
    history: [],
    rate: 0,
    peak: 0,
    connected: true,
    ...over,
  };
  return render(<LiveThroughputPanel {...props} />);
}

// Locate the caption span by its own concatenated text (it has no element
// children, so getNodeText returns the full "Now: …/s · Peak: …/s" string).
function captionText(): string {
  const el = screen.getByText(
    (content) => content.includes('Now:') && content.includes('Peak:'),
  );
  return el.textContent ?? '';
}

describe('LiveThroughputPanel', () => {
  it('always renders the titled shell with a null-safe now/peak caption', () => {
    renderPanel({ rate: 12, peak: 40, connected: true });

    expect(
      screen.getByRole('heading', { name: /Signal Throughput/ }),
    ).toBeInTheDocument();
    // Caption reflects the live + peak rate through the shared int formatter.
    expect(captionText()).toBe('Now: 12/s · Peak: 40/s');
  });

  it('formats large rates with locale separators and coerces non-finite input to 0', () => {
    // rate crosses the thousands separator; peak is NaN → safeNumber → "0".
    renderPanel({ rate: 1500, peak: Number.NaN });
    expect(captionText()).toBe('Now: 1,500/s · Peak: 0/s');
  });

  it('is null-safe when history/rate/peak are missing (renders the waiting state, no crash)', () => {
    // Callers should never do this, but the component must not explode on it.
    const bad = {
      history: undefined,
      rate: undefined,
      peak: undefined,
      connected: true,
    } as unknown as LiveThroughputPanelProps;

    expect(() => render(<LiveThroughputPanel {...bad} />)).not.toThrow();
    expect(captionText()).toBe('Now: 0/s · Peak: 0/s');
    expect(screen.getByText(WAITING)).toBeInTheDocument();
  });

  it('shows the "waiting" empty state (not offline) when connected with no plottable data', () => {
    renderPanel({ connected: true, history: [] });

    // The empty-state message must be exposed to AT (role=status), not hidden
    // inside a role="img" wrapper.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(WAITING);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    // No chart is drawn, so the labelled chart region is absent entirely.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('swaps to the offline empty state when the stream is disconnected', () => {
    renderPanel({ connected: false, history: [] });

    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('treats a single sample as not enough to plot (needs >= 2 points)', () => {
    renderPanel({ connected: true, history: points(1) });

    expect(screen.getByText(WAITING)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });

  it('renders the labelled chart region once there are at least two samples', () => {
    renderPanel({ connected: true, history: points(2) });

    // The chart region carries the screen-reader label; the empty states are gone.
    expect(screen.getByRole('img', { name: CHART_LABEL })).toBeInTheDocument();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it('keeps the chart visible even when the stream drops but history survives', () => {
    // Disconnected + buffered history: show the last-known trace, not "offline".
    renderPanel({ connected: false, history: points(5) });

    expect(screen.getByRole('img', { name: CHART_LABEL })).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it('exposes a non-colour connection status for assistive tech and toggles it', () => {
    const { rerender } = renderPanel({ connected: true });
    expect(screen.getByText('Live throughput stream connected')).toBeInTheDocument();
    expect(screen.queryByText('Live throughput stream disconnected')).toBeNull();

    rerender(
      <LiveThroughputPanel history={[]} rate={0} peak={0} connected={false} />,
    );
    expect(screen.getByText('Live throughput stream disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Live throughput stream connected')).toBeNull();
  });

  it('tints the live dot when connected and mutes it when disconnected', () => {
    const { container, rerender } = renderPanel({ connected: true });
    // The header status dot is decorative (aria-hidden) but its colour encodes
    // connection state — assert the branch on the class rather than the role.
    expect(container.querySelector('svg.text-rose-400')).not.toBeNull();

    rerender(
      <LiveThroughputPanel history={[]} rate={0} peak={0} connected={false} />,
    );
    expect(container.querySelector('svg.text-rose-400')).toBeNull();
  });

  it('forwards a custom className onto the glass panel shell', () => {
    const { container } = renderPanel({ className: 'col-span-2 test-marker' });
    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    // Custom class is merged with the base padding, not replacing it.
    expect(panel?.className).toContain('test-marker');
    expect(panel?.className).toContain('p-4');
  });
});
