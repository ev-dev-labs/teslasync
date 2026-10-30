import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Card, CardContent, CardFooter, CardHeader } from '../../ui/Card';
import { GlassPanel } from '../../ui/GlassPanel';
import { Button } from '../../ui/Button';
import { Grid } from '../Grid';
import { LayoutCard } from './LayoutCard';
import { SourceContent } from './SourceContent';
import { FormSection } from '../../forms/FormSection';
import cardLayoutCss from './card-layout.css?raw';
import { auditCardGeometry, collectCardGeometry } from '../../../../e2e/cardLayoutGeometry';

describe('shared intrinsic card-row anatomy', () => {
  it('preserves bounded scroll viewport heights while stretching their transparent row wrappers', () => {
    const style = document.createElement('style');
    style.textContent = `.bounded-test-viewport { height: 416px; }\n${cardLayoutCss}`;
    document.head.append(style);
    try {
      render(<div style={{ display: 'grid' }}>
        <aside data-testid="viewport-owner"><Card className="bounded-test-viewport" data-testid="viewport">Endpoint browser</Card></aside>
        <LayoutCard title="Request workspace">Original request controls</LayoutCard>
      </div>);
      expect(screen.getByTestId('viewport-owner')).toHaveAttribute('data-card-stretch', 'relay');
      expect(getComputedStyle(screen.getByTestId('viewport')).height).toBe('416px');
    } finally {
      style.remove();
    }
  });

  it('keeps form sections as independent surfaces instead of stretching nested configuration through a packed form rail', () => {
    const { container } = render(<div style={{ display: 'grid' }}>
      <section data-testid="form-rail">
        <FormSection title="General">Original general controls</FormSection>
        <FormSection title="When"><GlassPanel data-testid="nested-configuration">Original trigger configuration</GlassPanel></FormSection>
        <FormSection title="Then">Original action controls</FormSection>
      </section>
      <aside><GlassPanel>Original readiness checks</GlassPanel></aside>
    </div>);
    expect(screen.getByRole('group', { name: 'When' })).toHaveAttribute('data-surface-variant', 'standalone');
    expect(screen.getByTestId('nested-configuration')).not.toHaveAttribute('data-card-stretch');
    expect(screen.getByTestId('form-rail')).not.toHaveAttribute('data-card-stretch');
    const panels = screen.getAllByRole('group');
    const bounds = new Map<Element, [number, number, number, number]>([
      [container.firstElementChild!, [0, 0, 820, 1000]],
      [screen.getByTestId('form-rail'), [0, 0, 520, 1000]],
      [panels[0], [0, 0, 520, 300]],
      [panels[1], [0, 324, 520, 300]],
      [panels[2], [0, 648, 520, 352]],
      [screen.getByTestId('nested-configuration'), [20, 400, 480, 180]],
      [screen.getByText('Original readiness checks'), [540, 0, 280, 240]],
    ]);
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x, y, width, height] = bounds.get(this) ?? [0, 0, 0, 0];
      return new DOMRect(x, y, width, height);
    });
    try {
      const cards = collectCardGeometry();
      expect(cards).toHaveLength(4);
      expect(cards.filter(card => card.flow === 'masonry')).toHaveLength(3);
      expect(auditCardGeometry(cards)).toEqual([]);
    } finally {
      measure.mockRestore();
    }
  });

  it('allocates a legacy card beside retained column notes without applying full height plus those notes', () => {
    const view = (variant: 'standalone' | 'embedded') => <div style={{ display: 'grid' }}>
      <section data-testid="annotated-column">
        <p>Original setup scope</p>
        <article data-testid="annotated-relay"><GlassPanel variant={variant} className="h-full" data-testid="annotated-surface">
          Complete original setup controls
        </GlassPanel></article>
        <p>Original source limitation</p>
      </section>
      <GlassPanel>Sibling evidence</GlassPanel>
    </div>;
    const { rerender } = render(view('standalone'));
    expect(screen.getByTestId('annotated-column')).toHaveAttribute('data-card-stretch', 'column');
    expect(screen.getByTestId('annotated-relay')).toHaveAttribute('data-card-stretch', 'relay');
    expect(screen.getByTestId('annotated-surface')).toHaveAttribute('data-card-stretch', 'surface');
    expect(screen.getByText('Original setup scope')).toBeVisible();
    expect(screen.getByText('Original source limitation')).toBeVisible();
    rerender(view('embedded'));
    expect(screen.getByTestId('annotated-column')).not.toHaveAttribute('data-card-stretch');
    expect(screen.getByTestId('annotated-surface')).not.toHaveAttribute('data-card-stretch');
  });

  it('does not turn a packed multi-card side rail into one stretching card column', () => {
    render(<div style={{ display: 'grid' }}>
      <section data-testid="packed-rail">
        <GlassPanel>First independent source</GlassPanel>
        <GlassPanel>Second independent source</GlassPanel>
      </section>
      <GlassPanel>Separate large source</GlassPanel>
    </div>);
    expect(screen.getByTestId('packed-rail')).not.toHaveAttribute('data-card-stretch');
  });

  it('relays the allocated body through a transparent status wrapper to its centered empty state', () => {
    render(<LayoutCard title="Allocated evidence">
      <div data-testid="status-boundary" className="min-h-48">
        <SourceContent state="empty" label="Evidence" emptyMessage="No observed milestones" errorMessage="Source unavailable">
          {null}
        </SourceContent>
      </div>
    </LayoutCard>);
    expect(screen.getByTestId('status-boundary')).toHaveAttribute('data-card-stretch', 'empty');
    expect(screen.getByText('No observed milestones')).toBeVisible();
  });

  it('releases shared empty relays without leaving a stale stretching role after nested owners unmount', () => {
    const view = (empty: boolean) => <LayoutCard title="Allocated evidence">
      <div data-testid="retained-status-boundary">
        <SourceContent state={empty ? 'empty' : 'ready'} label="Evidence" emptyMessage="No observed milestones" errorMessage="Source unavailable">
          Returned milestone observations
        </SourceContent>
      </div>
    </LayoutCard>;
    const { rerender } = render(view(true));
    expect(screen.getByTestId('retained-status-boundary')).toHaveAttribute('data-card-stretch', 'empty');
    rerender(view(false));
    expect(screen.getByTestId('retained-status-boundary')).not.toHaveAttribute('data-card-stretch');
    expect(screen.getByText('Returned milestone observations')).toBeVisible();
  });

  it('lets an empty source declare its native column without replacing controls or disclosures', () => {
    let clicks = 0;
    const view = (empty: boolean) => (
      <div style={{ display: 'grid' }}>
        <section data-testid="source-column">
          <Button onClick={() => { clicks += 1; }}>Retained filter</Button>
          <SourceContent state={empty ? 'empty' : 'ready'} label="Evidence" emptyMessage="Await source" errorMessage="Source unavailable"
            emptyContent={<span>Submit a scenario</span>}>Returned observations</SourceContent>
          <p>Original unsupported-source disclosure</p>
        </section>
      </div>
    );
    const { rerender } = render(view(true));
    expect(screen.getByTestId('source-column')).toHaveAttribute('data-card-slot', 'column');
    fireEvent.click(screen.getByRole('button', { name: 'Retained filter' }));
    expect(clicks).toBe(1);
    expect(screen.getByText('Original unsupported-source disclosure')).toBeVisible();
    rerender(view(false));
    expect(screen.getByTestId('source-column')).not.toHaveAttribute('data-card-slot');
    expect(screen.getByText('Returned observations')).toBeVisible();
  });

  it('retains shared column ownership until its last empty source is removed', () => {
    const view = (ids: number[]) => (
      <div style={{ display: 'grid' }}><section data-testid="shared-column">
        {ids.map(id => <SourceContent key={id} state="empty" label={`Source ${id}`} emptyMessage="Await source"
          errorMessage="Source unavailable" emptyContent={<span>Pending {id}</span>}>{null}</SourceContent>)}
      </section></div>
    );
    const { rerender } = render(view([1, 2]));
    expect(screen.getByTestId('shared-column')).toHaveAttribute('data-card-slot', 'column');
    rerender(view([2]));
    expect(screen.getByTestId('shared-column')).toHaveAttribute('data-card-slot', 'column');
    expect(screen.getByText('Pending 2')).toBeVisible();
    rerender(view([]));
    expect(screen.getByTestId('shared-column')).not.toHaveAttribute('data-card-slot');
  });

  it('adapts a native grid only when every cell declares the shared card anatomy', () => {
    const view = (active: boolean) => (
      <div data-testid="native-grid" style={{ display: 'grid', rowGap: '20px' }}>
        <section><Card layout={active}><CardHeader title="Long header" /><CardContent>Original evidence</CardContent></Card></section>
        <Card layout={active}><CardHeader title="Sibling" /><CardContent>Other original evidence</CardContent></Card>
      </div>
    );
    const { rerender } = render(view(true));
    const owner = screen.getByTestId('native-grid');
    expect(owner).toHaveAttribute('data-card-layout', 'grid');
    expect(owner).toHaveAttribute('data-card-layout-aligned', 'true');
    expect(owner.style.getPropertyValue('--card-layout-gutter')).toBe('20px');
    expect(owner.style.rowGap).toBe('0px');
    rerender(view(false));
    expect(owner).not.toHaveAttribute('data-card-layout');
    expect(owner.style.getPropertyValue('--card-layout-gutter')).toBe('');
    expect(owner.style.rowGap).toBe('20px');
    expect(screen.getByText('Original evidence')).toBeVisible();
  });

  it('stretches transparent native-grid wrappers without imposing anatomy on legacy surfaces', () => {
    const view = (variant: 'standalone' | 'embedded') => (
      <div style={{ display: 'grid' }}>
        <section data-testid="native-cell"><article data-testid="native-relay"><GlassPanel variant={variant}>Complete legacy content</GlassPanel></article></section>
        <Card>Complete sibling</Card>
      </div>
    );
    const { rerender } = render(view('standalone'));
    expect(screen.getByTestId('native-cell')).toHaveAttribute('data-card-stretch', 'relay');
    expect(screen.getByTestId('native-relay')).toHaveAttribute('data-card-stretch', 'relay');
    expect(screen.getByText('Complete legacy content')).not.toHaveAttribute('data-card-layout-aligned');
    rerender(view('embedded'));
    expect(screen.getByTestId('native-cell')).not.toHaveAttribute('data-card-stretch');
    expect(screen.getByTestId('native-relay')).not.toHaveAttribute('data-card-stretch');
  });

  it('does not reclassify independent native-grid controls or meaningful wrapper text', () => {
    render(
      <div data-testid="mixed-grid" style={{ display: 'grid' }}>
        <section data-testid="independent-note">Recorded in UTC<GlassPanel>Original retained content</GlassPanel></section>
        <Button>Independent workspace control</Button>
      </div>,
    );
    expect(screen.getByTestId('mixed-grid')).not.toHaveAttribute('data-card-layout-aligned');
    expect(screen.getByTestId('independent-note')).not.toHaveAttribute('data-card-stretch');
    expect(screen.getByText('Recorded in UTC')).toBeVisible();
  });

  it('provides independent semantic columns without assigning them a parent row', () => {
    render(<CardContent as="section" layoutSlot="column" aria-label="Evidence column">Original observations</CardContent>);
    expect(screen.getByRole('region', { name: 'Evidence column' })).toHaveAttribute('data-card-slot', 'column');
    expect(screen.getByRole('region', { name: 'Evidence column' }).tagName).toBe('SECTION');
  });

  it('registers named slots through semantic single-card wrappers without adding or flattening DOM', () => {
    const { container } = render(
      <Grid cols={{ default: 2 }}>
        <section data-testid="first-item" data-card-layout="item" style={{ display: 'grid' }}>
          <article data-testid="semantic-wrapper" style={{ display: 'grid' }}>
            <Card layout>
              <CardHeader title="Long source heading" />
              <CardContent layoutSlot="summary">Original chart statistics</CardContent>
              <CardContent>Complete original plot</CardContent>
              <CardFooter>Original footer</CardFooter>
            </Card>
          </article>
        </section>
        <LayoutCard title="Sibling source">Independent source content</LayoutCard>
      </Grid>,
    );
    const grid = container.firstElementChild!;
    expect(grid.children).toHaveLength(2);
    expect(grid).toHaveAttribute('data-card-layout', 'grid');
    expect(grid).toHaveAttribute('data-card-layout-aligned', 'true');
    expect(screen.getByTestId('first-item')).toHaveAttribute('data-card-layout', 'item');
    expect(screen.getByTestId('semantic-wrapper')).toHaveAttribute('data-card-layout', 'relay');
    const first = screen.getByRole('heading', { name: 'Long source heading' }).closest('[data-card-layout="surface"]')!;
    expect(first).toHaveAttribute('data-card-layout-aligned', 'true');
    expect(first.querySelector('[data-card-slot="header"]')).toContainElement(screen.getByRole('heading', { name: 'Long source heading' }));
    expect(first.querySelector('[data-card-slot="summary"]')).toHaveTextContent('Original chart statistics');
    expect(first.querySelector('[data-card-slot="body"]')).toHaveTextContent('Complete original plot');
    expect(first.querySelector('[data-card-slot="footer"]')).toHaveTextContent('Original footer');
    expect(grid.querySelectorAll('[data-card-layout="surface"]')).toHaveLength(2);
  });

  it('does not reclassify a wrapper that independently owns controls beside a card', () => {
    let clicks = 0;
    const { container } = render(
      <Grid>
        <section data-testid="business-section">
          <Button onClick={() => { clicks += 1; }}>Independent filter</Button>
          <Card layout><CardHeader title="Nested source" /><CardContent>Original evidence</CardContent></Card>
        </section>
      </Grid>,
    );
    expect(screen.getByTestId('business-section')).not.toHaveAttribute('data-card-layout');
    expect(container.firstElementChild).not.toHaveAttribute('data-card-layout-aligned');
    fireEvent.click(screen.getByRole('button', { name: 'Independent filter' }));
    expect(clicks).toBe(1);
    expect(screen.getByText('Original evidence')).toBeVisible();
  });

  it('releases row ownership when the last participating card unmounts', () => {
    const view = (show: boolean) => <Grid>{show && <LayoutCard title="Temporary source">Retained evidence</LayoutCard>}</Grid>;
    const { container, rerender } = render(view(true));
    const grid = container.firstElementChild!;
    expect(grid).toHaveAttribute('data-card-layout-aligned', 'true');
    rerender(view(false));
    expect(grid).not.toHaveAttribute('data-card-layout-aligned');
  });

  it('retains independently owned text beside a nested card', () => {
    const { container } = render(
      <Grid>
        <section data-testid="source-note">
          Recorded source range: UTC
          <Card layout><CardHeader title="Recorded source" /><CardContent>Original evidence</CardContent></Card>
        </section>
      </Grid>,
    );
    expect(screen.getByTestId('source-note')).not.toHaveAttribute('data-card-layout');
    expect(container.firstElementChild).not.toHaveAttribute('data-card-layout-aligned');
    expect(screen.getByText('Recorded source range: UTC')).toBeVisible();
  });

  it('restores a released relay without disabling its participating sibling', () => {
    const view = (active: boolean) => (
      <Grid>
        <section data-testid="optional-relay">
          <Card layout={active}><CardHeader title="Optional source" /><CardContent>Original evidence</CardContent></Card>
        </section>
        <LayoutCard title="Persistent sibling">Complete sibling evidence</LayoutCard>
      </Grid>
    );
    const { container, rerender } = render(view(true));
    expect(screen.getByTestId('optional-relay')).toHaveAttribute('data-card-layout', 'item');
    rerender(view(false));
    expect(screen.getByTestId('optional-relay')).not.toHaveAttribute('data-card-layout');
    expect(container.firstElementChild).toHaveAttribute('data-card-layout-aligned', 'true');
    expect(screen.getByText('Complete sibling evidence')).toBeVisible();
  });

  it('keeps independently nested grids owned by their nearest container', () => {
    const { container } = render(
      <Grid>
        <Grid>
          <LayoutCard title="Nested owner">Nested evidence</LayoutCard>
        </Grid>
      </Grid>,
    );
    const outer = container.firstElementChild!;
    expect(outer).not.toHaveAttribute('data-card-layout-aligned');
    expect(outer.firstElementChild).toHaveAttribute('data-card-layout-aligned', 'true');
  });
});
