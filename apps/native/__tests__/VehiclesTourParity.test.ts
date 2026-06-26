import {VEHICLES_TOUR} from '../src/web-parity/features/onboarding/tours/vehiclesTour';

declare const __dirname: string;
declare function require(moduleName: string): unknown;

const {readFileSync} = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};
const {resolve} = require('path') as {
  resolve: (...paths: string[]) => string;
};

// The verbatim web source — every native string must appear here so the port
// cannot silently drift from web/src/features/onboarding/tours/vehiclesTour.ts.
const webSource = readFileSync(
  resolve(
    __dirname,
    '..',
    '..',
    '..',
    'web',
    'src',
    'features',
    'onboarding',
    'tours',
    'vehiclesTour.ts',
  ),
  'utf8',
);

describe('vehiclesTour native parity', () => {
  it('mirrors the launcher metadata verbatim', () => {
    expect(VEHICLES_TOUR.id).toBe('vehicles');
    expect(VEHICLES_TOUR.titleKey).toBe('tour.tours.vehicles.title');
    expect(VEHICLES_TOUR.titleFallback).toBe('Vehicles & sharing');
    expect(VEHICLES_TOUR.descriptionKey).toBe('tour.tours.vehicles.description');
    expect(VEHICLES_TOUR.descriptionFallback).toBe(
      'Browse fleet, open a vehicle, share access.',
    );
    expect(VEHICLES_TOUR.version).toBe(1);

    expect(webSource).toContain("id: 'vehicles'");
    expect(webSource).toContain("titleKey: 'tour.tours.vehicles.title'");
    expect(webSource).toContain("titleFallback: 'Vehicles & sharing'");
    expect(webSource).toContain(
      "descriptionKey: 'tour.tours.vehicles.description'",
    );
    expect(webSource).toContain(
      "descriptionFallback: 'Browse fleet, open a vehicle, share access.'",
    );
    expect(webSource).toContain('version: 1');
  });

  it('keeps the RegExp routeMatch behaviour (/^\\/vehicles/)', () => {
    expect(VEHICLES_TOUR.routeMatch).toBeInstanceOf(RegExp);
    const re = VEHICLES_TOUR.routeMatch as RegExp;
    expect(re.test('/vehicles')).toBe(true);
    expect(re.test('/vehicles/42')).toBe(true);
    expect(re.test('/charging')).toBe(false);
    expect(webSource).toContain('routeMatch: /^\\/vehicles/');
  });

  it('reproduces all four steps verbatim and in order', () => {
    expect(VEHICLES_TOUR.steps).toHaveLength(4);

    const expectedSteps = [
      {
        target: '[data-tour="vehicles-list"]',
        title: 'Your vehicles',
        description:
          'Every Tesla linked to your account. The card shows live state — online, asleep, charging — and the colour ring matches the section icon set.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="vehicles-card"]',
        title: 'Open a vehicle for the deep dive',
        description:
          'Click a card for the full digital twin: battery, climate, doors, software updates, location, and the live signal stream.',
        placement: 'right',
      },
      {
        target: '[data-tour="vehicle-detail-tabs"]',
        title: 'Sectioned details',
        description:
          'Tabs split the dossier into Overview, History, Telemetry, and Maintenance so the page stays scannable on mobile.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="vehicle-access"]',
        title: 'Share access',
        description:
          'Invite a partner or family member with their own login. Role-based access controls what they can see and command.',
        placement: 'top',
      },
    ];

    expectedSteps.forEach((expected, i) => {
      const step = VEHICLES_TOUR.steps[i];
      expect(step.target).toBe(expected.target);
      expect(step.title).toBe(expected.title);
      expect(step.description).toBe(expected.description);
      expect(step.placement).toBe(expected.placement);

      expect(webSource).toContain(`target: '${expected.target}'`);
      expect(webSource).toContain(`title: '${expected.title}'`);
      expect(webSource).toContain(expected.description);
      expect(webSource).toContain(`placement: '${expected.placement}'`);
    });
  });

  it('exposes a native-safe onShow on the first step (no DOM navigation)', () => {
    const first = VEHICLES_TOUR.steps[0];
    expect(typeof first.onShow).toBe('function');
    // The web onShow calls navigate('/vehicles'); on native this must be a
    // no-op that neither throws nor returns a value.
    expect(first.onShow?.()).toBeUndefined();
    expect(webSource).toContain("onShow: () => navigate('/vehicles')");

    // The remaining steps have no onShow/onHide, matching the web source.
    expect(VEHICLES_TOUR.steps[1].onShow).toBeUndefined();
    expect(VEHICLES_TOUR.steps[2].onShow).toBeUndefined();
    expect(VEHICLES_TOUR.steps[3].onShow).toBeUndefined();
  });
});
