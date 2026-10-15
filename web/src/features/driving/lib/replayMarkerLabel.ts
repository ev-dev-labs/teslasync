import type { ReplayMarkerKind } from './replayMarkers';

const REPLAY_MARKER_KEYS: Record<string, { key: string; fallback: string; plural: string }> = {
  start: { key: 'replay.markers.start', fallback: 'Start', plural: '{{value}} starts' },
  stop: { key: 'replay.markers.stop', fallback: 'End', plural: '{{value}} ends' },
  'charge-start': { key: 'replay.markers.chargeStart', fallback: 'Charge start', plural: '{{value}} charge starts' },
  'charge-stop': { key: 'replay.markers.chargeStop', fallback: 'Charge stop', plural: '{{value}} charge stops' },
  'fast-segment': { key: 'replay.markers.fastSegment', fallback: 'Fast segment', plural: '{{value}} fast segments' },
  'regen-peak': { key: 'replay.markers.regenPeak', fallback: 'Regen peak', plural: '{{value}} regen peaks' },
  'low-soc': { key: 'replay.markers.lowSoc', fallback: 'Low battery', plural: '{{value}} low battery points' },
};

/** Localizes a pure kind/count replay marker; clusters use count-aware plurals. */
export function replayMarkerLabel(
  t: (key: string, options: Record<string, unknown>) => string,
  fmtInt: (value: number) => string,
  kind: ReplayMarkerKind,
  count?: number,
): string | undefined {
  const entry = REPLAY_MARKER_KEYS[kind];
  if (!entry) return undefined;
  if (count == null || count <= 1) return t(entry.key, { defaultValue: entry.fallback });
  return t(`${entry.key}Count`, {
    count,
    value: fmtInt(count),
    defaultValue_one: entry.fallback,
    defaultValue: entry.plural,
  });
}
