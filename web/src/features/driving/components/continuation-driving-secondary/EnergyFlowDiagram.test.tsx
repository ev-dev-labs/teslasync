import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnergyFlowDiagram } from './EnergyFlowDiagram';
import { layoutSankey, type SankeyFlow } from '../../lib/energyAnatomy';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));

const metadata = {
  aero: { i18nKey: 'energyAnatomy.aero', fallback: 'Aero drag', color: 'blue' },
  rolling: { i18nKey: 'energyAnatomy.rolling', fallback: 'Rolling', color: 'green' },
  climate: { i18nKey: 'energyAnatomy.climate', fallback: 'Climate (HVAC)', color: 'orange' },
  other: { i18nKey: 'energyAnatomy.other', fallback: 'Drivetrain & other', color: 'purple' },
};

describe('EnergyFlowDiagram prepared evidence preservation', () => {
  it('renders the supplied ribbons and every category value, including zero and tiny categories', () => {
    const flows: SankeyFlow[] = [
      { key: 'aero', value: 9998 }, { key: 'rolling', value: 1 },
      { key: 'climate', value: 0 }, { key: 'other', value: 1 },
    ];
    const sankey = layoutSankey(flows, 640, 300);
    const { container } = render(
      <EnergyFlowDiagram
        sankey={sankey} flows={flows} metadata={metadata} totalEnergyWh={10000}
        formatEnergy={(value) => `${value} Wh`} share={(value) => `${value / 100}%`}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(/splitting 10000 Wh/);
    expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 840 320');
    const ribbons = Array.from(container.querySelectorAll('path'));
    expect(ribbons.map((path) => path.getAttribute('d'))).toEqual(sankey.links.map((link) => link.path));
    expect(ribbons.map((path) => Number(path.getAttribute('stroke-width')))).toEqual(sankey.links.map((link) => link.thickness));
    const legend = screen.getByRole('list');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(4);
    expect(within(legend).getByText('Aero drag')).toBeInTheDocument();
    expect(within(legend).getByText('Rolling')).toBeInTheDocument();
    expect(within(legend).getByText('Climate (HVAC)')).toBeInTheDocument();
    expect(within(legend).getByText('Drivetrain & other')).toBeInTheDocument();
    expect(within(legend).getByText('9998 Wh')).toBeInTheDocument();
    expect(within(legend).getByText('0 Wh')).toBeInTheDocument();
    expect(within(legend).getAllByText('1 Wh')).toHaveLength(2);
    expect(flows.map((flow) => flow.value)).toEqual([9998, 1, 0, 1]);
  });
});
