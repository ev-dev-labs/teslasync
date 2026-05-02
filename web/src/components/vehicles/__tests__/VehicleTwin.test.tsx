import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VehicleTwin } from '../VehicleTwin';

const baseTwinState = {
  doors: {
    driverFront: false,
    driverRear: false,
    passengerFront: false,
    passengerRear: false,
  },
  windowFD: false,
  windowFP: false,
  windowRD: false,
  windowRP: false,
  frunkOpen: false,
  trunkOpen: false,
  chargePortOpen: false,
  isCharging: false,
  isDriving: false,
  locked: true,
  sentryMode: false,
  headlights: false,
  hazards: false,
  turnSignal: 'off' as const,
  driverSeatOccupied: false,
};

describe('VehicleTwin paint isolation', () => {
  it('two twins on the same page get distinct gradient ids', () => {
    const { container } = render(
      <div>
        <VehicleTwin {...baseTwinState} vehicleId={1} exteriorColor="PearlWhite" />
        <VehicleTwin {...baseTwinState} vehicleId={2} exteriorColor="SolidBlack" />
      </div>,
    );

    const linearGradients = container.querySelectorAll('linearGradient');
    const ids = Array.from(linearGradients).map((g) => g.getAttribute('id') ?? '');
    const uniqueIds = new Set(ids);

    // Sanity: at least a handful of gradients per twin
    expect(linearGradients.length).toBeGreaterThan(8);
    // Every id must be unique (no cross-twin collision).
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('renders without error when vehicleId is missing', () => {
    const { container } = render(<VehicleTwin {...baseTwinState} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
