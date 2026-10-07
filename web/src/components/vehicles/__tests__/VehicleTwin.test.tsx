import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { VehicleTwin } from '../VehicleTwin';

const motionPreference = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motionPreference.reduce, durationMs: motionPreference.reduce ? 0 : 250 }),
}));

beforeEach(() => {
  motionPreference.reduce = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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
  it('rescales photo and wheel calibration to the actual container and can expand again', async () => {
    const observers: TestObserver[] = [];
    class TestObserver implements ResizeObserver {
      target?: Element;
      disconnect = vi.fn();
      constructor(private callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(target: Element) { this.target = target; }
      unobserve() {}
      resize(width: number) {
        if (!this.target) throw new Error('Observer has no target');
        this.callback([{
          target: this.target,
          contentRect: new DOMRect(0, 0, width, width * 220 / 560),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }], this);
      }
    }
    vi.stubGlobal('ResizeObserver', TestObserver);
    const { container, unmount } = render(<VehicleTwin {...baseTwinState} size="lg" isDriving />);
    const root = container.querySelector<HTMLDivElement>('div')!;
    const photo = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    fireEvent.load(photo);
    await waitFor(() => expect(container.querySelectorAll('[data-wheel-spinner]')).toHaveLength(2));
    const observer = observers.find(item => item.target === root)!;
    const originalPhotoWidth = Number.parseFloat(photo.style.width);
    act(() => observer.resize(280));
    expect(root.style.width).toBe('560px');
    expect(root.style.height).toBe('110px');
    expect(root).toHaveClass('max-w-full');
    expect(Number.parseFloat(photo.style.width)).toBeCloseTo(originalPhotoWidth / 2);
    const front = container.querySelector<HTMLElement>('[data-wheel-spinner="front"]')!;
    expect(Number.parseFloat(front.style.width)).toBeCloseTo(67.48 / 2, 2);
    expect(Number.parseFloat(front.style.left) + Number.parseFloat(front.style.width) / 2)
      .toBeCloseTo(126.29 / 2, 2);
    act(() => observer.resize(560));
    expect(root.style.height).toBe('220px');
    expect(Number.parseFloat(photo.style.width)).toBeCloseTo(originalPhotoWidth);
    expect(Number.parseFloat(front.style.width)).toBeCloseTo(67.48, 2);
    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it.each(['photo', 'svg'] as const)('keeps %s driving wheels and entry still when motion is reduced', async variant => {
    motionPreference.reduce = true;
    const { container } = render(<VehicleTwin {...baseTwinState} isDriving driveIn />);
    const photo = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    if (variant === 'photo') fireEvent.load(photo);
    else fireEvent.error(photo);
    const selector = variant === 'photo' ? '[data-wheel-rotor]' : '[data-svg-wheel-rotor]';
    await waitFor(() => expect(container.querySelectorAll(selector)).toHaveLength(2));
    const root = container.querySelector<HTMLDivElement>('div')!;
    expect(root.style.transform).not.toContain('115%');
    const transforms = () => Array.from(container.querySelectorAll<HTMLElement | SVGElement>(selector))
      .map(node => node.style.transform);
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const settled = transforms();
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(transforms()).toEqual(settled);
    expect(settled.every(transform => !transform.includes('rotate(') || transform.includes('rotate(0deg)'))).toBe(true);
  });

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

  it('keeps animated sentry and charging geometry as finite static SVG attributes', async () => {
    const { container } = render(
      <VehicleTwin {...baseTwinState} sentryMode isCharging chargePortOpen />,
    );
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await waitFor(() => {
      const geometry = container.querySelectorAll('ellipse, circle');
      expect(geometry.length).toBeGreaterThan(0);
      for (const node of geometry) {
        for (const attribute of ['rx', 'ry', 'r']) {
          const value = node.getAttribute(attribute);
          if (value != null) expect(Number.isFinite(Number(value))).toBe(true);
        }
      }
    });
    expect(container.querySelector('ellipse[rx="16"][ry="7"]')).toBeInTheDocument();
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
      const rotor = container.querySelector<HTMLElement>(`[data-wheel-rotor="${wheel}"]`);
      expect(spinner).not.toBeNull();
      expect(rotor).not.toBeNull();
      return {
        x: Number.parseFloat(spinner!.style.left) + Number.parseFloat(spinner!.style.width) / 2,
        y: Number.parseFloat(spinner!.style.top) + Number.parseFloat(spinner!.style.height) / 2,
        width: Number.parseFloat(spinner!.style.width),
        maskImage: spinner!.style.maskImage,
        webkitMaskImage: spinner!.style.webkitMaskImage,
        transformOrigin: rotor!.style.transformOrigin,
      };
    };

    // Asset-calibrated hub positions in the lg (560 px / 1 viewBox unit)
    // wrapper. The old SVG-derived centers were (132, 169) and (464, 169),
    // visibly pulling both rotating crops above their photo wheels.
    const front = cropCenter('front');
    expect(front.x).toBeCloseTo(126.29, 2);
    expect(front.y).toBeCloseTo(174.45, 2);
    expect(front.width).toBeCloseTo(67.48, 2);
    expect(front.maskImage).toContain('circle closest-side at 50% 50%');
    expect(front.maskImage).toContain('92.59%');
    expect(front.maskImage).toContain('transparent 100%');
    expect(front.webkitMaskImage).toBe(front.maskImage);
    expect(front.transformOrigin).toBe('50% 50%');

    const rear = cropCenter('rear');
    expect(rear.x).toBeCloseTo(464.33, 2);
    expect(rear.y).toBeCloseTo(174.07, 2);
    expect(rear.width).toBeCloseTo(67.48, 2);
    expect(rear.maskImage).toBe(front.maskImage);
    expect(rear.webkitMaskImage).toBe(front.maskImage);
    expect(rear.transformOrigin).toBe('50% 50%');
  });
});
