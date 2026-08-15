import { describe, it, expect } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
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

describe('VehicleTwin', () => {
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

  it('centres spinning photo crops on the compositor wheel hubs', async () => {
    const { container } = render(
      <VehicleTwin {...baseTwinState} size="lg" isDriving />,
    );

    const basePhoto = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]');
    expect(basePhoto).not.toBeNull();
    fireEvent.load(basePhoto!);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-wheel-spinner]')).toHaveLength(2);
    });

    const cropCenter = (wheel: 'front' | 'rear') => {
      const spinner = container.querySelector<HTMLElement>(`[data-wheel-spinner="${wheel}"]`);
      expect(spinner).not.toBeNull();
      return {
        x: Number.parseFloat(spinner!.style.left) + Number.parseFloat(spinner!.style.width) / 2,
        y: Number.parseFloat(spinner!.style.top) + Number.parseFloat(spinner!.style.height) / 2,
        transformOrigin: spinner!.style.transformOrigin,
      };
    };

    // Asset-calibrated hub positions in the lg (560 px / 1 viewBox unit)
    // wrapper. The old SVG-derived centers were (132, 169) and (464, 169),
    // visibly pulling both rotating crops above their photo wheels.
    const front = cropCenter('front');
    expect(front.x).toBeCloseTo(126.29, 2);
    expect(front.y).toBeCloseTo(174.45, 2);
    expect(front.transformOrigin).toBe('50% 50%');

    const rear = cropCenter('rear');
    expect(rear.x).toBeCloseTo(464.33, 2);
    expect(rear.y).toBeCloseTo(174.07, 2);
    expect(rear.transformOrigin).toBe('50% 50%');
  });
});
