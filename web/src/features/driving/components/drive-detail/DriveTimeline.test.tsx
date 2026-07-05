/**
 * DriveTimeline — start → duration → end ribbon.
 *
 * The component derives three display facets from an SI drive:
 *   1. Start time  — `formatTime(startTs)`.
 *   2. Duration    — real `formatDuration` over `durationS` seconds, guarded
 *                    against missing/negative payloads (the bug this suite pins:
 *                    an undefined `durationS` used to divide to NaN → "NaNm").
 *   3. End time    — `formatTime(endTs)`, or the "In progress" label when the
 *                    drive has not ended.
 *
 * `formatTime` is mocked to echo its input deterministically (its real output
 * is locale/timezone dependent and would make assertions flaky), so the tests
 * verify the WIRING (which timestamp feeds which marker) plus its em-dash
 * degradation. The real `formatDuration` is exercised end-to-end so the
 * null-safety/clamp hardening is covered for real. The a11y contract —
 * decorative flag icons + progress bar hidden from the accessibility tree, and
 * a labelled group with visually-hidden "Started at / Duration / Ended at"
 * prefixes so colour is not the only cue — is asserted directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DriveDetail } from '@/types/driving';

// i18n stub: resolve the fallback string (or a `defaultValue` option) so we can
// assert real user-visible copy rather than raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Deterministic formatTime: echo the timestamp so we can prove which field
// (startTs vs endTs) reaches which marker, and keep the em-dash degradation
// for nullish input that the real helper guarantees.
vi.mock('@/lib/dateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    ...actual,
    formatTime: (iso: unknown) => (iso ? `T[${String(iso)}]` : '—'),
  };
});

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

import { DriveTimeline } from './DriveTimeline';

const START = '2026-01-02T08:30:00Z';
const END = '2026-01-02T09:30:00Z';

// Only startTs / endTs / durationS drive the output; everything else is
// irrelevant, so the fixture casts a minimal object.
function makeDrive(
  overrides: Partial<Record<'startTs' | 'endTs' | 'durationS', unknown>> = {},
): DriveDetail {
  return {
    startTs: START,
    endTs: END,
    durationS: 3600,
    ...overrides,
  } as unknown as DriveDetail;
}

describe('DriveTimeline', () => {
  it('renders start time, whole-hour duration, and end time for a completed drive', () => {
    render(<DriveTimeline drive={makeDrive({ durationS: 3600 })} />);

    // Wiring: startTs and endTs reach their respective markers.
    expect(screen.getByText(`T[${START}]`)).toBeInTheDocument();
    expect(screen.getByText(`T[${END}]`)).toBeInTheDocument();
    // Real formatDuration: 3600s → 60min → "1h 0m".
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
    // Not the in-progress branch.
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('formats a sub-hour and an hour+minutes duration via the real helper', () => {
    const { rerender } = render(<DriveTimeline drive={makeDrive({ durationS: 600 })} />);
    expect(screen.getByText('10m')).toBeInTheDocument(); // 600s → 10min

    rerender(<DriveTimeline drive={makeDrive({ durationS: 5400 })} />);
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // 5400s → 90min
  });

  it('shows the "In progress" label (not an end time) when the drive has no end timestamp', () => {
    render(<DriveTimeline drive={makeDrive({ endTs: null, durationS: 1800 })} />);

    expect(screen.getByText('In progress')).toBeInTheDocument();
    // The end marker must not fabricate a formatted time from a null endTs.
    expect(screen.queryByText(`T[${END}]`)).toBeNull();
    // Start marker still present.
    expect(screen.getByText(`T[${START}]`)).toBeInTheDocument();
    // Screen-reader status prefix replaces "Ended at" in this branch.
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.queryByText('Ended at')).toBeNull();
  });

  it('is null-safe: an undefined durationS renders "0m", never "NaNm"', () => {
    const { container } = render(<DriveTimeline drive={makeDrive({ durationS: undefined })} />);

    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('clamps a negative durationS (clock skew) to "0m"', () => {
    const { container } = render(<DriveTimeline drive={makeDrive({ durationS: -600 })} />);

    // Without the Math.max clamp, formatDuration(-10) renders "-10m".
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.queryByText('-10m')).toBeNull();
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('degrades a missing start timestamp to an em-dash without breaking the marker', () => {
    render(<DriveTimeline drive={makeDrive({ startTs: null })} />);

    // formatTime(null) → "—"; the "Started at" prefix is still announced.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Started at')).toBeInTheDocument();
  });

  it('exposes a labelled timeline group with visually-hidden marker prefixes', () => {
    render(<DriveTimeline drive={makeDrive()} />);

    // Colour is not the only cue: the group + prefixes carry the semantics.
    expect(screen.getByRole('group', { name: 'Drive timeline' })).toBeInTheDocument();
    expect(screen.getByText('Started at')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Ended at')).toBeInTheDocument();
  });

  it('hides decorative flag icons and the progress bar from the accessibility tree', () => {
    const { container } = render(<DriveTimeline drive={makeDrive()} />);

    // Both Flag glyphs are decorative.
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBe(2);
    icons.forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));

    // The gradient bar is purely decorative — its wrapper is aria-hidden.
    const gradient = container.querySelector('.bg-gradient-to-r');
    expect(gradient).not.toBeNull();
    expect(gradient?.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });
});
