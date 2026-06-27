import {
  avgGrade,
  computePeriodStats,
  dailyTrend,
  detectAnomalies,
  detectCommutes,
  detectNotable,
  getEfficiency,
  gradeFromEfficiency,
  gradeFromNumeric,
  groupByDate,
  localDayKey,
  parseLocalDay,
  priorPeriod,
} from '../src/web-parity/lib/drivesAggregation';

// Mirrors the inlined (non-exported) `Drive` shape so the factory below builds
// objects structurally assignable to the helpers' `Drive` parameter.
interface DriveLike {
  id: number;
  vehicleId: number;
  startTs: string;
  endTs: string | null;
  durationS: number;
  distanceM: number;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  energyUsedWh: number | null;
  regenEnergyWh: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPowerW: number | null;
  outsideTempAvgC: number | null;
  insideTempAvgC: number | null;
  score: number | null;
  endedStatus: string | null;
  createdAt: string;
  updatedAt: string;
  live?: boolean;
}

let nextId = 1;

function makeDrive(over: Partial<DriveLike> = {}): DriveLike {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-04-10T08:00:00Z',
    endTs: '2026-04-10T08:30:00Z',
    durationS: 1800,
    distanceM: 50000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2026-04-10T08:30:00Z',
    updatedAt: '2026-04-10T08:30:00Z',
    ...over,
  };
}

describe('web-parity drivesAggregation', () => {
  describe('getEfficiency', () => {
    it('computes Wh/km from battery delta and distance', () => {
      // (10 * 0.75 * 1000) / (50000 / 1000) = 7500 / 50 = 150 Wh/km.
      const eff = getEfficiency(
        makeDrive({startBatteryPct: 80, endBatteryPct: 70, distanceM: 50000}),
      );
      expect(eff).toBeCloseTo(150, 6);
    });

    it('returns null when distance is zero', () => {
      expect(
        getEfficiency(
          makeDrive({startBatteryPct: 80, endBatteryPct: 70, distanceM: 0}),
        ),
      ).toBeNull();
    });

    it('returns null when no battery was consumed (regen / charge / flat)', () => {
      expect(
        getEfficiency(
          makeDrive({startBatteryPct: 70, endBatteryPct: 80, distanceM: 50000}),
        ),
      ).toBeNull();
    });

    it('treats missing battery readings as zero delta -> null', () => {
      expect(getEfficiency(makeDrive({distanceM: 50000}))).toBeNull();
    });
  });

  describe('gradeFromEfficiency', () => {
    it('maps efficiency bands to letters with the badge palette', () => {
      expect(gradeFromEfficiency(129)).toMatchObject({
        label: 'A+',
        color: '#10b981',
        numeric: 4.5,
      });
      expect(gradeFromEfficiency(130).label).toBe('A');
      expect(gradeFromEfficiency(159).label).toBe('A');
      expect(gradeFromEfficiency(160).label).toBe('B');
      expect(gradeFromEfficiency(189).label).toBe('B');
      expect(gradeFromEfficiency(190).label).toBe('C');
      expect(gradeFromEfficiency(219).label).toBe('C');
      expect(gradeFromEfficiency(220).label).toBe('D');
      expect(gradeFromEfficiency(999).label).toBe('D');
    });

    it('returns the em-dash sentinel for null', () => {
      expect(gradeFromEfficiency(null)).toEqual({
        label: '—',
        color: '#6b7280',
        numeric: null,
      });
    });
  });

  describe('gradeFromNumeric', () => {
    it('maps averaged weights back to letters', () => {
      expect(gradeFromNumeric(4.25).label).toBe('A+');
      expect(gradeFromNumeric(3.5).label).toBe('A');
      expect(gradeFromNumeric(3.4).label).toBe('B');
      expect(gradeFromNumeric(2.5).label).toBe('B');
      expect(gradeFromNumeric(1.5).label).toBe('C');
      expect(gradeFromNumeric(1.49).label).toBe('D');
    });

    it('returns the sentinel for null and non-finite weights', () => {
      expect(gradeFromNumeric(null).label).toBe('—');
      expect(gradeFromNumeric(Number.POSITIVE_INFINITY).label).toBe('—');
      expect(gradeFromNumeric(NaN).label).toBe('—');
    });
  });

  describe('avgGrade', () => {
    it('skips ungraded drives and averages the rest', () => {
      const drives = [
        makeDrive({startBatteryPct: 80, endBatteryPct: 70, distanceM: 50000}), // 150 -> A (4.0)
        makeDrive({startBatteryPct: 80, endBatteryPct: 79, distanceM: 50000}), // 15 -> A+ (4.5)
        makeDrive({distanceM: 0}), // ungraded -> skipped
      ];
      // (4.0 + 4.5) / 2 = 4.25 -> A+
      expect(avgGrade(drives).label).toBe('A+');
    });

    it('returns the sentinel when nothing is gradable', () => {
      expect(avgGrade([makeDrive({distanceM: 0})]).label).toBe('—');
      expect(avgGrade([]).label).toBe('—');
    });
  });

  describe('computePeriodStats', () => {
    it('aggregates totals, longest, top speed, best efficiency and energy', () => {
      const drives = [
        makeDrive({
          distanceM: 50000,
          durationS: 1800,
          maxSpeedMps: 30,
          startBatteryPct: 80,
          endBatteryPct: 70, // 10% -> 150 Wh/km, 7.5 kWh
        }),
        makeDrive({
          distanceM: 100000,
          durationS: 3600,
          maxSpeedMps: 45,
          startBatteryPct: 80,
          endBatteryPct: 76, // 4% over 100km -> 30 Wh/km (best), 3 kWh
        }),
      ];
      const stats = computePeriodStats(drives);
      expect(stats.count).toBe(2);
      expect(stats.totalDistanceM).toBe(150000);
      expect(stats.totalDurationS).toBe(5400);
      expect(stats.topSpeedMps).toBe(45);
      expect(stats.longest?.distanceM).toBe(100000);
      expect(stats.avgEfficiencyWhKm).toBeCloseTo((150 + 30) / 2, 6);
      expect(stats.bestEfficiencyWhKm).toBeCloseTo(30, 6);
      expect(stats.totalEnergyKwh).toBeCloseTo(7.5 + 3, 6);
      // 150 Wh/km -> grade A (4.0); 30 Wh/km -> grade A+ (4.5).
      expect(stats.avgGradeNumeric).toBeCloseTo((4.0 + 4.5) / 2, 6);
    });

    it('returns an empty-window shape with null longest', () => {
      const stats = computePeriodStats([]);
      expect(stats.count).toBe(0);
      expect(stats.longest).toBeNull();
      expect(stats.avgEfficiencyWhKm).toBeNull();
      expect(stats.bestEfficiencyWhKm).toBeNull();
      expect(stats.avgGradeNumeric).toBeNull();
      expect(stats.totalEnergyKwh).toBe(0);
    });

    it('honours an inclusive YYYY-MM-DD date range in the supplied tz', () => {
      const drives = [
        makeDrive({startTs: '2026-04-09T12:00:00Z'}),
        makeDrive({startTs: '2026-04-10T12:00:00Z'}),
        makeDrive({startTs: '2026-04-11T12:00:00Z'}),
      ];
      const stats = computePeriodStats(drives, '2026-04-10', '2026-04-10', 'UTC');
      expect(stats.count).toBe(1);
    });
  });

  describe('priorPeriod', () => {
    it('returns the equally sized window immediately before', () => {
      expect(priorPeriod('2026-04-08', '2026-04-14')).toEqual({
        start: '2026-04-01',
        end: '2026-04-07',
      });
    });

    it('handles a single-day window', () => {
      expect(priorPeriod('2026-04-10', '2026-04-10')).toEqual({
        start: '2026-04-09',
        end: '2026-04-09',
      });
    });

    it('returns null for missing or malformed input', () => {
      expect(priorPeriod(undefined, '2026-04-10')).toBeNull();
      expect(priorPeriod('2026-04-10', undefined)).toBeNull();
      expect(priorPeriod('not-a-date', '2026-04-10')).toBeNull();
    });
  });

  describe('detectAnomalies', () => {
    it('returns only grade-D drives', () => {
      const bad = makeDrive({
        startBatteryPct: 80,
        endBatteryPct: 40,
        distanceM: 50000,
      }); // 40% over 50km -> 600 Wh/km -> D
      const good = makeDrive({
        startBatteryPct: 80,
        endBatteryPct: 79,
        distanceM: 50000,
      }); // A+
      const result = detectAnomalies([bad, good]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(bad.id);
    });
  });

  describe('detectNotable', () => {
    it('is empty for no drives', () => {
      expect(detectNotable([])).toEqual([]);
    });

    it('includes long-distance (top decile) and A+ drives without duplicates', () => {
      const drives = Array.from({length: 20}, (_unused, i) =>
        makeDrive({distanceM: (i + 1) * 1000}),
      );
      // With the A+ drive appended the pool is 21, so the "top decile" cutoff
      // is ceil(21 * 0.1) = 3 longest by distance (20000 / 19000 / 18000 m).
      const aplus = makeDrive({
        distanceM: 10000,
        startBatteryPct: 80,
        endBatteryPct: 79, // 1% over 10km -> 75 Wh/km -> A+
      });
      const result = detectNotable([...drives, aplus]);
      const ids = result.map(d => d.id);
      expect(new Set(ids).size).toBe(ids.length); // de-duplicated
      expect(ids).toContain(aplus.id); // A+ included despite a short distance
      // The two longest drives are present.
      const longest = [...drives].sort((a, b) => b.distanceM - a.distanceM);
      expect(ids).toContain(longest[0].id);
      expect(ids).toContain(longest[1].id);
    });
  });

  describe('detectCommutes', () => {
    it('returns drives on a direction-insensitive pair seen >= minOccurrences', () => {
      const home = 'Home St';
      const work = 'Work Ave';
      const commute = [
        makeDrive({startAddress: home, endAddress: work}),
        makeDrive({startAddress: work, endAddress: home}), // reverse counts
        makeDrive({startAddress: home, endAddress: work}),
      ];
      const oneOff = makeDrive({startAddress: 'A', endAddress: 'B'});
      const noAddr = makeDrive({startAddress: null, endAddress: work});
      const result = detectCommutes([...commute, oneOff, noAddr]);
      expect(result.map(d => d.id).sort()).toEqual(
        commute.map(d => d.id).sort(),
      );
    });

    it('respects a custom minOccurrences threshold', () => {
      const drives = [
        makeDrive({startAddress: 'a', endAddress: 'b'}),
        makeDrive({startAddress: 'a', endAddress: 'b'}),
      ];
      expect(detectCommutes(drives, 2)).toHaveLength(2);
      expect(detectCommutes(drives, 3)).toHaveLength(0);
    });
  });

  describe('localDayKey', () => {
    it('returns null for empty / invalid input', () => {
      expect(localDayKey(null)).toBeNull();
      expect(localDayKey(undefined)).toBeNull();
      expect(localDayKey('not-a-date')).toBeNull();
    });

    it('resolves the day in the requested IANA zone', () => {
      // 06:30 UTC is still the previous calendar day in Los Angeles.
      expect(localDayKey('2026-04-11T06:30:00Z', 'America/Los_Angeles')).toBe(
        '2026-04-10',
      );
      expect(localDayKey('2026-04-11T06:30:00Z', 'UTC')).toBe('2026-04-11');
    });
  });

  describe('parseLocalDay', () => {
    it('anchors a valid key at UTC noon', () => {
      const d = parseLocalDay('2026-04-24');
      expect(d.getUTCFullYear()).toBe(2026);
      expect(d.getUTCMonth()).toBe(3);
      expect(d.getUTCDate()).toBe(24);
      expect(d.getUTCHours()).toBe(12);
    });

    it('returns an invalid Date for a malformed key', () => {
      expect(Number.isNaN(parseLocalDay('nope').getTime())).toBe(true);
    });
  });

  describe('groupByDate', () => {
    it('buckets by day key in descending date order, splitting at T', () => {
      const items = [
        {id: 1, day: '2026-04-10T08:00:00Z'},
        {id: 2, day: '2026-04-11T09:00:00Z'},
        {id: 3, day: '2026-04-10T20:00:00Z'},
        {id: 4, day: null},
      ];
      const groups = groupByDate(items, it => it.day);
      expect(groups.map(g => g.dateKey)).toEqual(['2026-04-11', '2026-04-10']);
      expect(groups[1].items.map(i => i.id)).toEqual([1, 3]);
    });
  });

  describe('dailyTrend', () => {
    const drives = [
      makeDrive({
        startTs: '2026-04-10T08:00:00Z',
        distanceM: 50000,
        startBatteryPct: 80,
        endBatteryPct: 70, // 150 Wh/km, 7.5 kWh
      }),
      makeDrive({
        startTs: '2026-04-10T18:00:00Z',
        distanceM: 50000,
        startBatteryPct: 80,
        endBatteryPct: 78, // 30 Wh/km, 1.5 kWh
      }),
      makeDrive({
        startTs: '2026-04-11T08:00:00Z',
        distanceM: 20000,
        startBatteryPct: 80,
        endBatteryPct: 70, // 375 Wh/km, 7.5 kWh
      }),
    ];

    it('counts drives per day, ascending', () => {
      expect(dailyTrend(drives, 'drives', 'UTC')).toEqual([
        {date: '2026-04-10', value: 2},
        {date: '2026-04-11', value: 1},
      ]);
    });

    it('sums distance per day', () => {
      expect(dailyTrend(drives, 'distance', 'UTC')).toEqual([
        {date: '2026-04-10', value: 100000},
        {date: '2026-04-11', value: 20000},
      ]);
    });

    it('averages efficiency per day', () => {
      const points = dailyTrend(drives, 'efficiency', 'UTC');
      expect(points[0].value).toBeCloseTo((150 + 30) / 2, 6);
      expect(points[1].value).toBeCloseTo(375, 6);
    });

    it('sums cost (kWh-equivalent) per day', () => {
      const points = dailyTrend(drives, 'cost', 'UTC');
      expect(points[0].value).toBeCloseTo(9, 6);
      expect(points[1].value).toBeCloseTo(7.5, 6);
    });

    it('averages the score weight per day', () => {
      const points = dailyTrend(drives, 'score', 'UTC');
      // Apr 10: A (150 -> 4.0) and A+ (30 -> 4.5) -> 4.25; Apr 11: D (375 -> 1.0).
      expect(points[0].value).toBeCloseTo(4.25, 6);
      expect(points[1].value).toBeCloseTo(1.0, 6);
    });
  });
});
