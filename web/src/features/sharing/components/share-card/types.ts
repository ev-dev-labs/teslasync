import type { ShareCardAnalysis, ShareCardLine, ShareCardTheme } from '../../lib/shareCard';

export interface ShareCardQueryState {
  enabled: boolean;
  hasData: boolean;
  isInitialLoading: boolean;
  isInitialPaused: boolean;
  initialError: unknown;
  isResolved: boolean;
  isRefreshing: boolean;
  cachedRefreshError: unknown;
  cachedRefreshPaused: boolean;
  onRetry: () => void;
}

export interface ShareCardDisplay {
  distanceUnit: 'km' | 'mi' | 'ft';
  durationUnit: 's' | 'min' | 'h' | 'd';
  energyUnit: 'Wh' | 'kWh';
  formatNumber: (value: number | null | undefined, precision?: number) => string;
  formatDistance: (
    meters: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatDuration: (
    seconds: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatEnergy: (
    wattHours: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatSpeed: (
    metersPerSecond: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatTemperature: (
    celsius: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatEfficiency: (whPerKm: number | null | undefined) => string;
  formatPercent: (value: number | null | undefined, precision?: number) => string;
  formatMonth: (month: string) => string;
  distanceValue: (meters: number) => number;
  durationValue: (seconds: number) => number;
  energyValue: (wattHours: number) => number;
}

export interface ShareCardSectionProps {
  analysis: ShareCardAnalysis;
  state: ShareCardQueryState;
  display: ShareCardDisplay;
}

export interface ShareCardCompositionProps extends ShareCardSectionProps {
  theme: ShareCardTheme;
  title: string;
  subtitle: string;
  disclosure: string;
  footer: string;
  lines: readonly ShareCardLine[];
  svg: string | null;
  onThemeChange: (theme: ShareCardTheme) => void;
  onDownload: () => void;
}
