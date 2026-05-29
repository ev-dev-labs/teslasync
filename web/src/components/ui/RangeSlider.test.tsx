/**
 * `<RangeSlider>` primitive coverage.
 *
 * Validates dual-thumb behaviour: each thumb is independently labelled
 * and announced via aria-valuetext, the change handler always receives
 * a sorted `[low, high]` tuple, and the thumb-swap logic kicks in when
 * the user drags one thumb past the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      // Support t(key, defaultValue, opts) and t(key, opts).
      let fallback: string | undefined;
      let opts: Record<string, unknown> | undefined;
      if (typeof defaultOrOpts === 'string') {
        fallback = defaultOrOpts;
        opts = maybeOpts;
      } else {
        opts = defaultOrOpts;
      }
      const out = fallback ?? key;
      if (!opts) return out;
      return out.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        opts?.[name] != null ? String(opts[name]) : '',
      );
    },
  }),
}));

import { RangeSlider } from './RangeSlider';

afterEach(() => cleanup());

describe('RangeSlider', () => {
  it('renders two thumbs with auto-translated min/max accessible names', () => {
    render(
      <RangeSlider
        label="Score"
        value={[20, 80]}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Score minimum' });
    const highThumb = screen.getByRole('slider', { name: 'Score maximum' });
    expect(lowThumb).toBeInTheDocument();
    expect(highThumb).toBeInTheDocument();
    expect(lowThumb).toHaveAttribute('value', '20');
    expect(highThumb).toHaveAttribute('value', '80');
  });

  it('honours custom thumb labels when supplied', () => {
    render(
      <RangeSlider
        label="Time"
        value={[5, 18]}
        min={0}
        max={24}
        minThumbLabel="Earliest hour"
        maxThumbLabel="Latest hour"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Earliest hour' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Latest hour' })).toBeInTheDocument();
  });

  it('renders the visible value strip with both formatted endpoints', () => {
    render(
      <RangeSlider
        label="Battery window"
        value={[20, 80]}
        min={0}
        max={100}
        formatValue={(n) => `${n}%`}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/20%/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('places the formatted value into each thumb aria-valuetext', () => {
    render(
      <RangeSlider
        label="Speed"
        value={[30, 90]}
        min={0}
        max={200}
        formatValue={(n) => `${n} km/h`}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Speed minimum' }),
    ).toHaveAttribute('aria-valuetext', '30 km/h');
    expect(
      screen.getByRole('slider', { name: 'Speed maximum' }),
    ).toHaveAttribute('aria-valuetext', '90 km/h');
  });

  it('moves the low thumb up without touching the high thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={onChange}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    fireEvent.change(lowThumb, { target: { value: '40' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([40, 90]);
  });

  it('moves the high thumb down without touching the low thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={onChange}
      />,
    );
    const highThumb = screen.getByRole('slider', { name: 'Range maximum' });
    fireEvent.change(highThumb, { target: { value: '50' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([10, 50]);
  });

  it('swaps thumbs when the low thumb is dragged past the high thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[20, 60]}
        min={0}
        max={100}
        onChange={onChange}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    // User drags the low thumb to 75 — past the high thumb at 60.
    // Resulting tuple must be sorted: [high (60), newLow (75)].
    fireEvent.change(lowThumb, { target: { value: '75' } });
    expect(onChange).toHaveBeenCalledWith([60, 75]);
  });

  it('swaps thumbs when the high thumb is dragged past the low thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[40, 80]}
        min={0}
        max={100}
        onChange={onChange}
      />,
    );
    const highThumb = screen.getByRole('slider', { name: 'Range maximum' });
    // User drags the high thumb to 25 — past the low thumb at 40.
    // Resulting tuple must be sorted: [newHigh (25), low (40)].
    fireEvent.change(highThumb, { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith([25, 40]);
  });

  it('honours the step attribute on both inputs', () => {
    render(
      <RangeSlider
        label="Range"
        value={[10, 50]}
        min={0}
        max={100}
        step={5}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Range minimum' }),
    ).toHaveAttribute('step', '5');
    expect(
      screen.getByRole('slider', { name: 'Range maximum' }),
    ).toHaveAttribute('step', '5');
  });

  it('disables both thumbs when disabled', () => {
    render(
      <RangeSlider
        label="Locked"
        value={[10, 90]}
        min={0}
        max={100}
        disabled
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Locked minimum' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Locked maximum' })).toBeDisabled();
  });

  it('updates aria-valuetext after a controlled re-render', () => {
    const { rerender } = render(
      <RangeSlider
        label="Score"
        value={[20, 80]}
        min={0}
        max={100}
        formatValue={(n) => `${n} pts`}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Score minimum' }),
    ).toHaveAttribute('aria-valuetext', '20 pts');

    rerender(
      <RangeSlider
        label="Score"
        value={[35, 80]}
        min={0}
        max={100}
        formatValue={(n) => `${n} pts`}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('slider', { name: 'Score minimum' }),
    ).toHaveAttribute('aria-valuetext', '35 pts');
  });

  it('hides the visible caption row when showLabel is false', () => {
    render(
      <RangeSlider
        label="Hidden range"
        showLabel={false}
        value={[1, 9]}
        min={0}
        max={10}
        onChange={() => {}}
      />,
    );
    // Both thumbs still expose the label via aria-label on the input.
    expect(
      screen.getByRole('slider', { name: 'Hidden range minimum' }),
    ).toBeInTheDocument();
    // No visible heading text in the document.
    expect(screen.queryByText('Hidden range')).toBeNull();
  });
});
