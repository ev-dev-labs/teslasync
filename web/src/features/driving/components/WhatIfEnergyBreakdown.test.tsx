import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WhatIfEnergyBreakdown } from './WhatIfEnergyBreakdown';
import type { EnergyBreakdown } from '../lib/whatIfModel';

const components = [
  { key: 'aero', color: '#3b82f6' },
  { key: 'rolling', color: '#10b981' },
  { key: 'elevation', color: '#a855f7' },
  { key: 'climate', color: '#f59e0b' },
  { key: 'other', color: 'var(--text-muted)' },
] as const;
const labels = { aero: 'Aero', rolling: 'Rolling', elevation: 'Elevation', climate: 'Climate', other: 'Other' };
const formatWh = (value: number) => `${value} Wh`;

describe('WhatIfEnergyBreakdown shared composition (authored, not run)', () => {
  it('preserves the common baseline/scenario denominator and all five category values', () => {
    const breakdown: EnergyBreakdown = { aero: 200, rolling: 100, elevation: 4, climate: 0, other: 196, total: 500 };
    const bytes = JSON.stringify(breakdown);
    const { container } = render(<WhatIfEnergyBreakdown caption="Actual drive" breakdown={breakdown}
      max={1000} labels={labels} components={components} formatWh={formatWh} />);
    const track = screen.getByRole('img', { name: 'Actual drive — 500 Wh' });
    expect(track.children).toHaveLength(3);
    expect(track.children[0]).toHaveStyle({ width: '20%' });
    expect(track.children[1]).toHaveStyle({ width: '10%' });
    expect(track.children[2]).toHaveStyle({ width: '19.6%' });
    const legend = screen.getByRole('list');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5);
    expect(within(legend).getByText('4 Wh')).toBeInTheDocument();
    expect(within(legend).getByText('0 Wh')).toBeInTheDocument();
    expect(container.textContent).toContain('500 Wh');
    expect(JSON.stringify(breakdown)).toBe(bytes);
  });

  it('omits exactly the existing 0.5% visual threshold, retains its legend and updates the supplied split', () => {
    const breakdown: EnergyBreakdown = { aero: 5, rolling: 5.1, elevation: 0, climate: 0, other: 0, total: 10.1 };
    const view = render(<WhatIfEnergyBreakdown caption="What-if" breakdown={breakdown}
      max={1000} labels={labels} components={components} formatWh={formatWh} />);
    expect(screen.getByRole('img', { name: 'What-if — 10.1 Wh' }).children).toHaveLength(1);
    expect(within(screen.getByRole('list')).getByText('5 Wh')).toBeInTheDocument();
    const empty = { aero: 0, rolling: 0, elevation: 0, climate: 0, other: 0, total: 0 };
    view.rerender(<WhatIfEnergyBreakdown caption="What-if" breakdown={empty}
      max={1} labels={labels} components={components} formatWh={formatWh} />);
    expect(screen.getByRole('img', { name: 'What-if — 0 Wh' }).children).toHaveLength(0);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
  });

  it('keeps malformed geometry out of the shared track without replacing missing values with measured zero', () => {
    const breakdown: EnergyBreakdown = { aero: Infinity, rolling: NaN, elevation: 0, climate: 20, other: 0, total: Infinity };
    render(<WhatIfEnergyBreakdown caption="What-if" breakdown={breakdown}
      max={Infinity} labels={labels} components={components}
      formatWh={value => Number.isFinite(value) ? formatWh(value) : '—'} />);
    expect(screen.getByRole('img', { name: 'What-if — —' }).children).toHaveLength(0);
    const legend = screen.getByRole('list');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5);
    expect(within(legend).getAllByText('—')).toHaveLength(2);
    expect(within(legend).getByText('20 Wh')).toBeInTheDocument();
  });
});
