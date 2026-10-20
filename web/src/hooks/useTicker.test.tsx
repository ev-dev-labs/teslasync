import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useTicker, getTickerTick } from './useTicker';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function TickReader({ label }: { label: string }) {
  const tick = useTicker();
  return <span data-testid={label}>{tick}</span>;
}

describe('useTicker', () => {
  it('shares one 30s timer across any number of subscribers', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { unmount } = render(
      <>
        <TickReader label="a" />
        <TickReader label="b" />
        <TickReader label="c" />
      </>,
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

    const before = getTickerTick();
    act(() => vi.advanceTimersByTime(30_000));
    expect(getTickerTick()).toBe(before + 1);
    expect(screen.getByTestId('a')).toHaveTextContent(String(before + 1));
    expect(screen.getByTestId('b')).toHaveTextContent(String(before + 1));
    expect(screen.getByTestId('c')).toHaveTextContent(String(before + 1));

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start the timer when disabled', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    function Disabled() {
      useTicker(false);
      return null;
    }
    const { unmount } = render(<Disabled />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
