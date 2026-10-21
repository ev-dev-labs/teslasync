import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from '../DateTime';
import type { DateTimeVariant } from '../DateTime';

// The timezone-aware branch (`<DateTime in=… />`) reads the IANA
// zone from `useTimezone()`, which in production reaches useSelectedVehicle →
// useVehicles (react-query) and Router context — neither is mounted by a bare
// render(). Mock the hook (repo convention — `src/test-setup.ts` stubs it to
// 'UTC' globally; a file-level vi.mock takes precedence) so each test can drive
// a deterministic zone AND capture the mode the component resolved.
// `importActual` keeps the real resolveTimezone / TzMode for type-compat.
const tzMock = vi.hoisted(() => ({ tz: 'UTC', lastMode: undefined as string | undefined }));
const settingsMock = vi.hoisted(() => ({ locale: 'en-US', tz_display_default: 'vehicle' }));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: settingsMock }),
}));
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

const outer = (c: HTMLElement) => c.querySelector('span');

const ALL_VARIANTS: DateTimeVariant[] = ['full', 'date', 'time', 'relative', 'short'];

beforeEach(() => {
  tzMock.tz = 'UTC';
  tzMock.lastMode = undefined;
  settingsMock.locale = 'en-US';
});

describe('DateTime — publication business days', () => {
  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'preserves the publication day without resolving the %s instant timezone',
    (tz) => {
      tzMock.tz = tz;
      const { container } = render(
        <DateTime value="2026-07-02" variant="day" in="vehicle" clock={{ second: '2-digit' }} />,
      );
      expect(container.textContent).toBe('Jul 2, 2026');
      expect(outer(container)?.hasAttribute('title')).toBe(false);
      expect(tzMock.lastMode).toBeUndefined();
    },
  );

  it('uses the selected locale and responds to preference changes', () => {
    settingsMock.locale = 'de-DE';
    const { container, rerender } = render(<DateTime value="2026-07-02" variant="day" />);
    expect(container.textContent).toBe('2. Juli 2026');
    settingsMock.locale = 'en-US';
    rerender(<DateTime value="2026-07-02" variant="day" />);
    expect(container.textContent).toBe('Jul 2, 2026');
  });

  it.each([null, undefined, '', '2026-02-30', ISO, new Date(ISO)])(
    'does not invent an instant or date for invalid business-day input %s',
    (value) => {
      const { container } = render(<DateTime value={value} variant="day" />);
      expect(container.textContent).toBe('—');
      expect(outer(container)?.hasAttribute('title')).toBe(false);
    },
  );

  it('continues converting true instants at midnight boundaries', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(
      <DateTime value="2026-07-02T00:00:00Z" variant="date" in="vehicle" />,
    );
    expect(container.textContent).toBe('Jul 1, 2026');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('DateTime — pure (browser locale/tz) path', () => {
  it('renders the default full variant inside a <span> with no ISO title', () => {
    const { container } = render(<DateTime value={ISO} />);
    const span = outer(container);
    expect(span?.tagName).toBe('SPAN');
    expect(span?.hasAttribute('title')).toBe(false);
    // Full variant always includes the year; tz cannot shift 14:30Z off 2026.
    expect(container.textContent).toContain('2026');
  });

  it('accepts a Date instance and renders no ISO title', () => {
    const d = new Date(ISO);
    const { container } = render(<DateTime value={d} />);
    expect(outer(container)?.hasAttribute('title')).toBe(false);
    expect(container.textContent).toContain('2026');
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

  it('stays on the pure path with no title when `in` is explicitly undefined', () => {
    const { container } = render(<DateTime value={ISO} in={undefined} />);
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('DateTime — timezone-aware path (in / clock)', () => {
  it('uses the preference-aware path for explicit seconds without changing the pure default', () => {
    tzMock.tz = 'America/Los_Angeles';
    const instant = '2026-04-05T02:30:47Z';
    const { container, rerender } = render(
      <DateTime value={instant} clock={{ second: '2-digit', hour12: false }} />,
    );
    expect(tzMock.lastMode).toBe('vehicle');
    expect(container.textContent).toContain('Apr 4, 2026');
    expect(container.textContent).toContain('19:30:47');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
    rerender(<DateTime value={instant} />);
    expect(container.textContent).not.toContain(':47');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders the instant in UTC with no zone suffix or title', () => {
    tzMock.tz = 'UTC';
    const { container } = render(<DateTime value={ISO} in="utc" />);
    expect(container.textContent).toContain('Apr 4, 2026');
    expect(container.textContent).toContain('02:30');
    expect(container.textContent).toContain('PM');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });

  it('applies the resolved zone to the wall-clock time (proves tz is used, not ignored)', () => {
    tzMock.tz = 'America/Los_Angeles';
    const { container } = render(<DateTime value={ISO} in="vehicle" />);
    // 14:30Z → 07:30 in PDT (UTC-7 in April).
    expect(container.textContent).toContain('07:30');
    expect(container.textContent).toContain('AM');
    expect(container.textContent).not.toContain('PDT');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });

  it('passes the requested mode straight through to useTimezone', () => {
    render(<DateTime value={ISO} in="user" />);
    expect(tzMock.lastMode).toBe('user');
  });

  it('falls back to the settings default mode when `in` is omitted but clock is set', () => {
    // Global useSettings mock (test-setup.ts) → tz_display_default: 'vehicle'.
    render(<DateTime value={ISO} clock={{ second: '2-digit' }} />);
    expect(tzMock.lastMode).toBe('vehicle');
  });

  it('shows the placeholder with no title when the value is null on the tz-aware path', () => {
    tzMock.tz = 'UTC';
    const { container } = render(<DateTime value={null} in="vehicle" />);
    expect(container.textContent).toBe('—');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
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
    // UTC fallback → 14:30Z renders as 02:30 PM with no zone suffix.
    expect(container.textContent).toContain('02:30');
    expect(container.textContent).toContain('PM');
    expect(container.textContent).not.toContain('UTC');
    expect(outer(container)?.hasAttribute('title')).toBe(false);
  });
});
