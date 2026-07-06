/**
 * Metric semantics — single source of truth for "is going up good or bad?"
 * across every Delta indicator in the app.
 *
 * See `web/src/components/data-display/Delta.tsx`.
 */

/**
 * Direction-is-good for a given metric. Drives the `<Delta>` colour:
 *   - `higher_better` — greater current vs previous renders green.
 *   - `lower_better`  — greater current vs previous renders red.
 *   - `neutral`       — never coloured good/bad; rendered in muted text.
 */
export type Direction = 'higher_better' | 'lower_better' | 'neutral';

/**
 * Unit hint used by `<Delta>` to pick the right suffix/prefix.
 * The component pairs each value with `useSettings()`/`useUnits()` for
 * locale-aware label resolution (e.g. `mi` becomes `km` for metric users).
 */
export type MetricUnit =
  | 'currency'
  | 'percent'
  | 'mi'
  | 'km'
  | 'kwh'
  | 'wh'
  | 'wh_per_mi'
  | 'h'
  | 'min'
  | 'count'
  | 'mph'
  | 'kph'
  | 'c'
  | 'f'
  | 'bar';

export interface MetricSemantic {
  id: string;
  direction: Direction;
  unit?: MetricUnit;
}

/**
 * Registry of common metrics. Extend as widgets adopt `<Delta>`.
 *
 * Naming: snake_case for parity with backend JSON tags. Unknown ids are
 * tolerated by `<Delta>` — pass an inline `{direction, unit}` object instead.
 */
export const METRIC_SEMANTICS = {
  cost:                { id: 'cost',                direction: 'lower_better',  unit: 'currency'   },
  cost_per_mi:         { id: 'cost_per_mi',         direction: 'lower_better',  unit: 'currency'   },
  energy_consumed:     { id: 'energy_consumed',     direction: 'lower_better',  unit: 'kwh'        },
  energy_per_mi:       { id: 'energy_per_mi',       direction: 'lower_better',  unit: 'wh_per_mi'  },
  range:               { id: 'range',               direction: 'higher_better', unit: 'mi'         },
  // `efficiency` is conventionally read as "Wh/mi or Wh/km" where smaller is
  // better. Pages that present efficiency as mi/kWh (higher better) should
  // pass an inline semantic instead of using this id.
  efficiency:          { id: 'efficiency',          direction: 'lower_better',  unit: 'wh_per_mi'  },
  regen_pct:           { id: 'regen_pct',           direction: 'higher_better', unit: 'percent'    },
  drive_score:         { id: 'drive_score',         direction: 'higher_better', unit: 'count'      },
  vampire_drain:       { id: 'vampire_drain',       direction: 'lower_better',  unit: 'kwh'        },
  idle_time:           { id: 'idle_time',           direction: 'lower_better',  unit: 'h'          },
  distance:            { id: 'distance',            direction: 'neutral',       unit: 'mi'         },
  trip_count:          { id: 'trip_count',          direction: 'neutral',       unit: 'count'      },
  charging_sessions:   { id: 'charging_sessions',   direction: 'neutral',       unit: 'count'      },
  battery_health_pct:  { id: 'battery_health_pct',  direction: 'higher_better', unit: 'percent'    },
  speed_avg:           { id: 'speed_avg',           direction: 'neutral',       unit: 'mph'        },
  temperature:         { id: 'temperature',         direction: 'neutral',       unit: 'c'          },
  pressure:            { id: 'pressure',            direction: 'neutral',       unit: 'bar'        },
} as const satisfies Record<string, MetricSemantic>;

export type MetricId = keyof typeof METRIC_SEMANTICS;

/**
 * Resolve a metric input (id or inline object) to a `MetricSemantic`.
 * Falls back to `{ direction: 'neutral' }` for unknown ids — and for a
 * nullish input — so the UI never crashes on a typo or on loosely-typed
 * data that slips past the compiler.
 */
export function resolveSemantic(
  metric:
    | MetricId
    | MetricSemantic
    | { direction: Direction; unit?: MetricUnit }
    | null
    | undefined,
): MetricSemantic {
  // Defensive: `null`/`undefined` can reach us from loosely-typed callers.
  // Guard before the `in` check below, which throws on a nullish operand.
  if (metric == null) return { id: 'unknown', direction: 'neutral' };
  if (typeof metric === 'string') {
    const found = METRIC_SEMANTICS[metric];
    if (found) return found;
    return { id: metric, direction: 'neutral' };
  }
  if ('id' in metric && typeof metric.id === 'string') return metric as MetricSemantic;
  return { id: 'inline', direction: metric.direction, unit: metric.unit };
}
