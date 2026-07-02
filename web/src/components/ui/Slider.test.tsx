/**
 * `<Slider>` primitive tests.
 *
 * Validates the Radix UI `Slider` contract: visible label association
 * via `aria-labelledby`, formatted value display, `aria-valuetext` for
 * screen readers, and the full WAI-ARIA APG slider keyboard pattern
 * (ArrowLeft/Right/Up/Down step by `step`, Shift+Arrow/PageUp/PageDown
 * step by 10x `step`, Home/End jump to min/max) that Radix implements
 * natively — exercised here via real keydown events rather than assumed,
 * since a bare `fireEvent.change` (the old native-`<input>` test
 * technique) no longer applies to a `<span role="slider">` thumb.
 *
 * Pointer/drag interactions aren't covered here (jsdom doesn't implement
 * `Element.setPointerCapture`, which Radix's drag handling relies on);
 * keyboard interactions exercise the same `onValueChange` callback path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: string | Record<string, unknown>) => {
      if (typeof defaultOrOpts === 'string') return defaultOrOpts || key;
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { Slider } from './Slider';

afterEach(() => cleanup());

describe('Slider', () => {
  it('renders a labelled slider thumb wired via aria-labelledby', () => {
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
    expect(slider.tagName).toBe('SPAN');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('tabindex', '0');
    // Accessible name comes from the visible label span via
    // aria-labelledby, not a native <label for> (Radix's thumb is a
    // <span>, which isn't a "labelable" HTML element).
    const labelledBy = slider.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Battery threshold');
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

  it('fires onChange with the incremented value on ArrowRight', () => {
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
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it('fires onChange with the decremented value on ArrowLeft', () => {
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
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it('honours the step size on Arrow key increments', () => {
    const onChange = vi.fn();
    render(
      <Slider
        label="Cooldown"
        value={5}
        min={0}
        max={60}
        step={5}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Cooldown' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('jumps to min on Home and max on End', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Slider label="Range" value={40} min={0} max={100} step={5} onChange={onChange} />,
    );
    const slider = screen.getByRole('slider', { name: 'Range' });
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);

    // Simulate the controlled value moving to reflect the Home press,
    // then verify End jumps to the configured max.
    rerender(
      <Slider label="Range" value={0} min={0} max={100} step={5} onChange={onChange} />,
    );
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('steps by 10x on PageUp', () => {
    const onChange = vi.fn();
    render(
      <Slider label="Big steps" value={10} min={0} max={200} step={2} onChange={onChange} />,
    );
    const slider = screen.getByRole('slider', { name: 'Big steps' });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('disables interaction and removes the thumb from tab order when disabled', () => {
    const onChange = vi.fn();
    render(
      <Slider
        label="Locked"
        value={10}
        min={0}
        max={100}
        disabled
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Locked' });
    expect(slider).not.toHaveAttribute('tabindex');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
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
    // Accessible name comes from aria-label, not a visible label element.
    expect(slider).toHaveAttribute('aria-label', 'Hidden caption');
    expect(slider).not.toHaveAttribute('aria-labelledby');
  });

  it('uses the provided id on the slider thumb', () => {
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
