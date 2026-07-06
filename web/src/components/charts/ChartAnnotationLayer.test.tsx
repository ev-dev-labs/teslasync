import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ReferenceLine, LineChart, Line, XAxis, YAxis } from 'recharts';
import { renderAnnotationLines } from './ChartAnnotationLayer';
import { ANNOTATION_COLORS } from '@/types/annotations';
import type { AnnotationCategory, DataAnnotation } from '@/types/annotations';

// The label object recharts receives on each ReferenceLine.
interface RefLineLabel {
  value: string;
  position: string;
  fill: string;
  fontSize: number;
  fontWeight: number;
}
interface RefLineProps {
  x: number | string;
  stroke: string;
  strokeDasharray: string;
  strokeWidth: number;
  opacity: number;
  label: RefLineLabel;
}

function makeAnnotation(overrides: Partial<DataAnnotation> = {}): DataAnnotation {
  return {
    id: 'a1',
    timestamp: '2026-04-30T12:00:00Z',
    label: 'Service',
    category: 'maintenance',
    context: 'battery',
    createdAt: '2026-04-30T12:00:00Z',
    ...overrides,
  };
}

// `renderAnnotationLines` returns React elements; reading `.props` lets us
// assert the pure mapping logic without depending on recharts measuring an
// SVG bounding box (jsdom reports 0×0, so ReferenceLine never paints).
const propsOf = (el: React.ReactElement): RefLineProps => el.props as RefLineProps;

const identity = (ts: string): string => ts;

describe('renderAnnotationLines', () => {
  it('returns one ReferenceLine element per annotation, keyed by id and in order', () => {
    const annotations = [
      makeAnnotation({ id: 'a1' }),
      makeAnnotation({ id: 'a2' }),
      makeAnnotation({ id: 'a3' }),
    ];

    const lines = renderAnnotationLines(annotations, identity);

    expect(lines).toHaveLength(3);
    expect(lines.every((el) => el.type === ReferenceLine)).toBe(true);
    expect(lines.map((el) => el.key)).toEqual(['a1', 'a2', 'a3']);
  });

  it('maps every known category to its stroke + label fill color', () => {
    const categories: AnnotationCategory[] = [
      'milestone',
      'maintenance',
      'trip',
      'issue',
      'upgrade',
      'custom',
    ];

    for (const category of categories) {
      const [line] = renderAnnotationLines([makeAnnotation({ category })], identity);
      const p = propsOf(line);
      expect(p.stroke).toBe(ANNOTATION_COLORS[category]);
      expect(p.label.fill).toBe(ANNOTATION_COLORS[category]);
    }
  });

  it('projects each timestamp through toXValue and calls it with the raw timestamp', () => {
    const toX = vi.fn((ts: string) => (ts === '2026-01-01T00:00:00Z' ? 10 : 20));
    const annotations = [
      makeAnnotation({ id: 'a1', timestamp: '2026-01-01T00:00:00Z' }),
      makeAnnotation({ id: 'a2', timestamp: '2026-02-02T00:00:00Z' }),
    ];

    const lines = renderAnnotationLines(annotations, toX);

    expect(propsOf(lines[0]).x).toBe(10);
    expect(propsOf(lines[1]).x).toBe(20);
    expect(toX).toHaveBeenCalledTimes(2);
    expect(toX).toHaveBeenCalledWith('2026-01-01T00:00:00Z');
    expect(toX).toHaveBeenCalledWith('2026-02-02T00:00:00Z');
  });

  it('applies the shared dashed-line + top-label styling to each element', () => {
    const [line] = renderAnnotationLines(
      [makeAnnotation({ label: 'Tire rotation' })],
      identity,
    );
    const p = propsOf(line);

    expect(p.strokeDasharray).toBe('4 4');
    expect(p.strokeWidth).toBe(1.5);
    expect(p.opacity).toBe(0.7);
    expect(p.label.value).toBe('Tire rotation');
    expect(p.label.position).toBe('top');
    expect(p.label.fontSize).toBe(10);
    expect(p.label.fontWeight).toBe(500);
  });

  it('returns an empty array for an empty annotation list', () => {
    expect(renderAnnotationLines([], identity)).toEqual([]);
  });

  it('renders nothing (no throw) when the annotation list is nullish', () => {
    // Callers spread this helper straight into chart children; a hook that
    // hasn't resolved yet can hand us undefined/null instead of an array.
    expect(() =>
      renderAnnotationLines(undefined as unknown as DataAnnotation[], identity),
    ).not.toThrow();
    expect(renderAnnotationLines(undefined as unknown as DataAnnotation[], identity)).toEqual([]);
    expect(renderAnnotationLines(null as unknown as DataAnnotation[], identity)).toEqual([]);
  });

  it('falls back to the neutral custom color for an unknown category', () => {
    // Bad / forward-compat backend data: a category the frontend union does
    // not know about must not produce stroke={undefined} (an invisible line).
    const rogue = makeAnnotation({ category: 'quantum-event' as AnnotationCategory });

    const [line] = renderAnnotationLines([rogue], identity);
    const p = propsOf(line);

    expect(p.stroke).toBe(ANNOTATION_COLORS.custom);
    expect(p.label.fill).toBe(ANNOTATION_COLORS.custom);
    expect(p.stroke).toBeDefined();
  });

  it('coerces a missing label to an empty string rather than rendering "null"', () => {
    const noLabel = makeAnnotation({
      label: undefined as unknown as string,
    });

    const [line] = renderAnnotationLines([noLabel], identity);

    expect(propsOf(line).label.value).toBe('');
  });

  it('produces elements that mount as valid children inside a recharts chart', () => {
    const data = [
      { t: '2026-04-30T12:00:00Z', v: 1 },
      { t: '2026-04-30T13:00:00Z', v: 2 },
    ];
    const annotations = [makeAnnotation({ timestamp: '2026-04-30T12:00:00Z' })];

    const { container } = render(
      <LineChart width={400} height={200} data={data}>
        <XAxis dataKey="t" />
        <YAxis />
        <Line dataKey="v" />
        {renderAnnotationLines(annotations, (ts) => ts)}
      </LineChart>,
    );

    expect(container.querySelector('svg')).not.toBeNull();
  });
});
