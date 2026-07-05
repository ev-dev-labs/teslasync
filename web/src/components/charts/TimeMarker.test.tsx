/**
 * TimeMarker — behaviour, branch, null-safety + integration cover.
 *
 * TimeMarker is a pure, hook-free recharts child: given an x-axis value it
 * returns a single <ReferenceLine> (or null when there is no valid position).
 * Recharts measures its SVG bounding box and jsdom reports 0×0, so the line
 * never actually paints; we therefore assert the component's real contract by
 * reading the props off the returned <ReferenceLine> element — the same
 * technique ChartAnnotationLayer's test uses — plus one integration mount to
 * prove the element composes into a recharts chart. Network is never touched.
 */
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ReferenceLine, LineChart, Line, XAxis, YAxis } from 'recharts';
import { TimeMarker, severityTokens, type TimeMarkerProps } from './TimeMarker';
import { severityTokens as canonicalSeverityTokens } from '@/lib/tokens';

// The subset of recharts ReferenceLine props that TimeMarker drives.
interface RefLineLabel {
  value: string;
  position: string;
  fill: string;
  fontSize: number;
}
interface RefLineProps {
  x: string | number;
  yAxisId?: string | number;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  ifOverflow: string;
  label: RefLineLabel;
}

// TimeMarker is hook-free, so invoking it directly yields the element (or null)
// without depending on recharts laying out an SVG. This mirrors how
// ChartAnnotationLayer.test reads `.props` off the elements it returns.
function renderMarker(props: TimeMarkerProps): ReactElement | null {
  return TimeMarker(props);
}

// Assert the marker rendered and hand back its typed ReferenceLine props.
function markerProps(props: TimeMarkerProps): RefLineProps {
  const el = renderMarker(props);
  expect(el).not.toBeNull();
  return (el as ReactElement).props as RefLineProps;
}

// Canonical stroke palette — mirrors SEVERITY_STROKE inside the source. Pinned
// here (rather than imported) so the test locks the exact hex the component
// promises for each normalized severity.
const STROKE = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  critical: '#ef4444',
  success: '#10b981',
} as const;

describe('TimeMarker — rendered element + defaults', () => {
  it('returns a <ReferenceLine> at the given x carrying the documented defaults', () => {
    const el = renderMarker({ x: '12:30' });
    expect(el).not.toBeNull();
    expect((el as ReactElement).type).toBe(ReferenceLine);

    const p = (el as ReactElement).props as RefLineProps;
    expect(p.x).toBe('12:30');
    expect(p.strokeWidth).toBe(2);
    expect(p.ifOverflow).toBe('extendDomain');
    // Default severity is "warn" → amber stroke, echoed by the top label.
    expect(p.stroke).toBe(STROKE.warn);
    expect(p.label.value).toBe('Alert');
    expect(p.label.position).toBe('top');
    expect(p.label.fill).toBe(STROKE.warn);
    expect(p.label.fontSize).toBe(10);
  });

  it('renders a marker at the numeric-zero x-coordinate (0 is a valid index, not "empty")', () => {
    const p = markerProps({ x: 0 });
    expect(p.x).toBe(0);
    expect(p.stroke).toBe(STROKE.warn);
  });

  it('forwards label, strokeWidth, strokeDasharray, ifOverflow and yAxisId overrides', () => {
    const p = markerProps({
      x: 5,
      label: 'Peak',
      strokeWidth: 4,
      strokeDasharray: '3 3',
      ifOverflow: 'hidden',
      yAxisId: 'right',
    });
    expect(p.label.value).toBe('Peak');
    expect(p.strokeWidth).toBe(4);
    expect(p.strokeDasharray).toBe('3 3');
    expect(p.ifOverflow).toBe('hidden');
    expect(p.yAxisId).toBe('right');
  });
});

describe('TimeMarker — no-position branches render nothing', () => {
  const emptyCases: Array<[string, TimeMarkerProps['x']]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ];

  it.each(emptyCases)('returns null when x is %s', (_label, x) => {
    expect(renderMarker({ x })).toBeNull();
  });

  it('returns null for a non-finite numeric x (NaN / ±Infinity) rather than a broken marker', () => {
    // Regression guard: a failed Number(timestamp) parse used to flow straight
    // through to recharts as x={NaN}, positioning the line at an undefined
    // coordinate. A non-finite position means "no marker", same as null.
    expect(renderMarker({ x: Number.NaN })).toBeNull();
    expect(renderMarker({ x: Number.POSITIVE_INFINITY })).toBeNull();
    expect(renderMarker({ x: Number.NEGATIVE_INFINITY })).toBeNull();
  });
});

describe('TimeMarker — severity → colour mapping', () => {
  it('maps each canonical severity to its stroke + matching label fill', () => {
    (['info', 'warn', 'critical', 'success'] as const).forEach((sev) => {
      const p = markerProps({ x: 'x', severity: sev });
      expect(p.stroke).toBe(STROKE[sev]);
      expect(p.label.fill).toBe(STROKE[sev]);
    });
  });

  it('normalizes legacy severity aliases before colouring', () => {
    expect(markerProps({ x: 'x', severity: 'warning' }).stroke).toBe(STROKE.warn);
    expect(markerProps({ x: 'x', severity: 'error' }).stroke).toBe(STROKE.critical);
    expect(markerProps({ x: 'x', severity: 'fatal' }).stroke).toBe(STROKE.critical);
    expect(markerProps({ x: 'x', severity: 'ok' }).stroke).toBe(STROKE.success);
  });

  it('defaults null / undefined severity to warn (the documented default, not info)', () => {
    expect(markerProps({ x: 'x', severity: undefined }).stroke).toBe(STROKE.warn);
    expect(markerProps({ x: 'x', severity: null }).stroke).toBe(STROKE.warn);
  });

  it('falls back to the info colour for an unknown severity string', () => {
    expect(markerProps({ x: 'x', severity: 'nonsense' }).stroke).toBe(STROKE.info);
  });
});

describe('TimeMarker — re-export + chart integration', () => {
  it('re-exports the canonical severityTokens map by reference', () => {
    expect(severityTokens).toBe(canonicalSeverityTokens);
    expect(severityTokens.critical.dot).toBe('bg-red-400');
  });

  it('mounts as a valid child inside a recharts chart without throwing', () => {
    const data = [
      { t: '12:00', v: 1 },
      { t: '12:30', v: 2 },
    ];
    const { container } = render(
      <LineChart width={400} height={200} data={data}>
        <XAxis dataKey="t" />
        <YAxis />
        <Line dataKey="v" isAnimationActive={false} />
        {TimeMarker({ x: '12:30', severity: 'critical', label: 'Spike' })}
      </LineChart>,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.recharts-reference-line')).not.toBeNull();
  });
});
