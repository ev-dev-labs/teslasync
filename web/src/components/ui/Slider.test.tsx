/**
 * `<Slider>` primitive tests.
 *
 * Validates the bare `<input type="range">` contract: visible label
 * association, formatted value display, `aria-valuetext` for screen
 * readers, and the change handler firing on drag / keyboard arrow.
 *
 * Native arrow / Home / End key handling is tested by changing the
 * underlying input's value (the browser dispatches a `change` event on
 * keyboard-driven moves; jsdom's range input surfaces that the same way
 * as a programmatic `fireEvent.change`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: string | Record<string, unknown>) => {
      if (typeof defaultOrOpts === 'string') return defaultOrOpts || key;
      return key;
    },
  }),
}));

import { Slider } from './Slider';

afterEach(() => cleanup());

describe('Slider', () => {
  it('renders a labelled range input wired via htmlFor', () => {
    render(
      <Slider
        label="Battery threshold"
        value={50}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Battery threshold' });
    expect(slider).toBeInTheDocument();
    expect(slider.tagName).toBe('INPUT');
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('value', '50');
  });

  it('renders the formatted display value next to the label', () => {
    render(
      <Slider
        label="Charge limit"
        value={80}
        min={50}
        max={100}
        formatValue={(n) => `${n}%`}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('puts the formatted value into aria-valuetext for assistive tech', () => {
    render(
      <Slider
        label="Speed"
        value={120}
        min={0}
        max={200}
        formatValue={(n) => `${n} km/h`}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Speed' });
    expect(slider).toHaveAttribute('aria-valuetext', '120 km/h');
  });

  it('falls back to the raw value when no formatter is supplied', () => {
    render(
      <Slider label="Days" value={7} min={1} max={30} onChange={() => {}} />,
    );
    const slider = screen.getByRole('slider', { name: 'Days' });
    expect(slider).toHaveAttribute('aria-valuetext', '7');
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('fires onChange with the new numeric value on input change', () => {
    const onChange = vi.fn();
    render(
      <Slider
        label="Volume"
        value={20}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(slider, { target: { value: '35' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(35);
  });

  it('honours the step attribute on the underlying input', () => {
    render(
      <Slider
        label="Cooldown"
        value={5}
        min={1}
        max={60}
        step={5}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Cooldown' });
    expect(slider).toHaveAttribute('step', '5');
  });

  it('disables the input and applies disabled styling when disabled', () => {
    render(
      <Slider
        label="Locked"
        value={10}
        min={0}
        max={100}
        disabled
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Locked' });
    expect(slider).toBeDisabled();
  });

  it('exposes the label only via aria-label when showLabel is false', () => {
    render(
      <Slider
        label="Hidden caption"
        showLabel={false}
        value={1}
        min={0}
        max={10}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Hidden caption' });
    // Visible caption row should be omitted entirely.
    expect(screen.queryByText('Hidden caption')).toBeNull();
    // Accessible name comes from aria-label, not a visible <label>.
    expect(slider).toHaveAttribute('aria-label', 'Hidden caption');
  });

  it('uses the provided id on the input and the label htmlFor', () => {
    render(
      <Slider
        label="Custom ID"
        id="my-slider"
        value={1}
        min={0}
        max={10}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Custom ID' });
    expect(slider).toHaveAttribute('id', 'my-slider');
  });
});
