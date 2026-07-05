import { CHART_COLORS } from '@/components/charts';
import { STATUS_COLORS } from '@/lib/colors';

/**
 * Weekday labels in ISO / Monday-first order. Each label's index is a contract
 * shared with `dayOfWeekIndex()` in `./helpers` (Mon = 0 … Sun = 6): the digest
 * bins daily distance/energy via `DAY_LABELS[dayOfWeekIndex(date)]`, so this
 * ordering must not be reshuffled without updating that helper.
 */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
// Freeze the shared module-level singleton so a consumer can't mutate it.
Object.freeze(DAY_LABELS);

/**
 * Reference intercity distances (km) backing the "you drove far enough to reach
 * X from Y" fun fact. `findCityPair()` selects the pair whose distance is
 * nearest the week's total, so the list only needs breadth, not ordering.
 */
export const CITY_PAIRS = [
  { from: 'New York', to: 'Boston', km: 350 },
  { from: 'LA', to: 'San Francisco', km: 615 },
  { from: 'London', to: 'Paris', km: 460 },
  { from: 'Berlin', to: 'Munich', km: 585 },
  { from: 'Sydney', to: 'Melbourne', km: 880 },
  { from: 'Tokyo', to: 'Osaka', km: 515 },
] as const;
Object.freeze(CITY_PAIRS);

/**
 * Alert-severity → pie-slice colour. Consumers index this by a raw severity
 * string and fall back to a neutral palette colour for unknown severities
 * (`ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4]`), hence the intentionally
 * open `Record` type.
 */
export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};
Object.freeze(ALERT_SEVERITY_COLORS);

/**
 * Kilograms of CO₂ avoided per kWh of EV energy versus an equivalent petrol
 * car. Multiplied by the week's energy use to estimate emissions saved.
 */
export const CO2_PER_KWH_GASOLINE_KG = 0.21;
