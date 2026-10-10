import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { VehicleTwin } from '../VehicleTwin';
import type { VehicleTwinProps } from '../VehicleTwin';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import english from '@/i18n/en.json';
import userEvent from '@testing-library/user-event';

vi.unmock('react-i18next');

const motionPreference = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motionPreference.reduce, durationMs: motionPreference.reduce ? 0 : 250 }),
}));

beforeEach(() => {
  motionPreference.reduce = false;
});

describe('VehicleTwin localized native titles and hotspots', () => {
  it.each([false, true, null] as const)('retains opening state %s and translated source associations', async opening => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'fixture',
      fallbackLng: 'en',
      resources: {
        en: { translation: english },
        fixture: { translation: {
          digitalTwin: {
            frunk: 'Avant', trunk: 'Coffre', windowFD: 'Avant conducteur',
            windowRD: 'Arrière conducteur', windowFP: 'Avant passager', windowRP: 'Arrière passager',
            doorDriverFront: 'Conducteur avant', doorDriverRear: 'Conducteur arrière',
          },
          teslaOnly: { door: 'Porte', window: 'Fenêtre' },
          common: { open: 'Ouvert', closed: 'Fermé', unknown: 'Inconnu' },
          dayLog: { windowStates: { partial: 'Partiellement ouvert' } },
        } },
      },
    });
    const state = opening === null ? 'Inconnu' : opening ? 'Ouvert' : 'Fermé';
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <VehicleTwin {...baseTwinState} interactive frunkOpen={opening} trunkOpen={opening}
          doors={{ ...baseTwinState.doors, driverFront: opening, driverRear: opening }}
          windowFD="partial" windowRD={null} windowFP="closed" windowRP="open" />
      </I18nextProvider>,
    );
    const titles = Array.from(container.querySelectorAll('title'), title => title.textContent?.replace(/\s+/g, ' ').trim());
    expect(titles).toContain(`Conducteur avant Porte: ${state}`);
    expect(titles).toContain(`Conducteur arrière Porte: ${state}`);
    expect(titles).toContain('Avant passager Fenêtre: Fermé. Arrière passager Fenêtre: Ouvert.');
    const hotspots = [
      ['foreignObject[x="44"][y="140"][width="150"][height="48"]', `Avant: ${state}`],
      ['foreignObject[x="462"][y="94"][width="88"][height="46"]', `Coffre: ${state}`],
      ['foreignObject[x="198"][y="92"][width="98"][height="50"]', 'Avant conducteur Fenêtre: Partiellement ouvert'],
      ['foreignObject[x="316"][y="90"][width="96"][height="46"]', 'Arrière conducteur Fenêtre: Inconnu'],
      ['foreignObject[x="206"][y="148"][width="100"][height="92"]', `Conducteur avant Porte: ${state}`],
      ['foreignObject[x="310"][y="142"][width="124"][height="98"]', `Conducteur arrière Porte: ${state}`],
    ] as const;
    for (const [selector, label] of hotspots) {
      const hotspot = container.querySelector(selector)!;
      const target = hotspot.querySelector('[aria-describedby]')!;
      const tooltip = hotspot.querySelector('[role="tooltip"]')!;
      expect(target).toBeInTheDocument();
      expect(tooltip).toHaveTextContent(label);
      expect(target).toHaveAttribute('aria-describedby', tooltip.id);
    }
  });
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
    trunkFront: false,
    trunkRear: false,
  },
  windowFD: null,
  windowFP: null,
  windowRD: null,
  windowRP: null,
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
  vehicleColor: '',
  lastUpdated: null,
} satisfies VehicleTwinProps;

describe('VehicleTwin source-derived inspection', () => {
  async function localizedTwin(props: Partial<VehicleTwinProps>) {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } } });
    return render(<I18nextProvider i18n={i18n}><VehicleTwin {...baseTwinState} {...props} /></I18nextProvider>);
  }

  it.each(['photo', 'svg'] as const)('keeps all null states unknown and image semantics in %s mode', async variant => {
    const { container } = await localizedTwin({
      doors: { driverFront: null, driverRear: null, passengerFront: null, passengerRear: null, trunkFront: null, trunkRear: null },
      frunkOpen: null, trunkOpen: null, chargePortOpen: null,
      locked: null, sentryMode: null, headlights: null, hazards: null, turnSignal: null, driverSeatOccupied: null,
    });
    const image = container.querySelector('[role="img"]')!;
    expect(image).toHaveAttribute('aria-label', 'Digital twin');
    const summary = document.getElementById(image.getAttribute('aria-describedby')!)!;
    expect(summary.textContent?.match(/Unknown/g)).toHaveLength(17);
    expect(summary).toHaveTextContent('Driver front Door: Unknown');
    expect(summary).toHaveTextContent('Driver seat: Unknown');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    const photo = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    if (variant === 'photo') fireEvent.load(photo);
    else fireEvent.error(photo);
    expect(summary.textContent?.match(/Unknown/g)).toHaveLength(17);
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('exposes the same explicit values outside the clipped art with keyboard, click and touch focus', async () => {
    const user = userEvent.setup();
    const { container } = await localizedTwin({
      interactive: true, windowFD: 'partial', windowFP: 'open', windowRD: 'closed', windowRP: null,
      frunkOpen: true, locked: false, isCharging: true, turnSignal: 'left',
    });
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('role', 'group');
    const summary = document.getElementById(root.getAttribute('aria-describedby')!)!;
    for (const value of ['Driver front Door: Closed', 'Frunk: Open', 'Front driver Window: Partially open',
      'Front passenger Window: Open', 'Rear driver Window: Closed', 'Rear passenger Window: Unknown',
      'Locked: Unlocked', 'Charging: Charging', 'Turn signal: Left', 'Driving: Off', 'Driver seat: Empty']) {
      expect(summary).toHaveTextContent(value);
    }
    const rail = container.querySelector('[role="group"][aria-label="Physical-state summary"]')!;
    expect(rail).toHaveClass('flex-wrap');
    expect(rail.closest('.overflow-hidden')).toBeNull();
    const buttons = Array.from(rail.querySelectorAll('button'));
    expect(buttons).toHaveLength(19);
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-touch11', 'min-w-touch11');
      expect(button).toHaveAttribute('type', 'button');
      const tooltip = document.getElementById(button.getAttribute('aria-describedby')!)!;
      expect(tooltip).toHaveTextContent(button.textContent!);
    }
    buttons[0].focus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard(' ');
    expect(buttons[1]).toHaveFocus();
    await user.click(buttons[2]);
    expect(buttons[2]).toHaveFocus();
    fireEvent.pointerDown(buttons[3], { pointerType: 'touch' });
    fireEvent.pointerUp(buttons[3], { pointerType: 'touch' });
    fireEvent.click(buttons[3]);
    expect(buttons[3]).toHaveFocus();
    const hotspot = container.querySelector('foreignObject[x="44"][y="140"] button')!;
    expect(hotspot).toHaveAttribute('aria-label', 'Frunk: Open');
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });
});

describe('VehicleTwin', () => {
  it.each([false, true])('keeps actual charge and sentry feedback finite and static with reduced motion=%s', async reduce => {
    motionPreference.reduce = reduce;
    const { container, rerender } = render(
      <VehicleTwin {...baseTwinState} isCharging chargePortOpen sentryMode />,
    );
    const selectors = [
      ['path[d="M 152 246 C 240 253 360 253 446 244"]', '0.45'],
      ['circle[cx="532"][cy="136"][r="5"]', '0.65'],
      ['circle[cx="532"][cy="136"][r="10"]', '0.65'],
      ['ellipse[cx="320"][cy="91"][rx="16"][ry="7"]', '0.65'],
    ] as const;
    const assertStatic = () => {
      for (const [selector, opacity] of selectors) {
        const indicator = container.querySelector(selector);
        expect(indicator).toHaveAttribute('opacity', opacity);
        expect(indicator).not.toHaveAttribute('filter');
        expect(indicator).not.toHaveAttribute('style');
        expect(indicator?.parentElement).not.toHaveAttribute('style');
        for (const attribute of ['cx', 'cy', 'r', 'rx', 'ry']) {
          const value = indicator?.getAttribute(attribute);
          if (value != null) expect(Number.isFinite(Number(value))).toBe(true);
        }
      }
      expect(container.querySelector('ellipse[cx="298"][cy="255"]')).toBeNull();
      expect(container.querySelector('.lucide-shield')?.parentElement).not.toHaveAttribute('style');
      expect(container.querySelector('rect[x="527"][y="132"]')).toHaveAttribute('width', '10');
      expect(container.querySelector('path[d="M 532 129.5 L 526.5 138 L 532 138 L 529 144.5 L 538.5 134 L 533 134 Z"]'))
        .toHaveAttribute('fill', 'var(--semantic-info)');
    };
    assertStatic();
    fireEvent.load(container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!);
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assertStatic();
    motionPreference.reduce = !reduce;
    rerender(<VehicleTwin {...baseTwinState} isCharging chargePortOpen sentryMode locked={false} />);
    assertStatic();
    expect(container.querySelector('.lucide-lock-open')).toBeInTheDocument();
    rerender(<VehicleTwin {...baseTwinState} chargePortOpen />);
    expect(container.querySelector('circle[cx="532"][cy="136"][r="9"]')).toBeInTheDocument();
    for (const [selector] of selectors) expect(container.querySelector(selector)).toBeNull();
    for (const state of [false, null] as const) {
      rerender(<VehicleTwin {...baseTwinState} chargePortOpen={state} sentryMode={state} locked={null} />);
      for (const [selector] of selectors) expect(container.querySelector(selector)).toBeNull();
      expect(container.querySelector('.lucide-shield')).toBeNull();
      expect(container.querySelector('.lucide-lock')).toBeNull();
      expect(container.querySelector('.lucide-lock-open')).toBeNull();
    }
  });

  it.each([false, true])('keeps light emission bounded and static with reduced motion=%s', async reduce => {
    motionPreference.reduce = reduce;
    const { container, rerender } = render(<VehicleTwin {...baseTwinState} headlights driveIn />);
    const emissions = [
      ['ellipse[cx="66"][cy="181"]', '0.28'],
      ['path[d="M 44 194 L 0 180 L 0 216 Z"]', '0.12'],
      ['ellipse[cx="543"][cy="148"][rx="18"]', '0.18'],
      ['path[d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5"]', '0.35'],
    ] as const;
    const assertStatic = () => {
      for (const [index, [selector, opacity]] of emissions.entries()) {
        const emission = container.querySelector(selector);
        if (index >= 2 && motionPreference.reduce) {
          expect(emission).toBeNull();
          continue;
        }
        expect(emission).toHaveAttribute('opacity', opacity);
        expect(emission).not.toHaveAttribute('filter');
        expect(emission).not.toHaveAttribute('style');
      }
    };
    assertStatic();
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assertStatic();
    motionPreference.reduce = !reduce;
    rerender(<VehicleTwin {...baseTwinState} headlights driveIn />);
    assertStatic();
    rerender(<VehicleTwin {...baseTwinState} headlights />);
    for (const [selector, opacity] of emissions.slice(0, 2)) {
      expect(container.querySelector(selector)).toHaveAttribute('opacity', opacity);
    }
    for (const [selector] of emissions.slice(2)) expect(container.querySelector(selector)).toBeNull();
    for (const headlights of [false, null] as const) {
      rerender(<VehicleTwin {...baseTwinState} headlights={headlights} />);
      for (const [selector] of emissions) expect(container.querySelector(selector)).toBeNull();
    }
    rerender(<VehicleTwin {...baseTwinState} headlights={null} driveIn />);
    if (motionPreference.reduce) {
      for (const [selector] of emissions) expect(container.querySelector(selector)).toBeNull();
    } else assertStatic();
  });

  it('retains real turn feedback and reduced-mode static SVG opacity', async () => {
    const { container, rerender } = render(<VehicleTwin {...baseTwinState} hazards />);
    const lamps = () => [
      container.querySelector('ellipse[cx="90"][cy="180"]'),
      container.querySelector('path[fill="none"][stroke-width="2"][d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5 C 544 156.2 540.5 154.5 539 151.5 C 537.8 148 538 144 538.5 141 Z"]'),
    ];
    await waitFor(() => {
      for (const lamp of lamps()) {
        const opacity = Number(lamp?.getAttribute('opacity'));
        expect(opacity).toBeGreaterThan(0.15);
        expect(opacity).toBeLessThan(1);
      }
    });
    motionPreference.reduce = true;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    rerender(<VehicleTwin {...baseTwinState} turnSignal="both" />);
    await waitFor(() => {
      for (const lamp of lamps()) expect(lamp).toHaveAttribute('opacity', '1');
    });
    rerender(<VehicleTwin {...baseTwinState} turnSignal={null} hazards={null} />);
    for (const lamp of lamps()) expect(lamp).toBeNull();
  });

  it.each([false, true])('keeps passenger warning paths static with reduced motion=%s', async reduce => {
    motionPreference.reduce = reduce;
    const doors = { ...baseTwinState.doors, passengerFront: true, passengerRear: true };
    const { container, rerender } = render(
      <VehicleTwin {...baseTwinState} doors={doors} windowFP="open" />,
    );
    const paths = [
      'M 236 116 C 290 97 340 90 390 92.5 C 420 95.5 450 103 476 112',
      'M 306 140.5 C 276 142.5 246 144.5 218 146.2',
      'M 434 132 C 448 130 466 122 480 113.5',
    ];
    const assertStatic = () => {
      for (const d of paths) {
        const path = container.querySelector(`path[d="${d}"]`);
        expect(path).toBeInTheDocument();
        expect(path).toHaveAttribute('stroke', 'var(--semantic-warning)');
        expect(path).toHaveAttribute('fill', 'none');
        expect(path).toHaveAttribute('stroke-width', '2');
        expect(path).toHaveAttribute('stroke-linecap', 'round');
        expect(path).not.toHaveAttribute('style');
      }
    };
    assertStatic();
    fireEvent.load(container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!);
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assertStatic();
    motionPreference.reduce = !reduce;
    rerender(<VehicleTwin {...baseTwinState} doors={doors} windowRP="partial" />);
    assertStatic();
    rerender(<VehicleTwin {...baseTwinState} windowFP={null} windowRP="closed"
      doors={{ ...baseTwinState.doors, passengerFront: null, passengerRear: false }} />);
    for (const d of paths) expect(container.querySelector(`path[d="${d}"]`)).toBeNull();
  });

  it.each([false, true])('honors disclosure entrance and exit with reduced motion=%s', async reduce => {
    motionPreference.reduce = reduce;
    const doors = { ...baseTwinState.doors, driverFront: true, driverRear: true };
    const { container, rerender } = render(
      <VehicleTwin {...baseTwinState} doors={doors} frunkOpen trunkOpen />,
    );
    const paths = [
      'M 48.5 183.5 C 80 158 140 146 197 144 L 190 156 C 140 154 88 168 56 194 Z',
      'M 481 107.5 C 507 94 535 98 549 121 L 545 132 C 535 122 510 111.5 483 113 Z',
      'M 306 141 L 220 130 L 206 232 L 299 246 Z',
      'M 434 131 L 498 118 L 510 215 L 438 236 Z',
    ];
    const overlays = () => paths.map(d => container.querySelector<SVGElement>(`path[d="${d}"]`));
    for (const overlay of overlays()) {
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute('opacity', reduce ? '1' : '0');
      if (reduce) expect(overlay?.style.transform).toBe('none');
      else expect(overlay?.style.transform).toMatch(/translateY\(8px\)|scaleX\(0\.9\)/);
    }
    await waitFor(() => {
      for (const overlay of overlays()) {
        expect(overlay).toHaveAttribute('opacity', '1');
        expect(overlay?.style.transform).toBe('none');
      }
    });
    rerender(<VehicleTwin {...baseTwinState} />);
    if (!reduce) for (const overlay of overlays()) expect(overlay).toBeInTheDocument();
    await waitFor(() => {
      for (const overlay of overlays()) expect(overlay).toBeNull();
    });
    motionPreference.reduce = true;
    rerender(<VehicleTwin {...baseTwinState} doors={doors} frunkOpen trunkOpen />);
    for (const overlay of overlays()) {
      expect(overlay).toHaveAttribute('opacity', '1');
      expect(overlay?.style.transform).toBe('none');
    }
    rerender(<VehicleTwin {...baseTwinState} frunkOpen={null} trunkOpen={null}
      doors={{ ...baseTwinState.doors, driverFront: null, driverRear: null }} />);
    await waitFor(() => {
      for (const overlay of overlays()) expect(overlay).toBeNull();
    });
  });

  it.each([false, true])('keeps body and glass reflections static with reduced motion=%s', async reduce => {
    motionPreference.reduce = reduce;
    const { container, rerender } = render(<VehicleTwin {...baseTwinState} />);
    fireEvent.error(container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!);
    const reflections = [
      ['M 96 170 C 200 152 330 140 468 120', '0.4'],
      ['M 212 154 C 280 150 380 145 458 136 L 450 144 C 372 151 282 156 218 160 Z', '0.28'],
      ['M 118 166 C 230 148 390 134 508 120', '0.1'],
      ['M 236 114 C 300 95 378 91 456 105', '0.1'],
    ] as const;
    const assertReflections = () => {
      for (const [d, opacity] of reflections) {
        const reflection = container.querySelector(`path[d="${d}"]`);
        expect(reflection).toHaveAttribute('opacity', opacity);
        expect(reflection).not.toHaveAttribute('style');
        if (d === reflections[2][0] || d === reflections[3][0]) {
          expect(reflection).toHaveAttribute('stroke-dashoffset', '0');
          expect(reflection).toHaveAttribute('stroke-dasharray', d === reflections[2][0] ? '58 420' : '42 260');
        }
      }
      expect(container.querySelector(`path[d="${reflections[0][0]}"]`)?.getAttribute('stroke'))
        .toMatch(/^url\(#.+-shoulder-highlight\)$/);
      expect(container.querySelector(`path[d="${reflections[1][0]}"]`)?.getAttribute('fill'))
        .toMatch(/^url\(#.+-soft-reflection\)$/);
      expect(container.querySelector(`path[d="${reflections[3][0]}"]`))
        .toHaveAttribute('stroke', 'rgba(255,255,255,0.16)');
    };
    await waitFor(assertReflections);
    rerender(<VehicleTwin {...baseTwinState} isDriving isCharging windowFD="open" windowFP="partial" />);
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assertReflections();
    motionPreference.reduce = !reduce;
    rerender(<VehicleTwin {...baseTwinState} />);
    assertReflections();
  });

  it.each(['photo', 'svg'] as const)('uses the passenger warning role only for open or partial windows in %s mode', async variant => {
    motionPreference.reduce = true;
    const { container, rerender } = render(<VehicleTwin {...baseTwinState} />);
    const photo = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    if (variant === 'photo') fireEvent.load(photo);
    else fireEvent.error(photo);
    await waitFor(() => expect(container.querySelectorAll('[data-wheel-spinner]'))
      .toHaveLength(variant === 'photo' ? 2 : 0));
    const warning = () => container.querySelector('path[d="M 236 116 C 290 97 340 90 390 92.5 C 420 95.5 450 103 476 112"]');
    for (const passengerWindow of ['windowFP', 'windowRP'] as const) {
      for (const state of ['open', 'partial', 'closed', null] as const) {
        rerender(<VehicleTwin {...baseTwinState} {...{ [passengerWindow]: state }} />);
        if (state === 'open' || state === 'partial') {
          expect(warning()).toHaveAttribute('stroke', 'var(--semantic-warning)');
          expect(warning()).toHaveAttribute('fill', 'none');
          expect(warning()).toHaveAttribute('stroke-width', '2');
          expect(warning()).toHaveAttribute('stroke-linecap', 'round');
        } else {
          expect(warning()).toBeNull();
        }
      }
    }
    rerender(<VehicleTwin {...baseTwinState} windowFD="open" windowRD="partial" />);
    expect(warning()).toBeNull();
  });

  it.each(['photo', 'svg'] as const)('preserves exact amber physical lamps and turn/hazard predicates in %s mode', async variant => {
    motionPreference.reduce = true;
    const { container, rerender } = render(<VehicleTwin {...baseTwinState} windowFP="open" />);
    const photo = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    if (variant === 'photo') fireEvent.load(photo);
    else fireEvent.error(photo);
    await waitFor(() => expect(container.querySelectorAll('[data-wheel-spinner]'))
      .toHaveLength(variant === 'photo' ? 2 : 0));
    const amber = 'rgba(251,191,36,0.78)';
    const frontLamp = () => container.querySelector('ellipse[cx="90"][cy="180"]');
    const rearLamps = () => container.querySelectorAll('path[d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5 C 544 156.2 540.5 154.5 539 151.5 C 537.8 148 538 144 538.5 141 Z"]');
    for (const turnSignal of ['off', 'left', 'right', 'both', null] as const) {
      for (const hazards of [false, true, null] as const) {
        rerender(<VehicleTwin {...baseTwinState} windowFP="open" turnSignal={turnSignal} hazards={hazards} />);
        const frontActive = hazards === true || turnSignal === 'left' || turnSignal === 'both';
        const rearActive = hazards === true || turnSignal === 'right' || turnSignal === 'both';
        if (frontActive) {
          expect(frontLamp()).toHaveAttribute('fill', amber);
          expect(frontLamp()).toHaveAttribute('rx', '6');
          expect(frontLamp()).toHaveAttribute('ry', '3.5');
        } else {
          expect(frontLamp()).toBeNull();
        }
        expect(rearLamps()).toHaveLength((variant === 'svg' ? 1 : 0) + (rearActive ? 1 : 0));
        for (const lamp of rearLamps()) {
          const activeOverlay = lamp.getAttribute('fill') === 'none';
          expect(lamp).toHaveAttribute('stroke', rearActive ? amber : 'rgba(248,113,113,0.5)');
          expect(lamp).toHaveAttribute('stroke-width', activeOverlay ? '2' : '0.9');
          if (activeOverlay) expect(lamp).toHaveAttribute('stroke-linecap', 'round');
          else expect(lamp.getAttribute('fill')).toMatch(/^url\(#.+-taillight-grad\)$/);
        }
        expect(container.querySelector('path[stroke="var(--semantic-warning)"][stroke-width="2"]'))
          .toHaveAttribute('d', 'M 236 116 C 290 97 340 90 390 92.5 C 420 95.5 450 103 476 112');
      }
    }
  });

  it('uses theme-aware activity inks without changing unknown and false predicates', () => {
    const { container, rerender } = render(
      <VehicleTwin {...baseTwinState} locked={false} sentryMode isCharging chargePortOpen driverSeatOccupied />,
    );
    const seat = () => container.querySelector('ellipse[cx="268"][cy="122"]');
    expect(seat()).toHaveAttribute('fill', 'var(--semantic-info-bg)');
    expect(seat()).toHaveAttribute('stroke', 'var(--semantic-info)');
    expect(container.querySelector('.lucide-shield')).toHaveAttribute('stroke', 'var(--semantic-info)');
    expect(container.querySelector('.lucide-lock-open')).toHaveAttribute('stroke', 'var(--semantic-info)');
    expect(container.querySelector('rect[x="527"][y="132"]')).toHaveAttribute('stroke', 'var(--semantic-info)');
    rerender(<VehicleTwin {...baseTwinState} driverSeatOccupied={null} locked={null} sentryMode={null} />);
    expect(seat()).toBeNull();
    expect(container.querySelector('.lucide-lock')).toBeNull();
    expect(container.querySelector('.lucide-lock-open')).toBeNull();
    expect(container.querySelector('.lucide-shield')).toBeNull();
    rerender(<VehicleTwin {...baseTwinState} />);
    expect(seat()).toBeNull();
    expect(container.querySelector('.lucide-lock')).toHaveAttribute('stroke', 'var(--text-secondary)');
  });

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
    expect(photo.style.transition).toBe('none');
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
    expect(basePhoto!.style.maxWidth).toBe('none');
    expect(basePhoto!.style.transition).toBe('opacity 200ms ease');
    fireEvent.load(basePhoto!);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-wheel-spinner]')).toHaveLength(2);
    });

    const cropCenter = (wheel: 'front' | 'rear') => {
      const spinner = container.querySelector<HTMLElement>(`[data-wheel-spinner="${wheel}"]`);
      const rotor = container.querySelector<HTMLElement>(`[data-wheel-rotor="${wheel}"]`);
      expect(spinner).not.toBeNull();
      expect(rotor).not.toBeNull();
      expect(spinner).toHaveClass('pointer-events-none', 'absolute', 'overflow-hidden', 'rounded-full');
      expect(rotor).toHaveClass('absolute', 'inset-0', 'origin-center', 'overflow-hidden');
      const crop = rotor!.querySelector<HTMLImageElement>('img')!;
      expect(crop).toHaveClass('absolute');
      expect(crop.style.maxWidth).toBe('none');
      expect(crop.style.width).toBe(basePhoto!.style.width);
      expect(Number.parseFloat(crop.style.left) + Number.parseFloat(spinner!.style.left))
        .toBeCloseTo(Number.parseFloat(basePhoto!.style.left));
      expect(Number.parseFloat(crop.style.top) + Number.parseFloat(spinner!.style.top))
        .toBeCloseTo(Number.parseFloat(basePhoto!.style.top));
      return {
        x: Number.parseFloat(spinner!.style.left) + Number.parseFloat(spinner!.style.width) / 2,
        y: Number.parseFloat(spinner!.style.top) + Number.parseFloat(spinner!.style.height) / 2,
        width: Number.parseFloat(spinner!.style.width),
        maskImage: spinner!.style.maskImage,
        webkitMaskImage: spinner!.style.webkitMaskImage,
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

    const rear = cropCenter('rear');
    expect(rear.x).toBeCloseTo(464.33, 2);
    expect(rear.y).toBeCloseTo(174.07, 2);
    expect(rear.width).toBeCloseTo(67.48, 2);
    expect(rear.maskImage).toBe(front.maskImage);
    expect(rear.webkitMaskImage).toBe(front.maskImage);
  });
});
