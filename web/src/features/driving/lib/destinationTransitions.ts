/**
 * First-order destination transition model.
 *
 * Each valid drive contributes its normalized END destination to a
 * chronological sequence. A drive with an unknown destination breaks the
 * sequence, preventing an invented transition across missing data.
 */
import type { Drive } from '@/types/driving';

export interface DestinationState {
  key: string;
  label: string;
  visits: number;
  visitShare: number;
}

export interface TransitionCell {
  toKey: string;
  toLabel: string;
  count: number;
  probability: number;
}

export interface TransitionRow {
  fromKey: string;
  fromLabel: string;
  total: number;
  entropyBits: number;
  cells: TransitionCell[];
}

export interface DestinationPrediction {
  fromKey: string;
  fromLabel: string;
  toKey: string;
  toLabel: string;
  probability: number;
  count: number;
}

export interface SurprisingTransition extends DestinationPrediction {
  surpriseBits: number;
}

export interface DestinationTransitionResult {
  states: DestinationState[];
  matrix: TransitionRow[];
  visits: number;
  transitions: number;
  entropyRateBits: number | null;
  predictability: number | null;
  prediction: DestinationPrediction | null;
  surprisingTransitions: SurprisingTransition[];
}

interface Location {
  key: string;
  label: string;
}

function coordinate(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(3);
}

/** Normalize an end destination using address first, then rounded GPS. */
export function normalizeDestination(drive: Pick<Drive, 'endAddress' | 'endLat' | 'endLon'>): Location | null {
  const label = drive.endAddress?.trim().replace(/\s+/g, ' ') ?? '';
  if (label) {
    const key = label
      .normalize('NFKD')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (key) return { key: `address:${key}`, label };
  }
  const { endLat: lat, endLon: lon } = drive;
  if (
    lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) return null;
  const labelFromCoordinates = `${coordinate(lat)}, ${coordinate(lon)}`;
  return { key: `geo:${labelFromCoordinates.replace(' ', '')}`, label: labelFromCoordinates };
}

function entropy(probabilities: readonly number[]): number {
  return probabilities.reduce(
    (sum, probability) => probability > 0 ? sum - probability * Math.log2(probability) : sum,
    0,
  );
}

export function buildDestinationTransitions(drives: readonly Drive[]): DestinationTransitionResult {
  const records = drives
    .map((drive, index) => ({
      index,
      startMs: new Date(drive.startTs).getTime(),
      destination: normalizeDestination(drive),
    }))
    .filter((record) => Number.isFinite(record.startMs))
    .sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  const labels = new Map<string, string>();
  const visits = new Map<string, number>();
  for (const record of records) {
    if (!record.destination) continue;
    labels.set(record.destination.key, labels.get(record.destination.key) ?? record.destination.label);
    visits.set(record.destination.key, (visits.get(record.destination.key) ?? 0) + 1);
  }

  const counts = new Map<string, Map<string, number>>();
  let transitionCount = 0;
  for (let index = 1; index < records.length; index++) {
    const from = records[index - 1]!.destination;
    const to = records[index]!.destination;
    if (!from || !to) continue;
    const row = counts.get(from.key) ?? new Map<string, number>();
    row.set(to.key, (row.get(to.key) ?? 0) + 1);
    counts.set(from.key, row);
    transitionCount += 1;
  }

  const totalVisits = Array.from(visits.values()).reduce((sum, value) => sum + value, 0);
  const states = Array.from(visits, ([key, count]) => ({
    key,
    label: labels.get(key) ?? key,
    visits: count,
    visitShare: totalVisits > 0 ? count / totalVisits : 0,
  })).sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label));

  const matrix = states.map<TransitionRow>((state) => {
    const rowCounts = counts.get(state.key);
    const total = rowCounts
      ? Array.from(rowCounts.values()).reduce((sum, value) => sum + value, 0)
      : 0;
    const cells = states.map((destination) => {
      const count = rowCounts?.get(destination.key) ?? 0;
      return {
        toKey: destination.key,
        toLabel: destination.label,
        count,
        probability: total > 0 ? count / total : 0,
      };
    });
    return {
      fromKey: state.key,
      fromLabel: state.label,
      total,
      entropyBits: entropy(cells.map((cell) => cell.probability)),
      cells,
    };
  });

  const entropyRateBits = transitionCount > 0
    ? matrix.reduce((sum, row) => sum + row.entropyBits * row.total, 0) / transitionCount
    : null;
  const maxEntropy = states.length > 1 ? Math.log2(states.length) : 0;
  const predictability = entropyRateBits == null
    ? null
    : maxEntropy === 0 ? 1 : Math.max(0, 1 - entropyRateBits / maxEntropy);

  const latest = records.slice().reverse().find((record) => record.destination)?.destination ?? null;
  const latestRow = latest ? matrix.find((row) => row.fromKey === latest.key) : undefined;
  const likelyCell = latestRow?.cells
    .filter((cell) => cell.count > 0)
    .sort((a, b) => b.probability - a.probability || b.count - a.count || a.toLabel.localeCompare(b.toLabel))[0];
  const prediction = latest && latestRow && likelyCell ? {
    fromKey: latest.key,
    fromLabel: latest.label,
    toKey: likelyCell.toKey,
    toLabel: likelyCell.toLabel,
    probability: likelyCell.probability,
    count: likelyCell.count,
  } : null;

  const surprisingTransitions = matrix.flatMap((row) =>
    row.cells
      .filter((cell) => cell.count > 0)
      .map((cell) => ({
        fromKey: row.fromKey,
        fromLabel: row.fromLabel,
        toKey: cell.toKey,
        toLabel: cell.toLabel,
        probability: cell.probability,
        count: cell.count,
        surpriseBits: -Math.log2(cell.probability),
      })),
  ).sort((a, b) => b.surpriseBits - a.surpriseBits || b.count - a.count).slice(0, 10);

  return {
    states,
    matrix,
    visits: totalVisits,
    transitions: transitionCount,
    entropyRateBits,
    predictability,
    prediction,
    surprisingTransitions,
  };
}
