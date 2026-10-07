import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutPanel, CardGrid, KeyValueList, LayoutCard, LockedNotice, SourceContent } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('isolated reference adapters', () => {
  it('changes container packing without changing reading order or card identity', () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<CardGrid label="reference row" items={[
      { id: 'a', size: 'half', content: <LayoutCard title="A">first fact</LayoutCard> },
      { id: 'b', size: 'half', content: <LayoutCard title="B">second fact</LayoutCard> },
      { id: 'c', size: 'half', content: <LayoutCard title="C">third fact</LayoutCard> },
    ]} />);
    const cards = Array.from(container.querySelectorAll('[data-card]'));
    const boundary = container.querySelector('[data-card-grid]')!;
    const updateWidth = (width: number) => act(() => resize?.([
      { contentRect: { width }, target: boundary } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    updateWidth(1280);
    expect(cards.map(card => card.getAttribute('data-card-resolved-span'))).toEqual(['6', '6', '12']);
    updateWidth(520); // viewport may still be wide; this host is not.
    expect(cards.map(card => card.getAttribute('data-card-resolved-span'))).toEqual(['1', '1', '1']);
    expect(Array.from(container.querySelectorAll('[data-card]'))).toEqual(cards);
    expect(screen.getAllByRole('heading').map(node => node.textContent)).toEqual(['A', 'B', 'C']);
  });

  it('keeps successful source content and both shells present during a neighbor failure', () => {
    const view = (state: 'error' | 'loading' | 'empty' | 'retained') => (
      <MemoryRouter>
        <LayoutCard title="First source">
          <SourceContent state={state} label="First source" emptyMessage="No first records" errorMessage="First source failed">
            <span>Retained first evidence</span>
          </SourceContent>
        </LayoutCard>
        <LayoutCard title="Successful source">
          <SourceContent state="ready" label="Successful source" emptyMessage="No second records" errorMessage="Second failure">
            <span>Independent second evidence</span>
          </SourceContent>
        </LayoutCard>
      </MemoryRouter>
    );
    const { container, rerender } = render(view('error'));
    expect(screen.getByText('First source failed')).toBeVisible();
    for (const state of ['loading', 'empty', 'retained'] as const) {
      rerender(view(state));
      expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
      expect(screen.getByText('Independent second evidence')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'First source' })).toBeVisible();
      if (state === 'loading') expect(screen.getByRole('status', { name: 'Loading First source' })).toBeInTheDocument();
      if (state === 'empty') expect(screen.getByText('No first records')).toBeVisible();
    }
    expect(screen.getByText('Retained first evidence')).toBeVisible();
  });

  it('exposes methodology as a named, closed native keyboard disclosure', () => {
    const { container } = render(<AboutPanel title="About the reference"><p>Full methodology retained</p></AboutPanel>);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    const summary = container.querySelector('summary')!;
    expect(summary.textContent).toBe('About the reference');
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    // Native details is the keyboard/touch disclosure substrate. jsdom
    // geometry and native toggle timing are not browser acceptance evidence.
    expect(container.querySelector('[aria-labelledby]')).toHaveAttribute('aria-labelledby', summary.id);
    expect(screen.getByText('Full methodology retained')).toBeInTheDocument();
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it('retains all unavailable items and names evidence-derived progress', () => {
    render(<LockedNotice title="Shared reason" reason="Synthetic only" items={[
      { id: 'a', label: 'Curve' }, { id: 'b', label: 'Trend' }, { id: 'c', label: 'Residuals' },
    ]} progress={{ current: 2, required: 9, label: 'Fixture steps, not eligibility' }} />);
    expect(screen.getAllByRole('listitem').map(node => node.textContent)).toEqual(['Curve', 'Trend', 'Residuals']);
    expect(screen.getByRole('progressbar', { name: 'Fixture steps, not eligibility' })).toHaveAttribute('value', String(2 / 9));
  });

  it('preserves a complete long fact and exposes a missing reason on focus', () => {
    render(<KeyValueList items={[
      { id: 'tz', label: 'Timezone', value: 'America/Los_Angeles' },
      { id: 'missing', label: 'Source', value: null, missingReason: 'Deliberately absent fixture' },
    ]} />);
    expect(screen.getByText('America/Los_Angeles')).toHaveTextContent('America/Los_Angeles');
    const missing = screen.getByText('—');
    expect(missing).toHaveAttribute('tabindex', '0');
    expect(missing).toHaveAttribute('aria-describedby');
    fireEvent.focus(missing);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Deliberately absent fixture');
  });
});
