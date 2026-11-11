import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_DESIGNS, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { matchesAppDesignCss, setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { ChargingSearchControl } from './ChargingSearchControl';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motion.reduce, durationMs: motion.reduce ? 0 : 250 }),
}));

afterEach(() => {
  vi.useRealTimers();
  motion.reduce = false;
});

describe('charging search pending feedback', () => {
  it('retains the input, focus and debounced search through pending transitions', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(<ChargingSearchControl value="" onChange={onChange} pending={false} />);
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'charger:home' } });
    rerender(<ChargingSearchControl value="" onChange={onChange} pending />);
    expect(screen.getByRole('combobox')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('charger:home');
    const status = screen.getByRole('status', { name: 'Filtering…' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('data-app-feedback-kind', 'spinner');
    expect(status).toHaveClass('pointer-events-none', 'absolute', 'right-9', 'top-1/2', '-translate-y-1/2');
    expect(status.firstElementChild).toHaveClass('h-3', 'w-3', 'animate-spin');
    act(() => vi.advanceTimersByTime(250));
    expect(onChange).toHaveBeenLastCalledWith('charger:home');
    rerender(<ChargingSearchControl value="charger:home" onChange={onChange} pending={false} />);
    expect(screen.queryByRole('status', { name: 'Filtering…' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('charger:home');
  });

  it('keeps filtering status visible but stops the ring under the existing motion/bandwidth preference', () => {
    motion.reduce = true;
    render(<ChargingSearchControl value="cost:>5" onChange={vi.fn()} pending />);
    expect(screen.getByRole('status', { name: 'Filtering…' }).firstElementChild)
      .not.toHaveClass('animate-spin');
  });

  it('uses the existing loading-kind consumers under all complete designs and none without ownership', () => {
    const { container } = render(<div data-app-design-preview>
      <ChargingSearchControl value="" onChange={vi.fn()} pending />
    </div>);
    const host = container.firstElementChild!;
    const status = screen.getByRole('status', { name: 'Filtering…' });
    expect(matchesAppDesignCss(status)).toEqual([]);
    for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
      setAppDesignTestProfile(host, pack);
      const release = observeAppDesignScopes(host);
      try {
        expect(matchesAppDesignCss(status, '[data-app-feedback-kind]').length, pack).toBeGreaterThan(0);
        if (APPLICATION_DESIGNS[pack].feedback !== 'callout') {
          expect(matchesAppDesignCss(status, '[data-app-feedback-kind="spinner"]').length, pack).toBeGreaterThan(0);
        }
      } finally { release(); }
    }
  });
});
