import { CHART_COLORS } from '@/components/charts';
import { STATUS_COLORS } from '@/lib/colors';

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const CITY_PAIRS = [
  { from: 'New York', to: 'Boston', km: 350 },
  { from: 'LA', to: 'San Francisco', km: 615 },
  { from: 'London', to: 'Paris', km: 460 },
  { from: 'Berlin', to: 'Munich', km: 585 },
  { from: 'Sydney', to: 'Melbourne', km: 880 },
  { from: 'Tokyo', to: 'Osaka', km: 515 },
] as const;

export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};

export const CO2_PER_KWH_GASOLINE_KG = 0.21;
