import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive, DriveScore } from '@/types/driving';
import { Icons } from '@/lib/icons';
import { typography } from '@/lib/tokens';
import { useDriveScorePage } from './useDriveScorePage';

const state = vi.hoisted(() => ({
  drives: [] as Drive[],
  score: undefined as Partial<DriveScore> | null | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveScore: () => ({ data: state.score }),
  useDriveCalendarHistory: () => ({ data: state.drives }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-10-01T00:00:00Z',
    endInstantExclusive: '2026-11-01T00:00:00Z',
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: String,
    formatSpeed: String,
    formatPower: String,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: String, fmtNumber: String }),
}));
vi.mock('@/hooks/useDataState', () => ({
  useDataState: () => ({ hasData: true, fatalError: null }),
}));
vi.mock('@/components/ui', () => ({
  useSortToggle: () => ({
    sortKey: 'date',
    sortDir: 'desc',
    onSort: vi.fn(),
    sortFn: <T>(rows: T[]) => rows,
  }),
}));
vi.mock('../components/score-orchestrator/scoreHistoryColumns', () => ({
  createHistoryColumns: () => [],
}));

function makeDrive(id: number, overrides: Partial<Drive> = {}): Drive {
  return {
    id, vehicleId: 7,
    startTs: '2026-10-14T10:00:00Z', endTs: '2026-10-14T10:10:00Z',
    durationS: 600, distanceM: 10_000,
    startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: null, endBatteryPct: null,
    energyUsedWh: 1_000, regenEnergyWh: null,
    avgSpeedMps: 15, maxSpeedMps: 20, avgPowerW: 0,
    outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null,
    createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:10:00Z',
    ...overrides,
  };
}

const identities = [
  'first-drive', 'ten-drives', 'fifty-drives', 'perfect-score',
  'a-plus-streak', 'efficiency-master', 'smooth-operator', 'speed-saint',
];

describe('useDriveScorePage achievement cohort', () => {
  beforeEach(() => { state.drives = []; state.score = undefined; });

  it('keeps count achievements locked when all 50 drives lack scoring evidence', () => {
    state.drives = Array.from({ length: 50 }, (_, id) => makeDrive(id, { energyUsedWh: null }));
    const { result } = renderHook(() => useDriveScorePage());
    expect(result.current.filteredDrives).toHaveLength(50);
    expect(result.current.unscoredDriveCount).toBe(50);
    expect(result.current.unlockedAchievements.map(({ id }) => id)).toEqual(identities);
    expect(result.current.unlockedAchievements.every(({ unlocked }) => !unlocked)).toBe(true);
  });

  describe('useDriveScorePage trend evidence', () => {
    beforeEach(() => {
      state.score = undefined;
      state.drives = [makeDrive(1)];
    });

    it.each([undefined, null, { overall: 87 }])(
      'keeps missing trend unknown with populated local history (%j)',
      (score) => {
        state.score = score;
        const { result } = renderHook(() => useDriveScorePage());
        expect(result.current.hasDrives).toBe(true);
        expect(result.current.overallReading).toBe(score?.overall ?? 100);
        expect(result.current.overallTrend).toBeNull();
        expect(result.current.trendLabel).toBe('—');
        expect(result.current.trendColor).toBe(typography.color.secondary);
      },
    );

    it.each([
      ['up', 'Improving', Icons.trendUp],
      ['down', 'Declining', Icons.trendDown],
      ['flat', 'Stable', Icons.remove],
    ] as const)('preserves a supplied %s trend', (trend, label, icon) => {
      state.score = {
        overall: 87, efficiency: 35, smoothness: 25,
        speedDiscipline: 27, grade: 'A', totalDrives: 12, trend,
      };
      const { result } = renderHook(() => useDriveScorePage());
      expect(result.current.overallReading).toBe(87);
      expect(result.current.overallGrade).toBe('A');
      expect(result.current.overallTrend).toBe(trend);
      expect(result.current.trendLabel).toBe(label);
      expect(result.current.TrendIcon).toBe(icon);
    });

    it('keeps trend unknown when both score sources are absent', () => {
      state.drives = [];
      const { result } = renderHook(() => useDriveScorePage());
      expect(result.current.overallReading).toBeNull();
      expect(result.current.overallTrend).toBeNull();
      expect(result.current.trendLabel).toBe('—');
    });
  });

  it.each([
    ['first-drive', 1],
    ['ten-drives', 10],
    ['fifty-drives', 50],
  ] as const)('unlocks %s only at %i scored drives, ignoring unscored and out-of-range drives', (id, threshold) => {
    const scored = Array.from({ length: threshold - 1 }, (_, index) => makeDrive(index));
    state.drives = [
      ...scored,
      ...Array.from({ length: 50 }, (_, index) => makeDrive(100 + index, { avgPowerW: null })),
      makeDrive(200, { startTs: '2026-09-30T23:59:59Z' }),
      makeDrive(201, { startTs: '2026-11-01T00:00:00Z' }),
    ];
    const { result, rerender } = renderHook(() => useDriveScorePage());
    expect(result.current.scoredDrives).toHaveLength(threshold - 1);
    expect(result.current.unlockedAchievements.find((a) => a.id === id)?.unlocked).toBe(false);

    state.drives = [...state.drives, makeDrive(300)];
    rerender();
    expect(result.current.scoredDrives).toHaveLength(threshold);
    expect(result.current.unlockedAchievements.find((a) => a.id === id)?.unlocked).toBe(true);
  });

  it('preserves all eight unlocked achievements for a fully scored, qualifying cohort', () => {
    state.drives = Array.from({ length: 50 }, (_, id) => makeDrive(id));
    const { result } = renderHook(() => useDriveScorePage());
    expect(result.current.unscoredDriveCount).toBe(0);
    expect(result.current.unlockedAchievements.map(({ id }) => id)).toEqual(identities);
    expect(result.current.unlockedAchievements.every(({ unlocked }) => unlocked)).toBe(true);
  });
});
