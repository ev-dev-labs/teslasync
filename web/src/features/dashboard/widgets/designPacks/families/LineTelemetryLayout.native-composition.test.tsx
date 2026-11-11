import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_APPEARANCES, PACK_IDS } from '../types';
import LineTelemetryLayout from './LineTelemetryLayout';

const visualFirst = new Set(['motorsport', 'blueprint', 'atlas', 'warm', 'cyber', 'memphis']);
const detailsFirst = new Set([
  'elevated', 'precision', 'iconic', 'expressive', 'pixel', 'terminal', 'quiet', 'swiss', 'kinetic', 'brutal',
]);
const sourcePlot = <svg data-app-part="chart chart-plot" data-chart-family="line" role="img"
  aria-label="Caller speed and signed power" viewBox="0 0 7 11">
  <path d="M0 5 L5 0" strokeDasharray="4 2" />
</svg>;

function sourceBoundary(content: ReactNode) {
  return <section data-testid="source-content">{content}</section>;
}

describe.each(Object.values(PACK_APPEARANCES))('native line composition: %s', appearance => {
  it('exposes genuine definitions/headline slots and retains the caller plot, source boundary and slot order', () => {
    const { container } = render(<LineTelemetryLayout appearance={appearance} compact={false}
      context={<span>Retained route context</span>}
      headline={{ label: 'Speed', value: '0', unit: 'km/h' }}
      details={[{ label: 'Power', value: '−1,25', unit: 'kW' }, { label: 'Duration', value: null, unit: 'h' }]}
      chart={sourcePlot} sourceBoundary={sourceBoundary} />);
    const lead = container.querySelector('dl[data-app-metric="headline"]')!;
    expect(lead.querySelector('dt[data-app-part="metric-label"]')).toHaveTextContent('Speed');
    expect(lead.querySelector('dd[data-app-part="metric-reading"]')).toHaveTextContent('0km/h');
    expect(lead.querySelector('[data-app-part="metric-value"]')).toHaveTextContent('0');
    expect(lead.querySelector('[data-app-part="metric-value"]')).not.toHaveTextContent('km/h');
    expect(lead.querySelector('[data-app-part="metric-unit"]')).toHaveTextContent('km/h');
    const facts = container.querySelector('dl[data-app-list="definitions"]')!;
    const rows = facts.querySelectorAll(':scope > [data-app-part="list-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('dt')).toHaveTextContent('Power');
    expect(rows[0].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('−1,25');
    expect(rows[0].querySelector('[data-app-part="metric-unit"]')).toHaveTextContent('kW');
    expect(rows[1].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('—');
    expect(rows[1].querySelector('[data-app-part="metric-unit"]')).toBeNull();

    const chart = screen.getByRole('img', { name: 'Caller speed and signed power' });
    expect(chart).toHaveAttribute('viewBox', '0 0 7 11');
    expect(chart.querySelector('path')).toHaveAttribute('d', 'M0 5 L5 0');
    expect(chart.querySelector('path')).toHaveAttribute('stroke-dasharray', '4 2');
    expect(chart.parentElement).not.toHaveAttribute('data-app-part');
    expect(chart.parentElement).not.toHaveAttribute('data-chart-family');
    expect(container.querySelectorAll('[data-app-part~="chart-plot"]')).toHaveLength(1);
    const slots = screen.getByTestId('source-content').firstElementChild!;
    expect(Array.from(slots.children).map(child => child.contains(chart) ? 'visual'
      : child.contains(lead) ? 'lead' : 'details')).toEqual(visualFirst.has(appearance)
      ? ['visual', 'lead', 'details']
      : detailsFirst.has(appearance) ? ['lead', 'details', 'visual'] : ['lead', 'visual', 'details']);
    expect(slots).not.toContainElement(screen.getByText('Retained route context'));
    if (appearance === 'pixel') {
      const decoration = container.querySelector('svg[aria-hidden="true"]')!;
      expect(decoration).toHaveAttribute('shape-rendering', 'crispEdges');
      expect(decoration).not.toHaveAttribute('data-app-part');
      expect(decoration).not.toHaveAttribute('data-chart-family');
    }
  });

  it('omits only the compact plot and never bypasses the caller source gate', () => {
    const retry = vi.fn();
    const props = { appearance, compact: true, context: <span>Route remains visible</span>,
      headline: { label: 'Speed', value: null, unit: 'km/h' },
      details: [{ label: 'Power', value: '0', unit: 'kW' }], chart: sourcePlot };
    const view = render(<LineTelemetryLayout {...props} sourceBoundary={sourceBoundary} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(view.container.querySelector('[data-app-metric="headline"] [data-app-part="metric-unit"]')).toBeNull();
    view.rerender(<LineTelemetryLayout {...props} sourceBoundary={() =>
      <Button onClick={retry}>Retry source</Button>} />);
    expect(screen.getByText('Route remains visible')).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-app-list="definitions"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

it('preserves caller interaction state and source geometry across native slot reordering', () => {
  function Chart() {
    const [count, setCount] = useState(0);
    return <><Button onClick={() => setCount(value => value + 1)}>Plot action {count}</Button>{sourcePlot}</>;
  }
  const props = { compact: false, context: null, headline: { label: 'Speed', value: '0' },
    details: [], chart: <Chart />, sourceBoundary };
  const view = render(<LineTelemetryLayout {...props} appearance="studio" />);
  const plot = screen.getByRole('img');
  fireEvent.click(screen.getByRole('button', { name: 'Plot action 0' }));
  view.rerender(<LineTelemetryLayout {...props} appearance="motorsport" />);
  expect(screen.getByRole('img')).toBe(plot);
  fireEvent.click(screen.getByRole('button', { name: 'Plot action 1' }));
  expect(screen.getByRole('button', { name: 'Plot action 2' })).toBeInTheDocument();
});

it.each(PACK_IDS)('uses the existing final-target observer for native slots under %s, not an ancestor proxy', pack => {
  const view = render(<div data-app-design-preview {...getAppDesignAttributes(pack)}>
    <LineTelemetryLayout appearance="studio" compact={false} context={null}
      headline={{ label: 'Speed', value: '0', unit: 'km/h' }}
      details={[{ label: 'Power', value: null, unit: 'kW' }]} chart={sourcePlot}
      sourceBoundary={sourceBoundary} />
    <div data-app-design-preview>
      <LineTelemetryLayout appearance="pixel" compact={false} context={null}
        headline={{ label: 'Unselected speed', value: '0' }} details={[]} chart={null}
        sourceBoundary={sourceBoundary} />
    </div>
  </div>);
  const release = observeAppDesignScopes(view.container);
  try {
    const selected = view.container.firstElementChild!;
    for (const part of selected.querySelectorAll('dl:first-of-type [data-app-part], dl[data-app-list]')) {
      if (part.closest('[data-app-design-preview]') !== selected) continue;
      expect(part.getAttribute('data-app-design-owner')).toContain(`pack-${pack}`);
    }
    expect(screen.getByText('Unselected speed')).not.toHaveAttribute('data-app-design-owner');
  } finally {
    release();
  }
});
