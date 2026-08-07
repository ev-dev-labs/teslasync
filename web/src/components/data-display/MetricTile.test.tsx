/**
 * MetricTile — behaviour + hardening contract.
 *
 * MetricTile is the replacement for RadialGauge at call sites whose value has
 * no meaningful 100%. The defect it exists to fix is arithmetic, not cosmetic:
 * `max={Math.max(count, 50)}` renders a ring pinned at exactly 100% for every
 * count above 50, and `max={value * 1.5}` pins it at exactly 66.7% for every
 * value — an identical arc regardless of the reading.
 *
 * These tests pin:
 *   - discrimination — distinct readings must produce distinct output, the
 *     property the self-scaled rings could not satisfy;
 *   - null-safety — the API values these tiles render are optional at runtime
 *     despite their `number` type, so null / undefined / NaN / Infinity must
 *     degrade to an em-dash rather than printing "NaN" to the reader;
 *   - a genuine 0 is a reading, not an absence;
 *   - formatting — decimals default sensibly and are overridable, and the unit
 *     suffix is suppressed when there is no value to attach it to.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { MetricTile } from './MetricTile';
import { fmtNumber } from '@/lib/numberFormat';

function renderTile(props: Partial<React.ComponentProps<typeof MetricTile>> = {}) {
  return render(<MetricTile value={42} label="Sessions" {...props} />);
}

afterEach(() => cleanup());

/* ── A. Discrimination — the whole point ───────────────────────────────────── */

describe('MetricTile — discrimination', () => {
  it('renders different text for different readings', () => {
    const { container: a } = renderTile({ value: 12 });
    const first = a.textContent;
    cleanup();

    const { container: b } = renderTile({ value: 1200 });
    expect(b.textContent).not.toBe(first);
  });

  it('renders a count above any former self-scaled floor verbatim', () => {
    // `max={Math.max(count, 50)}` made 51, 500 and 5000 all render a full ring.
    // Values are locale-grouped, so compare against the same formatter the
    // component uses rather than a bare String(n).
    for (const n of [51, 500, 5000]) {
      renderTile({ value: n });
      expect(screen.getByText(fmtNumber(n, 0))).toBeInTheDocument();
      cleanup();
    }
  });
});

/* ── B. Null-safety ────────────────────────────────────────────────────────── */

describe('MetricTile — null-safety', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['empty string', ''],
  ])('degrades a %s value to an em-dash', (_name, value) => {
    const { container } = renderTile({ value: value as never });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('suppresses the unit when there is no value to attach it to', () => {
    renderTile({ value: null, unit: 'kWh' });
    expect(screen.queryByText('kWh')).not.toBeInTheDocument();
  });

  it('treats a genuine 0 as a reading, not an absence', () => {
    renderTile({ value: 0, unit: 'kWh' });
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});

/* ── C. Formatting ─────────────────────────────────────────────────────────── */

describe('MetricTile — formatting', () => {
  it('renders integers without a decimal tail by default', () => {
    renderTile({ value: 250 });
    expect(screen.getByText('250')).toBeInTheDocument();
  });

  it('honours an explicit decimals override', () => {
    renderTile({ value: 12.3456, decimals: 1 });
    expect(screen.getByText('12.3')).toBeInTheDocument();
  });

  it('passes a pre-formatted string through untouched', () => {
    renderTile({ value: '1,234.5' });
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
  });

  it('renders the label, unit and sublabel', () => {
    renderTile({ value: 42, unit: 'kWh', label: 'Energy', sublabel: 'across 12 sessions' });
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByText('across 12 sessions')).toBeInTheDocument();
  });

  it('omits the sublabel row when none is supplied', () => {
    const { container } = renderTile({ value: 42, label: 'Energy' });
    expect(container.textContent).toBe('42Energy');
  });
});

/* ── D. Presentation ───────────────────────────────────────────────────────── */

describe('MetricTile — presentation', () => {
  it('centres by default and left-aligns on request', () => {
    const { container: centered } = renderTile();
    expect(centered.firstElementChild?.className).toContain('items-center');
    cleanup();

    const { container: start } = renderTile({ align: 'start' });
    expect(start.firstElementChild?.className).toContain('items-start');
  });

  it('applies the accent colour only when there is a value', () => {
    renderTile({ value: 42, accentClass: 'text-cyan-300' });
    expect(screen.getByText('42').className).toContain('text-cyan-300');
    cleanup();

    renderTile({ value: null, accentClass: 'text-cyan-300' });
    expect(screen.getByText('—').className).not.toContain('text-cyan-300');
  });
});
