import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from '../DateTime';
import type { DateTimeVariant } from '../DateTime';

// The timezone-aware branch (`<DateTime in=… />` / `showTz`) reads the IANA
// zone from `useTimezone()`, which in production reaches useSelectedVehicle →
// useVehicles (react-query) and Router context — neither is mounted by a bare
// render(). Mock the hook (repo convention — `src/test-setup.ts` stubs it to
// 'UTC' globally; a file-level vi.mock takes precedence) so each test can drive
// a deterministic zone AND capture the mode the component resolved.
// `importActual` keeps the real resolveTimezone / TzMode for type-compat.
const tzMock = vi.hoisted(() => ({ tz: 'UTC', lastMode: undefined as string | undefined }));
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return {
    ...actual,
    useTimezone: (mode: 'vehicle' | 'user' | 'utc' = 'vehicle') => {
      tzMock.lastMode = mode;
      return tzMock.tz;
    },
  };
});

// A fixed, well-inside-the-day instant so no real-world browser tz can shift it
// across a month/year boundary (14:30Z stays "Apr … 2026" from UTC-12..UTC+14).
const ISO = '2026-04-04T14:30:00Z';
const ISO_CANONICAL = '2026-04-04T14:30:00.000Z';

const outer = (c: HTMLElement) => c.querySelector('span');
const abbrev = (c: HTMLElement) => c.querySelector('span > span');

const ALL_VARIANTS: DateTimeVariant[] = ['full', 'date', 'time', 'relative', 'short'];

beforeEach(() => {
  tzMock.tz = 'UTC';
  tzMock.lastMode = undefined;
});

describe('DateTime — pure (browser locale/tz) path', () => {
  it('renders the default full variant inside a <span> carrying the canonical ISO title', () => {
    const { container } = render(<DateTime value={ISO} />);
    const span = outer(container);
    expect(span?.tagName).toBe('SPAN');
    expect(span?.getAttribute('title')).toBe(ISO_CANONICAL);
    // Full variant always includes the year; tz cannot shift 14:30Z off 2026.
    expect(container.textContent).toContain('2026');
  });

  it('accepts a Date instance and still hovers the canonical ISO title', () => {
    const d = new Date(ISO);
    const { container } = render(<DateTime value={d} />);
    expect(outer(container)?.getAttribute('title')).toBe(d.toISOString());
  });

  it('renders the em-dash placeholder for null and omits the title attribute', () => {
    const { container } = render(<DateTime value={null} />);
    expect(container.textContent).toBe('—');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders the em-dash placeholder for undefined', () => {
    const { container } = render(<DateTime value={undefined} />);
    expect(container.textContent).toBe('—');
  });

  it('renders the em-dash for an unparseable date string and omits the title', () => {
    const { container } = render(<DateTime value="not-a-date" />);
    expect(container.textContent).toBe('—');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders the em-dash for an empty string (falsy-value guard)', () => {
    const { container } = render(<DateTime value="" />);
    expect(container.textContent).toBe('—');
  });

  it('date variant omits any time component (no colon) but keeps the month', () => {
    const { container } = render(<DateTime value={ISO} variant="date" />);
    expect(container.textContent).not.toContain(':');
    expect(container.textContent).toContain('Apr');
  });

  it('short variant renders month + day only — no year, no time', () => {
    const { container } = render(<DateTime value={ISO} variant="short" />);
    expect(container.textContent).toContain('Apr');
    expect(container.textContent).not.toContain('2026');
    expect(container.textContent).not.toContain(':');
  });

  it('time variant renders an HH:MM clock component', () => {
    const { container } = render(<DateTime value={ISO} variant="time" />);
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('relative variant renders "Just now" for a fresh timestamp', () => {
    const { container } = render(<DateTime value={new Date()} variant="relative" />);
    expect(container.textContent).toBe('Just now');
  });

  it('applies the className to the value span', () => {
    const { container } = render(<DateTime value={ISO} className="text-cyan-300" />);
    expect(outer(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('renders every documented variant without leaking "Invalid Date" or an empty string', () => {
    for (const v of ALL_VARIANTS) {
      const { container } = render(<DateTime value={ISO} variant={v} />);
      expect(container.textContent).not.toBe('');
      expect(container.textContent).not.toContain('Invalid');
    }
  });

  it('stays on the pure path (no tz suffix in title) when `in` is explicitly undefined', () => {
    const { container } = render(<DateTime value={ISO} in={undefined} />);
    expect(outer(container)?.getAttribute('title')).toBe(ISO_CANONICAL);
    expect(abbrev(container)).toBeNull();
  });

  it('stays on the pure path when showTz is explicitly false', () => {
    const { container } = render(<DateTime value={ISO} showTz={false} />);
    expect(outer(container)?.getAttribute('title')).toBe(ISO_CANONICAL);
  });
});

describe('DateTime — timezone-aware path (in / showTz)', () => {
  it('renders the instant in UTC and tags the title with the zone', () => {
    tzMock.tz = 'UTC';
    const { container } = render(<DateTime value={ISO} in="utc" />);
    expect(container.textContent).toContain('Apr 4, 2026');
    expect(container.textContent).toContain('02:30');
    expect(container.textContent).toContain('PM');
    expect(outer(container)?.getAttribute('title')).toBe(`${ISO_CANONICAL} (UTC)`);
  });

  it('applies the resolved zone to the wall-clock time (proves tz is used, not ignored)', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(<DateTime value={ISO} in="vehicle" />);
    // 14:30Z → 07:30 in PDT (UTC-7 in April).
    expect(container.textContent).toContain('07:30');
    expect(container.textContent).toContain('AM');
    expect(outer(container)?.getAttribute('title')).toBe(`${ISO_CANONICAL} (America/Los_Angeles)`);
  });

  it('passes the requested mode straight through to useTimezone', () => {
    render(<DateTime value={ISO} in="user" />);
    expect(tzMock.lastMode).toBe('user');
  });

  it('falls back to the settings default mode when `in` is omitted but showTz is set', () => {
    // Global useSettings mock (test-setup.ts) → tz_display_default: 'vehicle'.
    render(<DateTime value={ISO} showTz />);
    expect(tzMock.lastMode).toBe('vehicle');
  });

  it('appends the short zone abbreviation in a muted secondary span when showTz is set', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(<DateTime value={ISO} in="vehicle" showTz />);
    const ab = abbrev(container);
    expect(ab?.textContent).toBe('PDT');
    expect(ab?.getAttribute('class')).toContain('text-[var(--text-muted)]');
  });

  it('shows the "UTC" abbreviation for the UTC zone', () => {
    tzMock.tz = 'UTC';
    const { container } = render(<DateTime value={ISO} showTz />);
    expect(abbrev(container)?.textContent).toBe('UTC');
  });

  it('shows the placeholder and no abbreviation span when showTz is set but the value is null', () => {
    tzMock.tz = 'UTC';
    const { container } = render(<DateTime value={null} showTz />);
    expect(container.textContent).toBe('—');
    expect(abbrev(container)).toBeNull();
  });

  it('does not append an abbreviation when showTz is unset on the tz-aware path', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(<DateTime value={ISO} in="vehicle" />);
    expect(abbrev(container)).toBeNull();
  });

  it('keeps the relative phrase zone-independent while still routing through the tz path', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(<DateTime value={new Date()} in="vehicle" variant="relative" />);
    expect(container.textContent).toBe('Just now');
  });
});

describe('DateTime — invalid timezone hardening (regression)', () => {
  it('does not throw when the resolved zone is a malformed IANA name', () => {
    tzMock.tz = 'Mars/Phobos';
    expect(() => render(<DateTime value={ISO} in="vehicle" />)).not.toThrow();
  });

  it('degrades a malformed zone to a UTC fallback instead of crashing the panel', () => {
    tzMock.tz = 'Not/A_Zone';
    const { container } = render(<DateTime value={ISO} in="vehicle" />);
    // UTC fallback → 14:30Z renders as 02:30 PM, and the title reflects UTC.
    expect(container.textContent).toContain('02:30');
    expect(container.textContent).toContain('PM');
    expect(outer(container)?.getAttribute('title')).toBe(`${ISO_CANONICAL} (UTC)`);
  });

  it('resolves a valid abbreviation from the UTC fallback when showTz + an invalid zone combine', () => {
    tzMock.tz = 'Nope/Nope';
    const { container } = render(<DateTime value={ISO} in="vehicle" showTz />);
    expect(abbrev(container)?.textContent).toBe('UTC');
  });
});
