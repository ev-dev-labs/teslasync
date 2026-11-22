import type { DriveGridOverview, DriveGridQuery, DriveGridScope, DriveGridStats } from '../src/api/hooks/useDriveGrid';
import type { Drive } from '../src/types/driving';
import type { DriveFsdInsight } from '../src/types/fsd';

const intensity = (drive: Drive) => drive.distanceM >= 1000 && (drive.energyUsedWh ?? 0) > 0
  ? drive.energyUsedWh! / (drive.distanceM / 1000) : null;
const grade = (drive: Drive) => {
  const value = intensity(drive);
  return value === null ? null : value < 130 ? 'A+' : value < 160 ? 'A' : value < 190 ? 'B' : value < 220 ? 'C' : 'D';
};
const positive = (value: number | null | undefined) => (value ?? 0) > 0 ? value! : null;
const flags = (drive: Drive) => [
  drive.endTs == null ? 'inProgress' : drive.distanceM <= 0 && drive.durationS <= 0 ? 'noTelemetry' : '',
  (drive.maxSpeedMps ?? 0) > 58.1152 ? 'highSpeed' : '',
  grade(drive) === 'D' ? 'highEnergyUse' : '',
].filter(Boolean).join('|');
const status = (drive: Drive) => drive.endTs == null ? 'inProgress' : flags(drive) ? 'needsReview' : 'recorded';

function stats(drives: Drive[]): DriveGridStats {
  const energy = drives.filter(d => positive(d.energyUsedWh) != null);
  const efficient = energy.filter(d => intensity(d) != null);
  const speeds = drives.flatMap(d => d.maxSpeedMps == null ? [] : [d.maxSpeedMps]);
  return {
    count: drives.length,
    total_distance_m: drives.reduce((sum, d) => sum + d.distanceM, 0),
    total_duration_s: drives.reduce((sum, d) => sum + d.durationS, 0),
    total_energy_wh: energy.reduce((sum, d) => sum + d.energyUsedWh!, 0),
    energy_measured_count: energy.length,
    efficiency_measured_count: efficient.length,
    efficiency_wh_per_m: efficient.length ? efficient.reduce((sum, d) => sum + d.energyUsedWh!, 0) /
      efficient.reduce((sum, d) => sum + d.distanceM, 0) : null,
    top_speed_mps: speeds.length ? Math.max(...speeds) : null,
    longest_distance_m: drives.length ? Math.max(...drives.map(d => d.distanceM)) : null,
  };
}

export function driveGridFixture(drives: Drive[], scope: DriveGridScope, fsd: DriveFsdInsight[] = []) {
  const { start, end, timezone } = scope;
  const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'short' });
  const active = drives.filter(d => Date.parse(d.startTs) >= Date.parse(start) && Date.parse(d.startTs) < Date.parse(end))
    .sort((a, b) => Date.parse(b.startTs) - Date.parse(a.startTs) || b.id - a.id);
  const fsdById = new Map(fsd.map(entry => [entry.drive_id, entry]));
  const anomalies = active.filter(d => grade(d) === 'D');
  const longest = new Set([...active].sort((a, b) => b.distanceM - a.distanceM)
    .slice(0, Math.min(50, Math.ceil(active.length / 10))).map(d => d.id));
  const notable = active.filter(d => longest.has(d.id) || grade(d) === 'A+');
  const routePair = (d: Drive) => d.startAddress && d.endAddress
    ? [d.startAddress.toLowerCase(), d.endAddress.toLowerCase()].sort().join('|') : null;
  const pairs = new Map<string, number>();
  for (const d of active) {
    const pair = routePair(d);
    if (pair) pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  const commutes = active.filter(d => (pairs.get(routePair(d) ?? '') ?? 0) >= 3);
  const collectionRows: Record<string, Drive[]> = { anomalies, notable, commutes, tagged: [] };
  const cell = (d: Drive, key: string): string | number | null => {
    const insight = fsdById.get(d.id);
    const batteryUnknown = d.endTs != null && d.startBatteryPct === 0 && d.endBatteryPct === 0;
    const values: Record<string, string | number | null | undefined> = {
      date: d.startTs, start: d.startAddress, destination: d.endAddress,
      route: d.startAddress || d.endAddress ? `${d.startAddress ?? '—'} → ${d.endAddress ?? '—'}` : null,
      distance: positive(d.distanceM), duration: d.durationS, energy: positive(d.energyUsedWh), cost: positive(d.energyUsedWh),
      speed: d.avgSpeedMps ?? (d.durationS > 0 ? d.distanceM / d.durationS : null),
      maxSpeed: d.maxSpeedMps, avgPower: d.avgPowerW, outsideTemp: d.outsideTempAvgC, insideTemp: d.insideTempAvgC,
      startBattery: batteryUnknown ? null : d.startBatteryPct, battery: batteryUnknown ? null : d.endBatteryPct,
      batteryUsed: batteryUnknown || d.startBatteryPct == null || d.endBatteryPct == null ? null : d.startBatteryPct - d.endBatteryPct,
      regen: d.regenEnergyWh, efficiency: intensity(d), grade: grade(d), score: d.score, status: flags(d) || null,
      fsd: insight?.fsd_distance_m == null || insight.confidence === 'unknown' ? null : insight.fsd_share_pct == null
        ? `distance:${insight.fsd_distance_m}` : `share:${insight.fsd_share_pct}`,
    };
    return values[key] ?? null;
  };
  const contains = (text: string | number | null, target: string) => String(text ?? '').toLowerCase().includes(target.toLowerCase());
  const day = (d: Drive) => localDay.format(new Date(d.startTs));
  const match = (query: DriveGridQuery) => (collectionRows[query.collection ?? ''] ?? active).filter(d => {
    const insight = fsdById.get(d.id);
    if (query.invalid || query.status && query.status !== 'all' && query.status !== status(d)
      || query.grade && query.grade !== (grade(d) ?? '—')) return false;
    if (query.fsd && query.fsd !== 'all' && (query.fsd === 'reported' ? cell(d, 'fsd') == null : insight?.confidence !== query.fsd)) return false;
    if (Object.entries(query.values ?? {}).some(([key, { keys, exclude }]) => keys.includes(cell(d, key)) === exclude)) return false;
    if (Object.entries(query.text ?? {}).some(([key, text]) => !contains(key === 'date' ? day(d) : cell(d, key), text))) return false;
    if (Object.entries(query.minimum ?? {}).some(([key, bound]) => {
      const value = cell(d, key);
      return typeof value !== 'number' || value < bound;
    })) return false;
    return query.search?.every(token => {
      if (token.kind === 'kv') {
        if (token.key === 'grade' || token.key === 'score') return (grade(d) ?? '—').toLowerCase() === token.value.toLowerCase();
        if (token.key === 'from') return contains(day(d), token.value);
        if (token.key === 'distance' && token.target != null) {
          const { target } = token;
          return token.op === '>' ? d.distanceM > target : token.op === '>=' ? d.distanceM >= target
            : token.op === '<' ? d.distanceM < target : token.op === '<=' ? d.distanceM <= target : d.distanceM === target;
        }
      }
      const text = token.kind === 'kv' ? `${token.key}:${token.value}` : token.value;
      const distance = (d.distanceM * (query.distance_unit_scale ?? 0)).toFixed(query.precision);
      return [d.startAddress, d.endAddress, grade(d), distance].some(value => contains(value, text));
    }) ?? true;
  });
  const compare = (left: string | number | null, right: string | number | null, dir: number) => (
    left == null ? Number(right != null) : right == null ? -1
      : dir * (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right)))
  );
  return {
    overview(priorStart?: string): DriveGridOverview {
      const days = new Map<string, Drive[]>();
      for (const d of active) {
        const date = day(d);
        const group = days.get(date) ?? [];
        group.push(d);
        days.set(date, group);
      }
      return {
        current: stats(active),
        prior: priorStart ? stats(drives.filter(d => Date.parse(d.startTs) >= Date.parse(priorStart) && Date.parse(d.startTs) < Date.parse(start))) : null,
        days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, group]) => ({ date, ...stats(group) })),
        evidence: (anomalies.length ? anomalies : active).slice(0, 5).map(d => ({ ...d, anomalous: grade(d) === 'D' })),
        anomaly_count: anomalies.length, notable_count: notable.length, commute_count: commutes.length,
        route_context_count: active.filter(d => d.startAddress && d.endAddress).length,
      };
    },
    page(query: DriveGridQuery, page: number, size: number) {
      const rows = match(query);
      const field = query.sort ?? 'date';
      if (field !== 'date' || query.direction === 'asc') {
        const dir = query.direction === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          if (field === 'fsd') return compare(fsdById.get(a.id)?.fsd_share_pct ?? null, fsdById.get(b.id)?.fsd_share_pct ?? null, dir)
            || compare(fsdById.get(a.id)?.fsd_distance_m ?? null, fsdById.get(b.id)?.fsd_distance_m ?? null, dir);
          if (field === 'status') return ['recorded', 'needsReview', 'inProgress'].indexOf(status(a)) * dir
            - ['recorded', 'needsReview', 'inProgress'].indexOf(status(b)) * dir;
          return compare(field === 'grade' ? intensity(a) : cell(a, field), field === 'grade' ? intensity(b) : cell(b, field), dir);
        });
      }
      const safe = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
      return { items: rows.slice((safe - 1) * size, safe * size), total: rows.length, page: safe };
    },
    facets(field: string) {
      const counts = new Map<string | number | null, number>();
      for (const d of active) {
        const value = cell(d, field);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts].map(([value, count]) => ({ value, count }));
    },
    ids: (query: DriveGridQuery) => match(query).map(d => d.id),
  };
}

export function driveGridResponse(drives: object[], params: URLSearchParams, fsd?: DriveFsdInsight[]): unknown {
  const view = params.get('view');
  if (!view) return drives;
  const rows = drives.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), value])) as unknown as Drive);
  const scope = { start: params.get('start')!, end: params.get('end')!, timezone: params.get('timezone') ?? 'UTC' };
  const fixture = driveGridFixture(rows, scope, fsd);
  if (view === 'overview') return fixture.overview(params.get('prior_start') ?? undefined);
  if (view === 'values') return fixture.facets(params.get('field')!);
  const query = JSON.parse(params.get('grid') ?? '{}') as DriveGridQuery;
  if (view === 'ids') return fixture.ids(query);
  const size = Number(params.get('limit') ?? 50);
  return fixture.page(query, 1 + Math.floor(Number(params.get('offset') ?? 0) / size), size);
}
