// BatteryPill unit tests.
//
// Facets covered:
//   1. Renders the label + fmtInt-formatted percentage.
//   2. Exposes the gauge as a labelled ARIA `meter` with the correct
//      valuenow/min/max/valuetext.
//   3. Traffic-light colour bands (>=60 good, 30-59 warning, <30 critical)
//      drive the fill colour.
//   4. Over-100 levels clamp the *track* to 100% while still reporting the
//      real reading.
//   5. Negative levels clamp the track to 0% and flag critical.
//   6. Non-finite runtime input (NaN) is coerced to 0 instead of producing a
//      `NaN%` width (regression guard).
//   7. Fractional levels round for display but keep a precise track width.
//   8. Custom className merges onto the panel without dropping base layout.
//   9. The decorative icon + fill stay out of the accessibility tree.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatteryPill } from './BatteryPill';
import { STATUS_COLORS } from '@/lib/colors';

function fill(): HTMLElement {
  const meter = screen.getByRole('meter');
  const child = meter.firstElementChild as HTMLElement | null;
  if (!child) throw new Error('battery meter is missing its fill element');
  return child;
}

describe('BatteryPill', () => {
  it('renders the label and the fmtInt-formatted percentage', () => {
    render(<BatteryPill level={72} label="Front Left" />);

    expect(screen.getByText('Front Left')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('exposes the gauge as a labelled meter with clamped value + valuetext', () => {
    render(<BatteryPill level={72} label="Front Left" />);

    const meter = screen.getByRole('meter', { name: 'Front Left' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72%');
  });

  it('paints the fill green in the healthy band (level >= 60)', () => {
    render(<BatteryPill level={85} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '85%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.good });
  });

  it('paints the fill amber in the warning band (30 <= level < 60)', () => {
    render(<BatteryPill level={45} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '45%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.warning });
  });

  it('paints the fill red in the critical band (level < 30)', () => {
    render(<BatteryPill level={12} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '12%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.critical });
  });

  it('clamps an over-100 level to a full track but reports the real reading', () => {
    render(<BatteryPill level={150} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '100%' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    // The textual readout is still the raw value, not the clamped track.
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.good });
  });

  it('clamps a negative level to an empty track and flags it critical', () => {
    render(<BatteryPill level={-10} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '0%' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.critical });
  });

  it('coerces a non-finite runtime level to 0 instead of a NaN width', () => {
    // Regression guard: the prop is typed `number` but real data can be NaN.
    render(<BatteryPill level={NaN} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '0%' });
    expect(fill().style.width).not.toContain('NaN');
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('rounds fractional levels for display but keeps a precise track width', () => {
    render(<BatteryPill level={85.7} label="Pack" />);

    // fmtInt rounds 85.7 -> "86" for the human-readable readout...
    expect(screen.getByText('86%')).toBeInTheDocument();
    // ...while the track geometry stays exact.
    expect(fill()).toHaveStyle({ width: '85.7%' });
  });

  it('merges a custom className onto the panel and keeps the base layout', () => {
    const { container } = render(
      <BatteryPill level={50} label="Pack" className="my-custom-pill" />,
    );

    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass('my-custom-pill');
    expect(panel).toHaveClass('flex', 'items-center', 'gap-3');
  });

  it('keeps the decorative fill out of the accessibility tree', () => {
    render(<BatteryPill level={50} label="Pack" />);

    expect(fill()).toHaveAttribute('aria-hidden', 'true');
    // Exactly one accessible gauge is exposed for the pill.
    expect(screen.getAllByRole('meter')).toHaveLength(1);
  });
});
