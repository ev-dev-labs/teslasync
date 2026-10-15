import { createInstance } from 'i18next';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import englishCatalog from '@/i18n/en.json';
import { scoreAdmissionReasons, scoreDrive, summarizeScoreAdmission } from './scoreDomain';
import { ScoreSourceNotices } from './ScoreSourceNotices';

const english = createInstance();
beforeAll(async () => {
  await english.init({ lng: 'en', resources: { en: { translation: englishCatalog } } });
});
afterEach(cleanup);

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1, vehicleId: 7, startTs: '2026-10-14T10:00:00Z', endTs: null,
    durationS: 60, distanceM: 1_000, energyUsedWh: 130, avgPowerW: 0, maxSpeedMps: 0,
    startAddress: null, endAddress: null, startLat: null, startLon: null,
    endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
    regenEnergyWh: null, avgSpeedMps: null, outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: '', updatedAt: '', ...overrides,
  };
}

function mount(drives: Drive[], loading = false) {
  type Model = Parameters<typeof ScoreSourceNotices>[0]['model'];
  const model: Model = {
    t: english.getFixedT('en'),
    drivesSource: deriveDataState({ data: drives, isSuccess: true }, { provenance: 'historical' }),
    apiScoreState: deriveDataState({ isPending: true }),
    vehicleIdStr: '7', hasDrives: drives.some((item) => scoreDrive(item) != null),
    scoreQuery: { refetch: vi.fn() } as Model['scoreQuery'],
    drivesIsError: false, hasScore: false, drivesLoading: loading,
    filteredDrives: drives, fmtInt: (value) => new Intl.NumberFormat('de-DE').format(Number(value)),
  };
  return render(<ScoreSourceNotices model={model} />);
}

describe('local drive score admission', () => {
  it.each(['energyUsedWh', 'avgPowerW', 'maxSpeedMps'] as const)(
    'distinguishes missing %s from measured zero', (field) => {
      expect(scoreAdmissionReasons(drive({ [field]: null }))).toEqual(['missing']);
      expect(scoreDrive(drive({ [field]: null }))).toBeNull();
      expect(scoreAdmissionReasons(drive({ [field]: 0 }))).toEqual([]);
      expect(scoreDrive(drive({ [field]: 0 }))?.total).toBe(100);
    },
  );

  it.each(['distanceM', 'energyUsedWh', 'avgPowerW', 'maxSpeedMps'] as const)(
    'separates missing and nonfinite %s', (field) => {
      expect(scoreAdmissionReasons({ ...drive(), [field]: undefined })).toEqual(['missing']);
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(scoreAdmissionReasons(drive({ [field]: value }))).toEqual(['invalid']);
        expect(scoreDrive(drive({ [field]: value }))).toBeNull();
      }
    },
  );

  it('admits signed net energy and power and fractional measurements without truncating inputs', () => {
    expect(scoreDrive(drive({ energyUsedWh: -0.5, avgPowerW: -0.25 }))?.total).toBe(100);
    const result = scoreDrive(drive({
      distanceM: 1_000.5, energyUsedWh: 160.08, avgPowerW: 1_500.5, maxSpeedMps: 40.7336,
    }));
    expect(result).toEqual({
      total: 89, efficiency: 30, smoothness: 29, speed: 29, grade: 'A', whPerKm: 160,
    });
  });

  it('preserves the 1,000 m minimum and rejects negative distance and maximum speed', () => {
    expect(scoreAdmissionReasons(drive({ distanceM: 0 }))).toEqual(['shortDistance']);
    expect(scoreAdmissionReasons(drive({ distanceM: 999.999 }))).toEqual(['shortDistance']);
    expect(scoreDrive(drive({ distanceM: 999.999 }))).toBeNull();
    expect(scoreDrive(drive({ distanceM: 1_000 }))?.total).toBe(100);
    expect(scoreAdmissionReasons(drive({ distanceM: -0.5 }))).toEqual(['invalid']);
    expect(scoreAdmissionReasons(drive({ maxSpeedMps: -0.5 }))).toEqual(['invalid']);
  });

  it('preserves component thresholds and a measured total of zero', () => {
    expect(scoreDrive(drive({ energyUsedWh: 250, avgPowerW: 90_000, maxSpeedMps: 100 })))
      .toMatchObject({ total: 0, efficiency: 0, smoothness: 0, speed: 0, grade: 'F' });
    expect(scoreDrive(drive({ maxSpeedMps: 40.2336 }))?.speed).toBe(30);
    expect(scoreDrive(drive({ energyUsedWh: 160, avgPowerW: 3_000 }))?.total).toBe(89);
  });

  it('counts excluded drives once while retaining overlapping reasons', () => {
    const drives = [
      drive(), drive({ energyUsedWh: 0, avgPowerW: -1 }),
      drive({ distanceM: 500, energyUsedWh: null, maxSpeedMps: -1 }),
      drive({ avgPowerW: NaN }),
    ];
    expect(summarizeScoreAdmission(drives)).toEqual({
      excluded: 2, counts: { missing: 1, invalid: 2, shortDistance: 1 },
    });
    mount(drives);
    expect(screen.getByText(
      '2 drives are excluded from the local heuristic. Reason counts may overlap. '
      + '1 with missing inputs. 2 with invalid inputs. 1 below the 1,000 m minimum distance.',
    )).toBeInTheDocument();
  });

  it('uses catalog singular/plural forms with separately localized display counts', () => {
    const view = mount([drive({ energyUsedWh: null })]);
    expect(screen.getByText(/1 drive is excluded from the local heuristic/)).toBeInTheDocument();
    view.unmount();
    mount(Array.from({ length: 1_001 }, () => drive({ energyUsedWh: null })));
    expect(screen.getByText(/1\.001 drives are excluded.*1\.001 with missing inputs/)).toBeInTheDocument();
  });

  it('does not show exclusions for measured zero, signed readings, or initial loading', () => {
    const view = mount([drive({ energyUsedWh: 0 }), drive({ avgPowerW: -1 })]);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    const loading = mount([drive({ energyUsedWh: null })], true);
    expect(loading.container).toBeEmptyDOMElement();
  });
});
