export { LinearGauge } from './LinearGauge';
export { BipolarBar, type BipolarBarProps } from './BipolarBar';
export { ThresholdBar, type ThresholdBarProps, type ThresholdBand } from './ThresholdBar';
export {
  temperatureGaugeRange,
  ambientTemperatureGaugeRange,
  AMBIENT_TEMP_MIN_C,
  AMBIENT_TEMP_MAX_C,
  type TemperatureGaugeRange,
} from './temperatureGaugeRange';
export { MiniChart } from './MiniChart';
export { SmallMultiplesChart, type SmallMultiplesChartProps } from './SmallMultiplesChart';
export { ChartContainer } from './ChartContainer';
export { ChartExportMenu, type ChartExportMenuProps } from './ChartExportMenu';
export { AreaChartWrapper } from './AreaChartWrapper';
export { Sparkline } from './Sparkline';
export { ChartTooltip, ChartTooltipBase, type ChartTooltipProps } from './ChartTooltip';
export { ChartGradient, ChartGradientBase, type ChartGradientProps } from './ChartGradient';
export { chartGrid, axisTick, axisTickSm, chartMargin, chartMarginLabeled, chartAnimation, safe, fmt, CHART_COLORS, NEON_COLORS } from './chartUtils';
export { useThemeChartPalette, buildChartPalette, type ChartPalette } from '../../lib/colors';
export { ElevationProfile, type ElevationDataPoint } from './ElevationProfile';
export { renderAnnotationLines } from './ChartAnnotationLayer';
export { AddAnnotationPopover } from './AddAnnotationPopover';
export { AnnotationList } from './AnnotationList';
export { AREA_DEFAULTS, areaGradient } from './chartDefaults';
export { TimeMarker, type TimeMarkerProps } from './TimeMarker';
// Shared brush, sync, legend, and tooltip primitives.
// Persistent cursor sync builds on recharts' syncId.
export {
  ChartTimeRangeProvider,
  useChartSync,
  useSyncedCursor,
  useSyncedReferenceLineX,
  type ChartSyncContextValue,
  type ChartTimeRangeProviderProps,
  type SyncedCursorProps,
} from './ChartTimeRangeContext';
export {
  setCursorSyncPosition,
  getCursorSyncPosition,
  clearCursorSync,
  useCursorSyncPosition,
  type CursorSyncValue,
} from './cursorSync';
export { ChartBrush, type ChartBrushProps } from './ChartBrush';
export { ChartLegend, type ChartLegendProps, type ChartLegendToggleSource } from './ChartLegend';
export {
  MetricSwitcherChart,
  type MetricSwitcherChartProps,
  type MetricSwitcherMetric,
} from './MetricSwitcherChart';
export { useChartLegendState, type ChartLegendState } from './useChartLegendState';
export {
  ChartHiddenSeriesContext,
  ChartHiddenSeriesProvider,
  useChartHiddenSeries,
} from './ChartHiddenSeriesContext';

// Re-export recharts through shared charts module
export { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Brush, ComposedChart, ScatterChart, Scatter, ReferenceLine, ReferenceArea, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ZAxis, Label } from 'recharts';