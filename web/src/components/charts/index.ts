export { RadialGauge } from './RadialGauge';
export { MiniChart } from './MiniChart';
export { ChartContainer } from './ChartContainer';
export { AreaChartWrapper } from './AreaChartWrapper';
export { Sparkline } from './Sparkline';
export { ChartTooltip, ChartTooltipBase, type ChartTooltipProps } from './ChartTooltip';
export { ChartGradient, ChartGradientBase } from './ChartGradient';
export { chartGrid, axisTick, axisTickSm, chartMargin, chartMarginLabeled, chartAnimation, safe, fmt, CHART_COLORS, NEON_COLORS } from './chartUtils';
export { useChartPalette, buildChartPalette, type ChartPalette } from '../../lib/colors';
export { ElevationProfile, type ElevationDataPoint } from './ElevationProfile';
export { renderAnnotationLines } from './ChartAnnotationLayer';
export { AddAnnotationPopover } from './AddAnnotationPopover';
export { AnnotationList } from './AnnotationList';
export { AREA_DEFAULTS, areaGradient } from './chartDefaults';
export { TimeMarker, type TimeMarkerProps } from './TimeMarker';
// Phase 40 / Prompt 26 — shared brush/sync/legend/tooltip primitives.
export {
  ChartTimeRangeProvider,
  useChartSync,
  useSyncedCursor,
  type ChartSyncContextValue,
  type ChartTimeRangeProviderProps,
} from './ChartTimeRangeContext';
export { ChartBrush, type ChartBrushProps } from './ChartBrush';
export { ChartLegend, type ChartLegendProps } from './ChartLegend';
export { useChartLegendState, type ChartLegendState } from './useChartLegendState';

// Re-export recharts through shared charts module
export { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Brush, ComposedChart, ScatterChart, Scatter, ReferenceLine, ReferenceArea, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ZAxis, Label } from 'recharts';