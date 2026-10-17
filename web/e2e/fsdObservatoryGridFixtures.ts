import type {
  FsdInsights, FsdObservatoryCommuteChapter, FsdObservatoryEvent,
} from '../src/types/fsd';
import { resolveApiFixture } from './mockApi';

const at = '2026-08-26T15:15:00Z';

function event(index: number): FsdObservatoryEvent {
  const confidence = (['high', 'estimated', 'ambiguous', 'unknown'] as const)[index % 4];
  return {
    kind: 'drive', at: new Date(Date.parse(at) - index * 3_600_000).toISOString(),
    end_at: null, drive_id: 9000 + index, route_key: `journal-${index}`,
    route_label: `Journal route ${index + 1}`, firmware_version: index === 3 ? null : '2026.26.1',
    fsd_distance_m: confidence === 'unknown' ? null : index === 0 ? 0 : 1609.344,
    driving_distance_m: 3200, confidence, reset_break: false,
    approximate: confidence !== 'high', field: null,
  };
}

function chapter(index: number): FsdObservatoryCommuteChapter {
  return {
    firmware_version: index === 0 ? '2026.26.1' : '2026.30.2',
    first_at: at, last_at: at, drive_count: index === 0 ? 3 : 9,
    high_count: index === 0 ? 1 : 4, estimated_count: 1,
    ambiguous_count: index === 0 ? 1 : 2, unknown_count: index === 0 ? 0 : 2,
    reset_breaks: index === 0 ? 0 : 1,
    fsd_distance_m: index === 0 ? 0 : 1609.344,
    driving_distance_m: 3200, fsd_share_pct: index === 0 ? 0 : 50.25,
  };
}

export function fsdObservatoryGridFixture(mode: 'evidence' | 'paging' | 'empty' = 'evidence'): FsdInsights {
  const baseline = resolveApiFixture('/analytics/fsd', 'GET', 'populated');
  if (!baseline.matched || !baseline.body) throw new Error('Missing shared FSD fixture');
  const insights = structuredClone(baseline.body as FsdInsights);
  insights.drive_analytics.observatory = {
    honesty: 'Reset-safe counter evidence; not engagement segments.',
    truncated: false,
    totals: {
      stitched_fsd_distance_m: 1609.344, high_fsd_distance_m: 0,
      estimated_fsd_distance_m: 1609.344, ambiguous_fsd_distance_m: 1609.344,
      unknown_drive_distance_m: 3200, reset_break_count: 1, drive_count: 4,
      measured_drive_count: 3, unknown_drive_count: 1,
    },
    timeline: mode === 'empty' ? [] : [
      ...Array.from({ length: mode === 'paging' ? 52 : 4 }, (_, index) => event(index)),
      {
        ...event(99), kind: 'reset', drive_id: null, route_key: null,
        route_label: null, confidence: null, fsd_distance_m: 999_999,
        reset_break: true, field: 'SelfDrivingMilesSinceReset',
      },
    ],
    commute_stories: mode === 'empty' ? [] : mode === 'paging'
      ? Array.from({ length: 26 }, (_, index) => ({
          route_key: `commute-${index}`, route_label: `Commute route ${index + 1}`,
          drive_count: 12, chapters: [chapter(0), chapter(1)],
        }))
      : [
          { route_key: 'office', route_label: 'Home → Office', drive_count: 12, chapters: [chapter(0), chapter(1)] },
          {
            route_key: 'unknown', route_label: 'Unknown chapter', drive_count: 7,
            chapters: [{ ...chapter(1), firmware_version: null, fsd_distance_m: null, fsd_share_pct: null }],
          },
          { route_key: 'no-chapters', route_label: 'Empty chapters', drive_count: 1234, chapters: [] },
        ],
  };
  return insights;
}
