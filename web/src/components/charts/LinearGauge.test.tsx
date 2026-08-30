/**
 * LinearGauge — behaviour, geometry, robustness and a11y.
 *
 * LinearGauge replaced the app's radial gauges. The suite pins the reasons that
 * replacement happened, so a future refactor cannot quietly undo them:
 *   - the fill is a visible proportion of a track with a real, visible end;
 *   - the numeric ends of the scale are PRINTED, not hidden in `aria-valuemax`
 *     (the core defect of the ring it replaced);
 *   - percent-ness is decided by the UNIT, not by the numbers, so a 0–100 °C
 *     scale still states its range while a 0–100 % one does not;
 *   - offset (interval) scales measure from `min`, so a converted temperature
 *     draws the same bar in °C and °F;
 *   - non-finite / nullish runtime values degrade to a finite empty bar rather
 *     than `width: NaN%`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { LinearGauge } from './LinearGauge';
import { gaugeTone, resolveGaugeColor, type GaugeTone } from '@/lib/tokens';
import { setGlobalPrecision } from '@/lib/numberFormat';

/** The gauge renders exactly one width-driven fill element inside the track. */
const fill = (c: HTMLElement) => c.querySelector<HTMLElement>('[style*="width"]');
const fillPct = (c: HTMLElement) => fill(c)?.style.width ?? '';
/** The optional reference tick drawn on the track. */
const marker = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="gauge-marker"]');

describe('LinearGauge — rendering & content', () => {
  it('renders the value, the unit, and the label as distinct text nodes', () => {
    render(<LinearGauge value={72} max={100} label="Battery" unit="%" />);

    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('formats the reading through fmtNumber (locale thousands separators)', () => {
    render(<LinearGauge value={1500} max={2000} label="Range" />);
    expect(screen.getByText('1,500')).toBeInTheDocument();
  });

  it('omits the unit element entirely when no unit is supplied', () => {
    render(<LinearGauge value={5} max={10} label="Bare" />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '5');
  });
});

describe('LinearGauge — ARIA meter semantics', () => {
  it('exposes the gauge as a labelled meter with value / min / max / valuetext', () => {
    render(<LinearGauge value={72} max={100} label="Battery" unit="%" />);

    const meter = screen.getByRole('meter', { name: 'Battery' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72%');
  });

  it('announces the clamped value, matching what the bar actually draws', () => {
    render(<LinearGauge value={150} max={100} label="Battery" unit="%" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('LinearGauge — fill geometry', () => {
  it('fills the track in proportion to value / max', () => {
    const { container } = render(<LinearGauge value={25} max={100} label="X" />);
    expect(fillPct(container)).toBe('25%');
  });

  it('draws an empty track at zero', () => {
    const { container } = render(<LinearGauge value={0} max={100} label="X" />);
    expect(fillPct(container)).toBe('0%');
  });

  it('caps an over-max reading at a full track rather than overflowing', () => {
    const { container } = render(<LinearGauge value={250} max={100} label="X" />);
    expect(fillPct(container)).toBe('100%');
  });

  it('clamps a negative reading to an empty track', () => {
    const { container } = render(<LinearGauge value={-40} max={100} label="X" />);
    expect(fillPct(container)).toBe('0%');
  });
});

describe('LinearGauge — offset scales (min prop)', () => {
  it('defaults min to 0 so the plain 0→max bar is unchanged', () => {
    const { container } = render(<LinearGauge value={50} max={200} label="Motor" />);
    expect(fillPct(container)).toBe('25%');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemin', '0');
  });

  it('measures the fill from min, not from zero', () => {
    // (150 - 100) / (200 - 100) = 50%.
    const { container } = render(<LinearGauge value={150} min={100} max={200} label="Motor" />);
    expect(fillPct(container)).toBe('50%');
  });

  it('draws the same bar for the same temperature in either unit', () => {
    // 20 °C on a 0–50 °C scale and 68 °F on a 32–122 °F scale are one reading.
    const c = render(<LinearGauge value={20} min={0} max={50} label="Ambient" />);
    const celsius = fillPct(c.container);
    c.unmount();

    const f = render(<LinearGauge value={68} min={32} max={122} label="Ambient" />);
    expect(fillPct(f.container)).toBe(celsius);
  });

  it('reports the shifted range on the ARIA meter', () => {
    render(<LinearGauge value={150} min={100} max={200} label="Motor" />);
    const meter = screen.getByRole('meter', { name: 'Motor' });
    expect(meter).toHaveAttribute('aria-valuemin', '100');
    expect(meter).toHaveAttribute('aria-valuemax', '200');
  });

  it('ignores a min at or above max instead of inverting the scale', () => {
    const { container } = render(<LinearGauge value={50} min={200} max={100} label="Motor" />);
    expect(fillPct(container)).toBe('50%');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemin', '0');
  });
});

describe('LinearGauge — robustness against non-finite runtime values', () => {
  it('renders an empty track (not NaN) for an undefined value', () => {
    const { container } = render(
      <LinearGauge value={undefined as unknown as number} max={100} label="X" />,
    );
    expect(fillPct(container)).toBe('0%');
    expect(container.textContent).not.toContain('NaN');
  });

  it('renders an empty track (not NaN) for a NaN value', () => {
    const { container } = render(<LinearGauge value={NaN} max={100} label="X" />);
    expect(fillPct(container)).toBe('0%');
    expect(container.textContent).not.toContain('NaN');
  });

  it('survives a zero max without dividing by zero', () => {
    const { container } = render(<LinearGauge value={5} max={0} label="X" />);
    expect(fillPct(container)).toBe('0%');
    expect(container.textContent).not.toContain('NaN');
  });

  it('survives a NaN max', () => {
    const { container } = render(<LinearGauge value={5} max={NaN} label="X" />);
    expect(fillPct(container)).toBe('0%');
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('LinearGauge — decimals', () => {
  afterEach(() => setGlobalPrecision(1));

  it('honours an explicit decimals override', () => {
    render(<LinearGauge value={12.3456} max={100} label="X" decimals={2} />);
    expect(screen.getByText('12.35')).toBeInTheDocument();
  });

  it('renders whole numbers without a decimal tail', () => {
    render(<LinearGauge value={42} max={100} label="X" />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

describe('LinearGauge — printed scale caption', () => {
  // The regression this guards: the ring's ceiling existed only in
  // `aria-valuemax`, so a sighted reader saw a fill with no way to know what a
  // full gauge meant. Every non-percentage scale must state where it ends.
  it('prints the range for a non-percentage scale', () => {
    render(<LinearGauge value={120} max={250} label="Power" unit=" kW" />);
    expect(screen.getByText('0 – 250 kW')).toBeInTheDocument();
  });

  it('omits the caption for a 0–100 percentage, which is self-describing', () => {
    render(<LinearGauge value={72} max={100} label="Battery" unit="%" />);
    expect(screen.queryByText('0 – 100%')).not.toBeInTheDocument();
  });

  it('captions a 0–100 scale whose unit is NOT a percentage', () => {
    render(<LinearGauge value={55} max={100} label="Motor" unit="°C" />);
    expect(screen.getByText('0 – 100°C')).toBeInTheDocument();
  });

  it('omits the caption for a bare 0–100 gauge, which reads as a percentage', () => {
    const { container } = render(<LinearGauge value={72} max={100} label="Score" />);
    expect(container.textContent).not.toContain('0 – 100');
  });

  it('includes a non-zero min so offset scales state both ends', () => {
    render(<LinearGauge value={40} min={-20} max={150} label="Motor" unit="°C" />);
    expect(screen.getByText('-20 – 150°C')).toBeInTheDocument();
  });

  it('honours hideScale for callers that already print the ceiling themselves', () => {
    render(<LinearGauge value={120} max={250} label="Power" unit=" kW" hideScale />);
    expect(screen.queryByText('0 – 250 kW')).not.toBeInTheDocument();
  });

  it('drops a dash placeholder unit rather than printing it in the caption', () => {
    render(<LinearGauge value={0} max={150} label="Motor" unit="—" />);
    expect(screen.getByText('0 – 150')).toBeInTheDocument();
    expect(screen.queryByText('0 – 150—')).not.toBeInTheDocument();
  });

  it('formats large ceilings with locale grouping', () => {
    render(<LinearGauge value={800} max={1500} label="Cycles" />);
    expect(screen.getByText('0 – 1,500')).toBeInTheDocument();
  });

  it('suppresses the caption when the domain collapses to nothing', () => {
    const { container } = render(<LinearGauge value={5} max={0} label="Broken" unit=" kW" />);
    expect(container.textContent).not.toContain('–');
  });

  it('keeps the caption out of the accessible name of the meter', () => {
    render(<LinearGauge value={120} max={250} label="Power" unit=" kW" />);
    expect(screen.getByRole('meter', { name: 'Power' })).toBeInTheDocument();
  });
});

describe('LinearGauge — presentation', () => {
  it('applies the caller colour to the fill, not to the track', () => {
    const { container } = render(
      <LinearGauge value={50} max={100} label="X" color="#ff0000" />,
    );
    expect(fill(container)?.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('scales the readout and track weight with the size prop', () => {
    const small = render(<LinearGauge value={50} max={100} label="X" size={70} />);
    const smallTrack = small.container.querySelector('.h-2');
    expect(smallTrack).toBeInTheDocument();
    small.unmount();

    const large = render(<LinearGauge value={50} max={100} label="X" size={180} />);
    expect(large.container.querySelector('.h-3')).toBeInTheDocument();
  });

  it('merges a caller className onto the meter root', () => {
    render(<LinearGauge value={1} max={10} label="X" className="mt-4" />);
    expect(screen.getByRole('meter')).toHaveClass('mt-4');
  });

  it('forwards the ref to the meter root element', () => {
    const ref = createRef<HTMLDivElement>();
    render(<LinearGauge ref={ref} value={10} max={100} label="X" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveAttribute('role', 'meter');
  });
});

describe('LinearGauge — reference marker', () => {
  afterEach(cleanup);

  it('omits the marker entirely when none is given', () => {
    const { container } = render(<LinearGauge value={50} max={100} label="Battery" unit="%" />);
    expect(marker(container)).toBeNull();
  });

  it('positions the marker at its proportion of the scale', () => {
    const { container } = render(
      <LinearGauge value={50} max={100} label="Battery" unit="%" marker={80} />,
    );
    expect(marker(container)?.style.left).toBe('80%');
  });

  it('measures the marker from min on an offset scale, like the fill', () => {
    // 100 on a 50–150 scale is the midpoint, not two-thirds.
    const { container } = render(
      <LinearGauge value={75} max={150} min={50} label="Motor" unit="°C" marker={100} />,
    );
    expect(marker(container)?.style.left).toBe('50%');
  });

  it('drops a marker outside the scale rather than pinning it to an edge', () => {
    // Pinning would draw a limit at 100% that the reading can never exceed,
    // implying a reachable target that does not exist.
    const { container: over } = render(
      <LinearGauge value={50} max={100} label="Battery" unit="%" marker={140} />,
    );
    expect(marker(over)).toBeNull();
    cleanup();

    const { container: under } = render(
      <LinearGauge value={50} max={100} min={20} label="Battery" unit="%" marker={5} />,
    );
    expect(marker(under)).toBeNull();
  });

  it('drops a non-finite marker instead of emitting left: NaN%', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { container } = render(
        <LinearGauge value={50} max={100} label="Battery" unit="%" marker={bad} />,
      );
      expect(marker(container)).toBeNull();
      cleanup();
    }
  });

  it('labels the marker for assistive tech and pointer users', () => {
    const { container } = render(
      <LinearGauge value={50} max={100} label="Battery" unit="%" marker={80} markerLabel="Limit 80%" />,
    );
    expect(marker(container)).toHaveAttribute('title', 'Limit 80%');
  });

  it('keeps the fill readable as the only coloured quantity', () => {
    // The marker must not be picked up as a second gauge fill (it carries no
    // inline background colour), or every gauge-colour assertion would double.
    const { container } = render(
      <LinearGauge value={50} max={100} label="Battery" unit="%" color="#10b981" marker={80} />,
    );
    expect(container.querySelectorAll('[style*="background-color"]')).toHaveLength(1);
    expect(fillPct(container)).toBe('50%');
  });
});

describe('LinearGauge — accessible naming', () => {
  afterEach(cleanup);

  it('names the meter from the visible label by default', () => {
    render(<LinearGauge value={50} max={100} label="Battery" unit="%" />);
    expect(screen.getByRole('meter')).toHaveAccessibleName('Battery');
  });

  it('names a deliberately unlabelled meter from ariaLabel', () => {
    // A gauge inside an already-titled tile hides its own label to avoid
    // repeating it visually — but an unnamed meter is announced as bare digits.
    render(<LinearGauge value={20} max={100} label="" ariaLabel="Backup Reserve" unit="%" />);

    const meter = screen.getByRole('meter', { name: 'Backup Reserve' });
    expect(meter).toHaveAttribute('aria-valuenow', '20');
    expect(meter).toHaveAttribute('aria-valuetext', '20%');
    // ...and the name is not duplicated as visible text.
    expect(screen.queryByText('Backup Reserve')).toBeNull();
  });

  it('prefers ariaLabel over the visible label when both are given', () => {
    render(<LinearGauge value={5} max={10} label="Pack" ariaLabel="Battery pack health" />);
    expect(screen.getByRole('meter')).toHaveAccessibleName('Battery pack health');
  });

  it('leaves the meter unnamed rather than naming it an empty string', () => {
    render(<LinearGauge value={5} max={10} label="" />);
    expect(screen.getByRole('meter')).not.toHaveAttribute('aria-label');
  });
});

describe('LinearGauge — semantic tones', () => {
  afterEach(cleanup);

  /**
   * jsdom serialises a hex fill as `rgb(r, g, b)` but leaves a `var(--x)`
   * reference verbatim, so tone assertions compare against whatever the
   * central map declares, run through the same normalisation.
   */
  const expectedFill = (tone: GaugeTone) => {
    const declared = gaugeTone[tone];
    if (!declared.startsWith('#')) return declared;
    const n = Number.parseInt(declared.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };

  const TONES: GaugeTone[] = [
    'primary', 'accent', 'success', 'warning', 'danger', 'info', 'purple', 'neutral',
  ];

  it.each(TONES)('paints the %s tone from the central gaugeTone map', (tone) => {
    const { container } = render(<LinearGauge value={50} max={100} label="X" tone={tone} />);
    expect(fill(container)?.style.backgroundColor).toBe(expectedFill(tone));
  });

  it('resolves the theme tones through CSS variables so presets can re-tint them', () => {
    // The regression this guards: a hardcoded `#3b82f6` stayed blue on the warm
    // / light / custom presets because a hex literal cannot follow the theme.
    for (const tone of ['primary', 'accent'] as const) {
      const { container } = render(<LinearGauge value={50} max={100} label="X" tone={tone} />);
      expect(fill(container)?.style.backgroundColor).toMatch(/^var\(--theme-/);
      cleanup();
    }
  });

  it('keeps the status tones fixed so danger reads as danger on every preset', () => {
    for (const tone of ['success', 'warning', 'danger', 'info', 'purple'] as const) {
      expect(gaugeTone[tone]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defaults to the theme primary tone when neither tone nor colour is given', () => {
    const { container } = render(<LinearGauge value={50} max={100} label="X" />);
    expect(fill(container)?.style.backgroundColor).toBe(gaugeTone.primary);
  });

  it('lets a raw colour through untouched when no tone is supplied', () => {
    const { container } = render(<LinearGauge value={50} max={100} label="X" color="#ff00ff" />);
    expect(fill(container)?.style.backgroundColor).toBe('rgb(255, 0, 255)');
  });

  it('prefers the tone over a raw colour when both are supplied', () => {
    // Precedence is deliberate: `tone` is the migrated, semantic input, so a
    // stale `color` left beside it must not silently win.
    const { container } = render(
      <LinearGauge value={50} max={100} label="X" tone="danger" color="#00ff00" />,
    );
    expect(fill(container)?.style.backgroundColor).toBe(expectedFill('danger'));
  });

  it('leaves geometry, scale caption and ARIA untouched by the tone', () => {
    const { container } = render(
      <LinearGauge value={120} max={250} label="Power" unit=" kW" tone="warning" />,
    );
    expect(fillPct(container)).toBe('48%');
    expect(screen.getByText('0 – 250 kW')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Power' })).toHaveAttribute('aria-valuenow', '120');
  });
});

describe('resolveGaugeColor — precedence contract', () => {
  it('returns the tone colour when a tone is given, ignoring any raw colour', () => {
    expect(resolveGaugeColor('success', '#123456')).toBe(gaugeTone.success);
    expect(resolveGaugeColor('primary')).toBe(gaugeTone.primary);
  });

  it('falls back to the raw colour when no tone is given', () => {
    expect(resolveGaugeColor(undefined, '#123456')).toBe('#123456');
  });

  it('falls back to the theme primary when neither input is given', () => {
    expect(resolveGaugeColor()).toBe(gaugeTone.primary);
  });

  it('ignores an unknown runtime tone rather than emitting undefined', () => {
    // Tones are frequently data-driven (`tone={TONE_BY_STATUS[status]}`); a
    // value outside the union at runtime must not produce `background: undefined`.
    expect(resolveGaugeColor('bogus' as GaugeTone, '#123456')).toBe('#123456');
    expect(resolveGaugeColor('bogus' as GaugeTone)).toBe(gaugeTone.primary);
  });
});
