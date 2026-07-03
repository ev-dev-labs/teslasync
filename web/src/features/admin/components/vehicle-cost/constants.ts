/**
 * Static configuration for the Vehicle Ingest Cost page.
 *
 * Kept out of the page/orchestrator so the trailing-window presets and the
 * top-N cap are declared once and shared by the toolbar, chart, and
 * top-talkers list.
 */

export interface WindowOption {
  /** Trailing window length in days — fed to `useVehicleCost(since)`. */
  days: number;
  /** i18n key for the option label. */
  labelKey: string;
  /** English fallback rendered when the key is missing. */
  fallback: string;
}

/** Trailing-window presets offered by the toolbar's window `<Select>`. */
export const WINDOW_OPTIONS: ReadonlyArray<WindowOption> = [
  { days: 1, labelKey: 'admin.vehicleCost.window1d', fallback: 'Last 1 day' },
  { days: 7, labelKey: 'admin.vehicleCost.window7d', fallback: 'Last 7 days' },
  { days: 30, labelKey: 'admin.vehicleCost.window30d', fallback: 'Last 30 days' },
  { days: 90, labelKey: 'admin.vehicleCost.window90d', fallback: 'Last 90 days' },
];

/**
 * How many vehicles to surface in the cost chart + top-talkers list. The
 * full breakdown is always available in the table below; the visual sections
 * intentionally focus on the heaviest consumers so the outlier is obvious.
 */
export const TOP_N = 8;
