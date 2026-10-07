/**
 * ThresholdBar — a reading shown against the thresholds that give it meaning.
 *
 * This primitive exists because a radial ring implies "proportion of a whole",
 * which only reads correctly when 100% is a real state. The properties locked
 * here are the ones that make it an honest replacement:
 *
 *   A. Geometry — the marker position is `(value - min) / (max - min)`, i.e.
 *      the domain floor is honoured rather than assumed to be zero, and the
 *      value is clamped into the domain at both ends.
 *   B. Discrimination — the defect that motivated the migration was gauges
 *      whose arc could not vary. Distinct readings MUST produce distinct
 *      marker positions.
 *   C. Bands — segments are clipped to the domain, zero-width bands are
 *      dropped, and the band containing the reading is named in text so
 *      colour is never the sole carrier of meaning.
 *   D. Null-safety — undefined / NaN / inverted domains must never emit
 *      `NaN%` into the style attribute.
 *   E. Accessibility — role/meter ARIA reflects the real domain and the
 *      active band.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThresholdBar, type ThresholdBand } from './ThresholdBar';

const BANDS: ThresholdBand[] = [
  { from: 20, to: 29, color: '#ef4444', label: 'Critical' },
  { from: 29, to: 36, color: '#f59e0b', label: 'Low' },
  { from: 36, to: 51, color: '#10b981', label: 'Normal' },
  { from: 51, to: 58, color: '#f59e0b', label: 'High' },
  { from: 58, to: 65, color: '#ef4444', label: 'Over' },
];

/** The marker is the only element carrying a `left` style plus -translate-x-1/2. */
function markerLeft(container: HTMLElement): string {
  const el = container.querySelector<HTMLElement>('.-translate-x-1\\/2');
  if (!el) throw new Error('marker not found');
  return el.style.left;
}

function renderBar(props: Partial<React.ComponentProps<typeof ThresholdBar>> = {}) {
  return render(
    <ThresholdBar value={47} min={20} max={65} label="Front Left" unit="psi" {...props} />,
  );
}

afterEach(() => cleanup());

// ── A. Geometry ─────────────────────────────────────────────────────────────

describe('ThresholdBar — geometry', () => {
  it('positions the marker relative to the domain floor, not zero', () => {
    // 47 on a 20..65 domain = (47-20)/45 = 60%. On a 0-anchored scale it would
    // have been 72.3% — the whole point of the migration.
    const { container } = renderBar({ value: 47 });
    expect(markerLeft(container)).toBe('60%');
  });

  it('puts the domain endpoints at 0% and 100%', () => {
    const { container: lo } = renderBar({ value: 20 });
    expect(markerLeft(lo)).toBe('0%');
    cleanup();
    const { container: hi } = renderBar({ value: 65 });
    expect(markerLeft(hi)).toBe('100%');
  });

  it('clamps readings outside the domain to its ends', () => {
    const { container: under } = renderBar({ value: -400 });
    expect(markerLeft(under)).toBe('0%');
    cleanup();
    const { container: over } = renderBar({ value: 10_000 });
    expect(markerLeft(over)).toBe('100%');
  });

  it('places a target tick using the same domain mapping', () => {
    const { container } = renderBar({ value: 47, target: 42.5 });
    // (42.5-20)/45 = 50%
    const tick = container.querySelector<HTMLElement>('.w-px');
    expect(tick?.style.left).toBe('50%');
  });
});

// ── B. Discrimination (the regression this migration is about) ──────────────

describe('ThresholdBar — discrimination', () => {
  it('renders visibly different positions for different readings', () => {
    // The replaced gauges used max = value * 1.5, pinning every reading to the
    // same arc. Distinct inputs must now yield distinct geometry.
    const seen = new Set<string>();
    for (const v of [22, 30, 38, 47, 55, 63]) {
      const { container } = renderBar({ value: v });
      seen.add(markerLeft(container));
      cleanup();
    }
    expect(seen.size).toBe(6);
  });

  it('separates a healthy tyre from an under-inflated one', () => {
    const { container: healthy } = renderBar({ value: 45 });
    const a = parseFloat(markerLeft(healthy));
    cleanup();
    const { container: soft } = renderBar({ value: 33 });
    const b = parseFloat(markerLeft(soft));

    // On the old 0..72.5 psi ring these differed by only 16 points; on the
    // meaningful domain the gap is far more legible.
    expect(a - b).toBeGreaterThan(25);
  });
});

// ── C. Bands ────────────────────────────────────────────────────────────────

describe('ThresholdBar — bands', () => {
  it('renders one segment per band, clipped to the domain', () => {
    const { container } = renderBar({ bands: BANDS });
    const segs = container.querySelectorAll('.absolute.inset-y-0');
    // 5 bands (the target tick is absent here).
    expect(segs.length).toBe(5);

    const first = segs[0] as HTMLElement;
    expect(first.style.left).toBe('0%');
    // 20..29 of a 45-wide domain = 20%.
    expect(first.style.width).toBe('20%');
  });

  it('clips bands that overflow the domain instead of overdrawing', () => {
    const { container } = renderBar({
      bands: [{ from: -100, to: 200, color: '#10b981', label: 'Everything' }],
    });
    const seg = container.querySelector<HTMLElement>('.absolute.inset-y-0');
    expect(seg?.style.left).toBe('0%');
    expect(seg?.style.width).toBe('100%');
  });

  it('drops zero-width bands rather than emitting empty nodes', () => {
    const { container } = renderBar({
      bands: [
        { from: 30, to: 30, color: '#ef4444', label: 'Nothing' },
        { from: 36, to: 51, color: '#10b981', label: 'Normal' },
      ],
    });
    expect(container.querySelectorAll('.absolute.inset-y-0').length).toBe(1);
  });

  it('names the active band in text so colour is not the only signal', () => {
    renderBar({ value: 47, bands: BANDS });
    expect(screen.getByText('Normal')).toBeInTheDocument();
    cleanup();
    renderBar({ value: 25, bands: BANDS });
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  // Adjacent bands share an edge. A reading landing exactly on one must belong
  // to the band it is entering, matching how `if (v < LOW)` predicates bucket
  // the same number — otherwise the bar contradicts the page's own status text.
  it.each([
    [29, 'Low'],
    [36, 'Normal'],
    [51, 'High'],
    [58, 'Over'],
  ])('assigns a reading on the %i boundary to the upper band (%s)', (value, expected) => {
    renderBar({ value, bands: BANDS });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('keeps the domain floor in the first band and the ceiling in the last', () => {
    renderBar({ value: 20, bands: BANDS });
    expect(screen.getByText('Critical')).toBeInTheDocument();
    cleanup();
    renderBar({ value: 65, bands: BANDS });
    expect(screen.getByText('Over')).toBeInTheDocument();
  });

  // Callers owning an asymmetric predicate (`v < LOW` but `v > HIGH`) must be
  // able to override inference outright, so the bar can never contradict the
  // status the rest of the page is showing for the same reading.
  it('prefers an explicit statusLabel over the inferred band name', () => {
    renderBar({ value: 47, bands: BANDS, statusLabel: 'Within spec' });
    expect(screen.getByText('Within spec')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
  });

  it('carries an explicit statusLabel into the accessible value text', () => {
    renderBar({ value: 47, bands: BANDS, statusLabel: 'Within spec' });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '47psi — Within spec');
  });

  it('names the state even with no bands when statusLabel is given', () => {
    renderBar({ value: 47, statusLabel: 'Within spec' });
    expect(screen.getByText('Within spec')).toBeInTheDocument();
  });
});

// ── D. Null-safety ──────────────────────────────────────────────────────────

describe('ThresholdBar — null-safety', () => {
  it.each([
    ['undefined value', { value: undefined as unknown as number }],
    ['NaN value', { value: NaN }],
    ['undefined bounds', { min: undefined as unknown as number, max: undefined as unknown as number }],
    ['inverted domain', { min: 90, max: 10 }],
    ['zero-width domain', { min: 50, max: 50 }],
  ])('never emits NaN geometry for %s', (_name, props) => {
    const { container } = renderBar(props);
    expect(container.innerHTML).not.toContain('NaN');
    expect(markerLeft(container)).toMatch(/^[\d.]+%$/);
  });

  it('survives a missing bands array', () => {
    const { container } = renderBar({ bands: undefined });
    expect(container.querySelectorAll('.absolute.inset-y-0').length).toBe(0);
  });
});

// ── E. Accessibility ────────────────────────────────────────────────────────

describe('ThresholdBar — accessibility', () => {
  it('exposes the real domain through meter ARIA', () => {
    renderBar({ value: 47, bands: BANDS });
    const meter = screen.getByRole('meter', { name: 'Front Left' });
    expect(meter).toHaveAttribute('aria-valuenow', '47');
    expect(meter).toHaveAttribute('aria-valuemin', '20');
    expect(meter).toHaveAttribute('aria-valuemax', '65');
  });

  it('includes the active band name in the value text', () => {
    renderBar({ value: 47, bands: BANDS });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '47psi — Normal');
  });

  it('falls back to the bare reading when no band matches', () => {
    renderBar({ value: 47, bands: [] });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '47psi');
  });

  it('renders the reading and the domain end captions', () => {
    renderBar({ value: 47 });
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('20psi')).toBeInTheDocument();
    expect(screen.getByText('65psi')).toBeInTheDocument();
  });

  it('suppresses the end captions when hideScale is set', () => {
    renderBar({ value: 47, hideScale: true });
    expect(screen.queryByText('20psi')).toBeNull();
    expect(screen.queryByText('65psi')).toBeNull();
  });
});
