import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { VehicleHeroPresentationProps } from '../viewModels/VehicleHeroViewModel';
import StudioVehicleHero from '../packs/studio/VehicleHero';
import ElevatedVehicleHero from '../packs/elevated/VehicleHero';
import PrecisionVehicleHero from '../packs/precision/VehicleHero';
import OwnerVehicleHero from '../packs/owner/VehicleHero';
import IconicVehicleHero from '../packs/iconic/VehicleHero';
import ExpressiveVehicleHero from '../packs/expressive/VehicleHero';
import PixelVehicleHero from '../packs/pixel/VehicleHero';
import ExperimentalVehicleHero from '../packs/experimental/VehicleHero';
import { PackBoundary } from '../PackBoundary';
import { EXPERIMENTAL_PACK_IDS } from '../types';

const presentations: ReadonlyArray<[string, ComponentType<VehicleHeroPresentationProps>]> = [
  ['v1', StudioVehicleHero], ['v2', ElevatedVehicleHero], ['v3', PrecisionVehicleHero],
  ['v4', OwnerVehicleHero], ['v5', IconicVehicleHero], ['v6', ExpressiveVehicleHero],
  ['v7', PixelVehicleHero],
  ...EXPERIMENTAL_PACK_IDS.map(id => [id, ExperimentalVehicleHero] as [string, ComponentType<VehicleHeroPresentationProps>]),
];

const sections: VehicleHeroPresentationProps['sections'] = {
  identity: <div><h2>Aurora · Model Y</h2><span>Unknown</span><span>Parked 3h</span></div>,
  vehicle: <div role="img" aria-label="Vehicle with headlights and doors shown">Vehicle twin</div>,
  headline: <div><span>Battery 0%</span><span>Range —</span></div>,
  charge: <div><div role="meter" aria-label="Battery" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100} /><span>Limit 80%</span><span>0%</span><span>100%</span></div>,
  readings: <div><span>Locked</span><span>Sentry On</span><span>Inside 22°C</span><span>Outside —</span></div>,
};

describe.each(presentations)('vehicle hero %s', (id, Presentation) => {
  it('preserves every section and the exact zero/unknown distinction', () => {
    const { container } = render(<PackBoundary requestedPackId={id}><Presentation sections={sections} /></PackBoundary>);
    const root = container.querySelector(`[data-vehicle-hero-pack="${id}"]`);
    expect(root).not.toBeNull();
    const view = within(root as HTMLElement);
    expect(view.getByRole('heading', { name: 'Aurora · Model Y' })).toBeInTheDocument();
    expect(view.getByRole('img', { name: /Vehicle with headlights and doors/ })).toBeInTheDocument();
    expect(view.getByText('Battery 0%')).toBeInTheDocument();
    expect(view.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    for (const text of ['Unknown', 'Parked 3h', 'Range —', 'Limit 80%', 'Locked', 'Sentry On', 'Inside 22°C', 'Outside —']) {
      expect(view.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getAllByText('0%')).toHaveLength(1);
  });
});
