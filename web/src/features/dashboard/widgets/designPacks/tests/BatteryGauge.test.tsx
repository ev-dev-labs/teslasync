import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { Button } from '@/components/ui';
import type { BatteryGaugePresentationProps } from '../viewModels/BatteryGaugeViewModel';
import StudioBatteryGauge from '../packs/studio/BatteryGauge';
import ElevatedBatteryGauge from '../packs/elevated/BatteryGauge';
import PrecisionBatteryGauge from '../packs/precision/BatteryGauge';
import OwnerBatteryGauge from '../packs/owner/BatteryGauge';
import IconicBatteryGauge from '../packs/iconic/BatteryGauge';
import ExpressiveBatteryGauge from '../packs/expressive/BatteryGauge';
import PixelBatteryGauge from '../packs/pixel/BatteryGauge';
import ExperimentalBatteryGauge from '../packs/experimental/BatteryGauge';
import { PackBoundary } from '../PackBoundary';
import { EXPERIMENTAL_PACK_IDS } from '../types';

const presentations: ReadonlyArray<[string, ComponentType<BatteryGaugePresentationProps>]> = [
  ['v1', StudioBatteryGauge], ['v2', ElevatedBatteryGauge], ['v3', PrecisionBatteryGauge],
  ['v4', OwnerBatteryGauge], ['v5', IconicBatteryGauge], ['v6', ExpressiveBatteryGauge],
  ['v7', PixelBatteryGauge],
  ...EXPERIMENTAL_PACK_IDS.map(id => [id, ExperimentalBatteryGauge] as [string, ComponentType<BatteryGaugePresentationProps>]),
];

const sections: BatteryGaugePresentationProps = {
  level: 0,
  status: <div>Not charging · Limit 80%</div>,
  headline: <strong>0%</strong>,
  pack: <div role="img" aria-label="Battery pack">Pack</div>,
  meter: <div role="meter" aria-label="Battery" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100} title="Charge limit 80%" />,
  details: <div>200 km range</div>,
};

describe.each(presentations)('battery gauge %s', (id, Presentation) => {
  it('keeps verified zero, status, marker, range and pack in the presentation', () => {
    const { container } = render(<PackBoundary requestedPackId={id}><Presentation {...sections} /></PackBoundary>);
    const root = container.querySelector(`[data-battery-gauge-pack="${id}"]`);
    expect(root).not.toBeNull();
    const view = within(root as HTMLElement);
    expect(view.getByText('0%')).toBeInTheDocument();
    expect(view.getByText('Not charging · Limit 80%')).toBeInTheDocument();
    expect(view.getByText('200 km range')).toBeInTheDocument();
    expect(view.getByRole('img', { name: 'Battery pack' })).toBeInTheDocument();
    expect(view.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    expect(view.getByTitle('Charge limit 80%')).toBeInTheDocument();
  });

  it('keeps the refresh action when the battery observation is missing', () => {
    const refresh = vi.fn();
    const { container } = render(<PackBoundary requestedPackId={id}><Presentation
      {...sections}
      level={null}
      headline={<div>No battery data <Button onClick={refresh}>Refresh</Button></div>}
      pack={null}
      meter={null}
      details={null}
    /></PackBoundary>);
    const view = within(container.querySelector(`[data-battery-gauge-pack="${id}"]`) as HTMLElement);
    expect(view.getByText(/No battery data/)).toBeInTheDocument();
    expect(view.queryByRole('meter')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

it('preserves fractional cells rather than rounding the pixel meter to 5%', () => {
  const { container } = render(<PixelBatteryGauge {...sections} level={52.5} />);
  const cells = container.querySelectorAll('[aria-hidden="true"].grid > span');
  expect(cells).toHaveLength(20);
  expect((cells[10].firstElementChild as HTMLElement).style.width).toBe('50%');
  expect((cells[11].firstElementChild as HTMLElement).style.width).toBe('0%');
  expect(screen.getByRole('meter', { name: 'Battery' })).toBeInTheDocument();
});
