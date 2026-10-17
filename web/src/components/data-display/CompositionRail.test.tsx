import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompositionRail, type CompositionRailSegment } from './CompositionRail';

const segments: readonly CompositionRailSegment[] = [
  { id: 'triaged', label: 'Triaged', widthPercent: 60, fillClassName: 'bg-amber-500', detail: '6 · 60%' },
  { id: 'new', label: 'New', widthPercent: 40, color: 'var(--theme-primary)', detail: <strong>4 · 40%</strong> },
];

describe('CompositionRail', () => {
  it('preserves supplied logical order in track and semantic legend, including RTL', () => {
    render(<div dir="rtl"><CompositionRail segments={segments} summary="Status composition" /></div>);
    const track = screen.getByRole('img');
    expect(track.children[0]).toHaveClass('bg-amber-500');
    expect(track.children[1]).toHaveStyle({ backgroundColor: 'var(--theme-primary)' });
    const entries = screen.getAllByRole('listitem');
    expect(within(entries[0]).getByText('Triaged')).toBeVisible();
    expect(within(entries[1]).getByText('New')).toBeVisible();
    expect(track).not.toHaveClass('flex-row-reverse');
    expect(screen.getByRole('list')).not.toHaveClass('flex-row-reverse');
  });

  it('names the categorical image without progress, meter or chart-engine semantics', () => {
    render(<CompositionRail segments={segments} summary="Répartition : 6 examinés, 4 nouveaux" />);
    const track = screen.getByRole('img', { name: 'Répartition : 6 examinés, 4 nouveaux' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(track).not.toHaveAttribute('aria-valuenow');
    expect(track.querySelector('svg, canvas')).toBeNull();
  });

  it('exposes caller labels and ReactNode details without hover or color dependence', () => {
    render(<CompositionRail segments={segments} summary="Status composition" />);
    const legend = screen.getByRole('list');
    expect(within(legend).getByText('6 · 60%')).toBeVisible();
    expect(within(legend).getByText('4 · 40%').tagName).toBe('STRONG');
    fireEvent.keyDown(legend, { key: 'Tab' });
    expect(within(legend).getByText('Triaged')).toBeVisible();
    expect(within(legend).getByText('4 · 40%')).toBeVisible();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    for (const fill of Array.from(screen.getByRole('img').children)) {
      expect(fill).toHaveAttribute('aria-hidden', 'true');
    }
    for (const entry of screen.getAllByRole('listitem')) {
      expect(entry.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('retains explicitly omitted tiny categories and counts in the default legend', () => {
    render(<CompositionRail summary="Small categories" segments={[
      { id: 'tiny', label: 'Rare', widthPercent: 0.2, fillClassName: 'bg-rose-500', detail: '1 · 0.2%', hideFromTrack: true },
      { id: 'visible', label: 'Also rare', widthPercent: 0.1, fillClassName: 'bg-cyan-500', detail: '1 · 0.1%' },
    ]} />);
    expect(screen.getByRole('img').children).toHaveLength(1);
    expect(screen.getByRole('img').firstElementChild).toHaveStyle({ width: '0.1%' });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Rare')).toBeVisible();
    expect(screen.getByText('1 · 0.2%')).toBeVisible();
  });

  it('keeps zero-width evidence without inventing a value when detail is omitted', () => {
    render(<CompositionRail summary="Zero category" segments={[
      { id: 'zero', label: 'Closed', widthPercent: 0, fillClassName: 'bg-emerald-500', detail: 0 },
      { id: 'unknown', label: 'Unknown', widthPercent: 0, fillClassName: 'bg-amber-500' },
    ]} />);
    expect(screen.getByRole('img').children).toHaveLength(2);
    expect(screen.getByRole('img').firstElementChild).toHaveStyle({ width: '0%' });
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent(/^Unknown$/);
  });

  it('uses exact prepared percentages without rounding or parsing caller details', () => {
    render(<CompositionRail summary="Prepared composition" segments={[
      { id: 'prepared', label: 'Prepared', widthPercent: 12.3456789, fillClassName: 'bg-cyan-500', detail: '999 · caller text' },
    ]} />);
    expect(screen.getByRole('img').firstElementChild).toHaveStyle({ width: '12.3456789%' });
    expect(screen.getByText('999 · caller text')).toBeVisible();
    expect(screen.queryByText('12.3456789%')).not.toBeInTheDocument();
  });

  it.each([[20, 30], [80, 90]])('does not renormalize a total of %s + %s', (first, second) => {
    render(<CompositionRail summary="Unnormalized composition" segments={[
      { id: 'a', label: 'A', widthPercent: first, fillClassName: 'bg-cyan-500' },
      { id: 'b', label: 'B', widthPercent: second, fillClassName: 'bg-amber-500' },
    ]} />);
    const fills = screen.getByRole('img').children;
    expect(fills[0]).toHaveStyle({ width: `${first}%` });
    expect(fills[1]).toHaveStyle({ width: `${second}%` });
    expect(fills[0]).toHaveClass('shrink-0');
    expect(fills[1]).toHaveClass('shrink-0');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a caller-named empty track without fabricated no-data text or categories', () => {
    render(<CompositionRail segments={[]} summary="Composition not supplied" />);
    expect(screen.getByRole('img', { name: 'Composition not supplied' }).children).toHaveLength(0);
    expect(screen.getByRole('list')).toBeEmptyDOMElement();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText(/no data/i)).not.toBeInTheDocument();
  });

  it('accepts frozen readonly segments without mutation across rerenders', () => {
    const frozen = Object.freeze(segments.map((segment) => Object.freeze({ ...segment })));
    const before = frozen.map((segment) => ({ ...segment }));
    const { rerender } = render(<CompositionRail segments={frozen} summary="Initial composition" />);
    rerender(<CompositionRail segments={frozen} summary="Refreshed composition" size="lg" />);
    expect(frozen).toEqual(before);
    expect(screen.getByRole('img').children[0]).toHaveStyle({ width: '60%' });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Triaged');
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 100.1, '50' as unknown as number, undefined as unknown as number])(
    'rejects malformed widthPercent %s instead of normalizing or emitting invalid CSS',
    (widthPercent) => {
      const invalid: readonly CompositionRailSegment[] = [
        { id: 'invalid', label: 'Invalid', widthPercent, fillClassName: 'bg-cyan-500' },
      ];
      expect(() => CompositionRail({ segments: invalid, summary: 'Invalid composition' })).toThrow(RangeError);
      expect(() => CompositionRail({ segments: invalid, summary: 'Invalid composition' }))
        .toThrow('segment "invalid" widthPercent must be a finite number between 0 and 100');
    },
  );

  it('rejects duplicate stable ids including a visually omitted segment', () => {
    expect(() => CompositionRail({ summary: 'Duplicate composition', segments: [
      { id: 'same', label: 'First', widthPercent: 100, fillClassName: 'bg-cyan-500' },
      { id: 'same', label: 'Second', widthPercent: 0, fillClassName: 'bg-rose-500', hideFromTrack: true },
    ] })).toThrow('CompositionRail: duplicate segment id "same".');
  });

  it.each([['sm', 'h-2.5'], ['md', 'h-3'], ['lg', 'h-8']] as const)(
    'supports the %s source track size and outer class override',
    (size, height) => {
      const { container } = render(<CompositionRail segments={segments} summary="Sized composition" size={size} className="space-y-4 max-w-xs" />);
      expect(screen.getByRole('img')).toHaveClass(height);
      expect(container.firstElementChild).toHaveClass('space-y-4', 'max-w-xs');
      expect(container.firstElementChild).not.toHaveClass('space-y-3');
    },
  );

  it('defaults to the compact source track height', () => {
    render(<CompositionRail segments={segments} summary="Default composition" />);
    expect(screen.getByRole('img')).toHaveClass('h-2.5');
  });

  it('wraps long labels and details in narrow containers without truncating evidence', () => {
    const label = 'UnbrokenCategoryName'.repeat(10);
    const detail = 'Caller-prepared explanation with all counts preserved';
    render(<CompositionRail summary="Long composition" className="w-32" segments={[
      { id: 'long', label, widthPercent: 100, fillClassName: 'bg-cyan-500', detail },
    ]} />);
    const entry = screen.getByRole('listitem');
    expect(entry).toHaveClass('min-w-0', 'max-w-full');
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText(label).parentElement).toHaveClass('break-words', '[overflow-wrap:anywhere]');
    expect(screen.getByText(label)).not.toHaveClass('truncate', 'line-clamp-1');
    expect(screen.getByText(detail)).toBeVisible();
  });

  it('provides forced-color outlines and reduced-motion classes without an animation engine', () => {
    render(<CompositionRail segments={segments} summary="Accessible composition" />);
    const track = screen.getByRole('img');
    expect(track).toHaveClass('forced-colors:[outline-style:solid]', 'forced-colors:outline-1', 'forced-colors:outline-[CanvasText]');
    for (const fill of Array.from(track.children)) {
      expect(fill).toHaveClass('forced-colors:[outline-style:solid]', 'forced-colors:outline-1', 'forced-colors:outline-[CanvasText]', 'motion-reduce:transition-none', 'motion-reduce:animate-none');
    }
    for (const entry of screen.getAllByRole('listitem')) {
      expect(entry.firstElementChild).toHaveClass('forced-colors:[outline-style:solid]', 'forced-colors:outline-1', 'forced-colors:outline-[CanvasText]');
    }
  });
});
