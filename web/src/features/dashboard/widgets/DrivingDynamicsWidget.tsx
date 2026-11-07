import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/feedback";
import { MetricBar } from "@/components/data-display";
import { Caption } from "@/components/ui";
import { useDrivingDynamics, useAccelerationDistribution } from "@/api/hooks/useDriving";
import { useVehicles } from "@/api/hooks/useVehicles";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, EmbeddedChart, ChartTooltip, axisTickSm, chartGrid, useThemeChartPalette, useMeasuredAxisWidth } from "@/components/charts";
import { SourceContent } from "@/components/layout";
import { safeArray } from "@/lib/safeArray";
import { sourceBoundaryState } from "../components/continuation-dashboard-1/sourceBoundary";

import { WidgetShell } from "./WidgetShell";
import InstrumentPresentation from "./designPacks/InstrumentPresentation";
import { usePackPresentation } from "./designPacks/PackBoundary";
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from "./shared";
import { deriveDataState, knownNumber } from "@/api/dataState";
import type { WidgetProps } from "./types";
import { useNumberFormatting } from "@/hooks/useNumberFormatting";

export default function DrivingDynamicsWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation("dashboard");
  const packId = usePackPresentation();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: dynamics,
    isLoading: dynLoading,
    error: dynError,
    isFetching: dynFetching,
    isStale: dynStale,
    isError: dynIsError,
    dataUpdatedAt: dynUpdatedAt,
    refetch: dynRefetch,
  } = useDrivingDynamics(vehicleIdStr);
  const isWide = size.cols >= 3;
  const distribution = useAccelerationDistribution(isWide ? vehicleIdStr : undefined);
  const distributionTrust = deriveDataState(distribution, { provenance: "historical" });
  const palette = useThemeChartPalette();
  const histogram = useMemo(() => {
    const values = safeArray(distribution.data?.values)
      .map(knownNumber)
      .filter((value): value is number => value != null);
    if (values.length === 0) return [];
    const bins = Array.from({ length: 12 }, (_, index) => ({
      range: index === 11
        ? `${fmtNumber(1.1, 1)}+`
        : `${fmtNumber(index / 10, 1)}-${fmtNumber((index + 1) / 10, 1)}`,
      count: 0,
    }));
    // The API returns signed G readings, not pre-binned observation counts.
    for (const value of values) bins[Math.min(11, Math.floor(Math.abs(value) * 10))].count += 1;
    return bins;
  }, [distribution.data, fmtNumber]);
  const countLabels = useMemo(
    () => [0, ...histogram.map(bin => bin.count)].map(value => fmtNumber(value, 0)),
    [histogram, fmtNumber],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: countLabels, fontSize: 10, minWidth: 40, padding: 20, enabled: isWide,
  });
  const timestamps = [dynUpdatedAt, isWide ? distribution.dataUpdatedAt : 0]
    .filter(value => value > 0);
  const updatedAt = timestamps.length ? Math.min(...timestamps) : 0;
  const refresh = () => {
    void dynRefetch();
    if (isWide) void distribution.refetch();
  };

  const trust = deriveDataState(
    {
      data:
        dynamics ?? (isWide ? distribution.data : undefined)
          ?? (dynLoading || dynIsError || dynError ? undefined : null),
      error: dynError,
      isLoading: dynLoading,
      isFetching: dynFetching,
      isStale: dynStale,
      isError: dynIsError,
      dataUpdatedAt: updatedAt,
      refetch: refresh,
    },
    { provenance: "historical" },
  );
  const isCompact = size.cols <= 1;

  const smoothness = knownNumber(dynamics?.smoothnessScore);
  const acceleration = knownNumber(dynamics?.avgAccelerationG);
  const braking = knownNumber(dynamics?.avgBrakingG);
  let style: "smooth" | "normal" | "sporty" | "aggressive" | null = null;
  if (smoothness != null) {
    if (smoothness >= 80) style = "smooth";
    else if (smoothness >= 60) style = "normal";
    else if (smoothness >= 40) style = "sporty";
    else style = "aggressive";
  } else if (acceleration != null && braking != null) {
    const mean = (acceleration + braking) / 2;
    if (mean < 0.15) style = "smooth";
    else if (mean < 0.3) style = "normal";
    else if (mean < 0.5) style = "sporty";
    else style = "aggressive";
  }

  const styleText =
    style == null
      ? null
      : style === 'smooth'
        ? t('widget.drivingDynamics.severity.smooth', 'Smooth')
        : style === 'normal'
          ? t('widget.drivingDynamics.severity.normal', 'Normal')
          : style === 'sporty'
            ? t('widget.drivingDynamics.severity.sporty', 'Sporty')
            : t('widget.drivingDynamics.severity.aggressive', 'Aggressive');

  const peakReadings = [
    {
      label: t("widget.drivingDynamics.accel", "Accel"),
      value: knownNumber(dynamics?.maxAccelerationG),
      unit: "g",
      sublabel: undefined,
    },
    {
      label: t("widget.drivingDynamics.brake", "Brake"),
      value: knownNumber(dynamics?.maxBrakingG),
      unit: "g",
      sublabel: undefined,
    },
    {
      label: t("widget.drivingDynamics.lateral", "Lateral"),
      value: knownNumber(dynamics?.maxCorneringG),
      unit: "g",
      sublabel: undefined,
    },
  ];
  const peakStats: StatGridItem[] = peakReadings.map((stat) => ({
    ...stat,
    value:
      typeof stat.value === "number" && Number.isFinite(stat.value)
        ? fmtNumber(stat.value, 2)
        : null,
  }));
  const peakScale = Math.max(1, ...peakReadings.map(stat => Math.abs(stat.value ?? 0)));
  const headline = styleText != null ? (
    <WidgetBigNumber
      value={styleText}
      label={t("widget.drivingDynamics.style", "Style")}
      size={isCompact ? "secondary" : "primary"}
      animated={false}
    />
  ) : (
    <WidgetBigNumber
      value={null}
      label={t("widget.drivingDynamics.style", "Style")}
      animated={false}
    />
  );
  const empty = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Gauge className="h-5 w-5" />}
      message={t("widget.drivingDynamics.noData", "No dynamics data")}
      className="py-4"
    />
  );
  const distributionSection = isWide && (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceContent
        state={sourceBoundaryState(distributionTrust, histogram.length > 0)}
        label={t("widget.drivingDynamics.distribution", "G-force distribution")}
        emptyMessage={t("widget.drivingDynamics.distributionEmpty", "No acceleration samples yet")}
        errorMessage={t("widget.drivingDynamics.distributionError", "Acceleration distribution unavailable")}
        error={distributionTrust.fatalError}
        errorRecovery={{ onRetry: () => { void distribution.refetch(); } }}
        emptyRecovery={{ action: { label: t("common.refresh", "Refresh"), onClick: () => { void distribution.refetch(); } } }}
      >
        <EmbeddedChart
          title={t("widget.drivingDynamics.distribution", "G-force distribution")}
          ariaLabel={t("widget.drivingDynamics.distributionAria", "Distribution of observed acceleration magnitudes")}
          data={histogram}
          dataColumns={[
            { key: "range", label: t("widget.drivingDynamics.gForce", "G-force") },
            { key: "count", label: t("widget.drivingDynamics.samples", "Samples") },
          ]}
          fluid={packId === "classic"}
          className="h-full min-h-0"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis width={axisWidth} allowDecimals={false} tick={axisTickSm} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t("widget.drivingDynamics.samples", "Samples")} fill={palette.primary} />
            </BarChart>
          </ResponsiveContainer>
        </EmbeddedChart>
      </SourceContent>
    </div>
  );

  return (
    <WidgetShell
      title={t("widget.drivingDynamics.title", "Driving dynamics")}
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={dynLoading && !dynamics && !(isWide && distribution.data)}
      dataState={trust}
      updatedAt={updatedAt}
      isFetching={dynFetching || (isWide && distribution.isFetching)}
      isStale={dynStale || (isWide && distribution.isStale)}
      isError={dynIsError || (isWide && distribution.isError)}
      onRefresh={refresh}
    >
      <InstrumentPresentation
        family="bars"
        compact={isCompact}
        icon={<Gauge />}
        headline={headline}
        context={
          <div className="min-w-0 space-y-2">
            <Caption as="p">
              {t("dashboardWidgets.driving.drivingDynamics.peakContext", "Estimated peaks · all completed drives")}
            </Caption>
            {!dynamics && empty}
          </div>
        }
        instrument={!isCompact ? (
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {peakReadings.map(stat => (
              <MetricBar
                key={stat.label}
                label={stat.label}
                value={stat.value}
                max={peakScale}
                color={palette.primary}
                sublabel={stat.value == null ? "—" : `${fmtNumber(stat.value, 2)} g`}
                size={packId === "v3" ? "slim" : "default"}
                fill={packId === "v7" ? "segmented" : "solid"}
              />
            ))}
            <Caption as="p">
              {t("dashboardWidgets.driving.drivingDynamics.peakScale", "Peak comparison scale: 0–{{max}} g", { max: fmtNumber(peakScale, 2) })}
            </Caption>
            {isWide && (
              <Caption as="p">
                {t("dashboardWidgets.driving.drivingDynamics.distributionPeriod", "Observed acceleration magnitudes · last 30 days")}
              </Caption>
            )}
            {distributionSection}
          </div>
        ) : undefined}
        details={!isCompact ? <WidgetStatGrid stats={peakStats} cols={3} /> : undefined}
      >
      {dynamics || isWide ? (
        <div className={isWide
          ? "flex h-full min-h-0 min-w-0 flex-col gap-2"
          : "flex min-h-full min-w-0 flex-col gap-4"}>
          <div className="shrink-0">
            {headline}
          </div>
          {!isCompact && <div className="shrink-0"><WidgetStatGrid stats={peakStats} cols={3} /></div>}
          {distributionSection}
        </div>
      ) : empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
