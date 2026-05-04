import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TimeStamp } from '../TimeStamp';
import { useTimeFormatPreference } from '@/hooks/useTimeFormatPreference';

vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: vi.fn(),
}));

const mockedPref = vi.mocked(useTimeFormatPreference);

beforeEach(() => {
  mockedPref.mockReset();
  // Default: relative
  mockedPref.mockReturnValue('relative');
});

// Use a fixed reference timestamp so formatRelative stays deterministic.
// 2 hours before "now" relative to test execution.
function twoHoursAgoIso(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

describe('TimeStamp', () => {
  it('renders the relative format when preference is relative', () => {
    mockedPref.mockReturnValue('relative');
    const iso = twoHoursAgoIso();
    const { container } = render(<TimeStamp value={iso} className="ts-body" />);
    // Body should match relative ("2h ago" / "just now" / "Nm ago")
    const body = container.querySelector('.ts-body');
    expect(body?.textContent ?? '').toMatch(/h ago|just now|m ago/i);
  });

  it('renders the absolute format when preference is absolute', () => {
    mockedPref.mockReturnValue('absolute');
    const iso = twoHoursAgoIso();
    const { container } = render(<TimeStamp value={iso} className="ts-body" />);
    // Body (NOT the tooltip) should not contain "ago" when absolute is shown
    const body = container.querySelector('.ts-body');
    expect(body?.textContent ?? '').not.toMatch(/ago/i);
    expect(body?.textContent ?? '').not.toEqual('—');
    expect(body?.textContent ?? '').not.toEqual('');
  });

  it('explicit format prop overrides the preference', () => {
    mockedPref.mockReturnValue('absolute');
    const iso = twoHoursAgoIso();
    const { container } = render(<TimeStamp value={iso} format="relative" className="ts-body" />);
    const body = container.querySelector('.ts-body');
    expect(body?.textContent ?? '').toMatch(/ago|just now/i);
  });

  it('tooltip exposes the alternate format (relative pref shows absolute on hover)', () => {
    mockedPref.mockReturnValue('relative');
    const iso = twoHoursAgoIso();
    render(<TimeStamp value={iso} />);
    // Tooltip body has role="tooltip"; its text content should NOT contain "ago".
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip?.textContent ?? '').not.toMatch(/ago/i);
    expect(tip?.textContent ?? '').not.toEqual('');
  });

  it('tooltip exposes the alternate format (absolute pref shows relative on hover)', () => {
    mockedPref.mockReturnValue('absolute');
    const iso = twoHoursAgoIso();
    render(<TimeStamp value={iso} />);
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip?.textContent ?? '').toMatch(/ago|just now/i);
  });

  it('renders an em-dash and no tooltip when value is null', () => {
    const { container } = render(<TimeStamp value={null} />);
    expect(container.textContent).toBe('—');
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('renders an em-dash when value is undefined', () => {
    const { container } = render(<TimeStamp value={undefined} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em-dash when value is unparseable', () => {
    const { container } = render(<TimeStamp value="not-a-date" />);
    expect(container.textContent).toBe('—');
  });

  it('passes className through to the visible body span', () => {
    mockedPref.mockReturnValue('relative');
    const iso = twoHoursAgoIso();
    const { container } = render(<TimeStamp value={iso} className="text-rose-400" />);
    expect(container.querySelector('.text-rose-400')).not.toBeNull();
  });

  it('accepts a Date instance directly', () => {
    mockedPref.mockReturnValue('absolute');
    const { container } = render(<TimeStamp value={new Date()} />);
    expect(container.textContent ?? '').not.toEqual('—');
  });

  it('accepts an epoch number', () => {
    mockedPref.mockReturnValue('relative');
    const { container } = render(<TimeStamp value={Date.now() - 60_000} className="ts-body" />);
    const body = container.querySelector('.ts-body');
    expect(body?.textContent ?? '').toMatch(/m ago|just now/i);
  });
});
