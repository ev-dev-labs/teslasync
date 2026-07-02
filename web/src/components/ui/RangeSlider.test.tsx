/**
 * `<RangeSlider>` primitive coverage.
 *
 * Built on Radix UI's `Slider` (range mode), so thumbs render as
 * `role="slider"` `<span>`s (each with `aria-valuemin`/`aria-valuenow`/
 * `aria-valuemax` kept in sync by Radix) rather than native
 * `<input type="range">` elements — there is no `value`/`step` HTML
 * attribute to assert on anymore, and interactions are simulated via
 * keyboard (Home/End/Arrow/Page keys), which is both how real keyboard
 * users operate the control AND how these tests exercise the exact same
 * internal `updateValues`/`getNextSortedValues` codepath a pointer drag
 * would (Radix has no imperative "set value" escape hatch, and jsdom
 * doesn't implement the Pointer Capture APIs `@radix-ui/react-slider`
 * uses for drag, so keyboard is the reliable way to drive this
 * controlled component deterministically in a jsdom test).
 *
 * Coverage: each thumb is independently labelled and announced via
 * aria-valuetext, the change handler always receives a sorted
 * `[low, high]` tuple, thumb-swap kicks in when a keyboard move crosses
 * the other thumb, `step` is honoured, `disabled` is both marked AND
 * functionally inert, and the resolved i18n writing direction is
 * threaded into the Radix root (required for correct RTL arrow-key /
 * drag math — see the component's own doc comment).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const i18nState = vi.hoisted(() => ({ language: 'en' }));

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
    i18n: i18nState,
  }),
}));

import { RangeSlider } from './RangeSlider';

afterEach(() => {
  i18nState.language = 'en';
  cleanup();
});

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
    expect(lowThumb).toHaveAttribute('aria-valuenow', '20');
    expect(highThumb).toHaveAttribute('aria-valuenow', '80');
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

  it('moves the low thumb up by one step without touching the high thumb', () => {
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
    lowThumb.focus();
    fireEvent.keyDown(lowThumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([11, 90]);
  });

  it('moves the high thumb down by one step without touching the low thumb', () => {
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
    highThumb.focus();
    fireEvent.keyDown(highThumb, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([10, 89]);
  });

  it('jumps the low thumb to min via Home without touching the high thumb', () => {
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
    lowThumb.focus();
    fireEvent.keyDown(lowThumb, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith([0, 90]);
  });

  it('jumps the high thumb to max via End without touching the low thumb', () => {
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
    highThumb.focus();
    fireEvent.keyDown(highThumb, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith([10, 100]);
  });

  it('steps by 10x on PageUp/PageDown', () => {
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
    lowThumb.focus();
    fireEvent.keyDown(lowThumb, { key: 'PageUp' });
    expect(onChange).toHaveBeenCalledWith([20, 90]);
  });

  it('swaps thumbs (sorted tuple) when a keyboard move drags the low thumb past the high thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[0, 30]}
        min={0}
        max={200}
        step={50}
        onChange={onChange}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    lowThumb.focus();
    // low (0) + step (50) = 50, past the high thumb (30) — Radix's
    // internal updateValues sorts the resulting pair ascending. (Both
    // the starting value and the target land exactly on the step-50
    // grid from min=0, since Radix re-snaps every candidate to the
    // nearest step multiple — an off-grid target like 70 would get
    // rounded to the nearest multiple instead of landing there exactly.)
    fireEvent.keyDown(lowThumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith([30, 50]);
  });

  it('swaps thumbs (sorted tuple) when a keyboard move drags the high thumb past the low thumb', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[70, 100]}
        min={0}
        max={200}
        step={50}
        onChange={onChange}
      />,
    );
    const highThumb = screen.getByRole('slider', { name: 'Range maximum' });
    highThumb.focus();
    // high (100) - step (50) = 50, past the low thumb (70) — sorted
    // ascending by Radix, matching the previous hand-rolled swap logic.
    fireEvent.keyDown(highThumb, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith([50, 70]);
  });

  it('honours a custom step size on Arrow-key increments', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Range"
        value={[10, 50]}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    lowThumb.focus();
    fireEvent.keyDown(lowThumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith([15, 50]);
  });

  it('disables both thumbs when disabled', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        label="Locked"
        value={[10, 90]}
        min={0}
        max={100}
        disabled
        onChange={onChange}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Locked minimum' });
    const highThumb = screen.getByRole('slider', { name: 'Locked maximum' });
    // Radix marks disabled thumbs via `data-disabled` and removes them
    // from the tab order (no `tabindex` attribute at all) instead of a
    // native `disabled` IDL property, which a non-form `<span>` has no
    // concept of.
    expect(lowThumb).toHaveAttribute('data-disabled');
    expect(highThumb).toHaveAttribute('data-disabled');
    expect(lowThumb).not.toHaveAttribute('tabindex');
    expect(highThumb).not.toHaveAttribute('tabindex');
    // Functionally inert too: Radix's own key handlers no-op when
    // disabled, regardless of whether the event reached the DOM node.
    fireEvent.keyDown(lowThumb, { key: 'Home' });
    fireEvent.keyDown(highThumb, { key: 'End' });
    expect(onChange).not.toHaveBeenCalled();
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

  it('gives each thumb an invisible ≥44px touch hit-area without growing the visual dot', () => {
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    const highThumb = screen.getByRole('slider', { name: 'Range maximum' });
    // `.touch-target-overlay` (web/src/index.css) renders an invisible
    // ::before hit-area extender to ≥44px without inflating the visual
    // 16px (`h-4 w-4`) thumb dot.
    expect(lowThumb).toHaveClass('touch-target-overlay', 'h-4', 'w-4');
    expect(highThumb).toHaveClass('touch-target-overlay', 'h-4', 'w-4');
  });

  it('prevents touch-scroll from hijacking a drag via touch-none on the slider root', () => {
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    const root = lowThumb.closest('.touch-none');
    expect(root).not.toBeNull();
  });

  it('threads the resolved i18n direction into the Radix slider root for correct RTL arrow-key/drag math', () => {
    i18nState.language = 'ar';
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    const root = lowThumb.closest('[dir]');
    expect(root).toHaveAttribute('dir', 'rtl');
  });

  it('defaults to ltr direction for non-RTL languages', () => {
    i18nState.language = 'en';
    render(
      <RangeSlider
        label="Range"
        value={[10, 90]}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );
    const lowThumb = screen.getByRole('slider', { name: 'Range minimum' });
    const root = lowThumb.closest('[dir]');
    expect(root).toHaveAttribute('dir', 'ltr');
  });
});
