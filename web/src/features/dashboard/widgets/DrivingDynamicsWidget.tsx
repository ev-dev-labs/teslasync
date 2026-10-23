import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/feedback";
import { useDrivingDynamics } from "@/api/hooks/useDriving";
import { useVehicles } from "@/api/hooks/useVehicles";

import { WidgetShell } from "./WidgetShell";
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

  const trust = deriveDataState(
    {
      data:
        dynamics ?? (dynLoading || dynIsError || dynError ? undefined : null),
      error: dynError,
      isLoading: dynLoading,
      isFetching: dynFetching,
      isStale: dynStale,
      isError: dynIsError,
      dataUpdatedAt: dynUpdatedAt,
      refetch: dynRefetch,
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
      : t(
          `widget.drivingDynamics.severity.${style}`,
          {
            smooth: "Smooth",
            normal: "Normal",
            sporty: "Sporty",
            aggressive: "Aggressive",
          }[style],
        );

  const peakStats: StatGridItem[] = [
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
  ].map((stat) => ({
    ...stat,
    value:
      typeof stat.value === "number" && Number.isFinite(stat.value)
        ? fmtNumber(stat.value, 2)
        : null,
  }));

  return (
    <WidgetShell
      title={t("widget.drivingDynamics.title", "Driving dynamics")}
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={dynLoading && !dynamics}
      dataState={trust}
      updatedAt={dynUpdatedAt}
      isFetching={dynFetching}
      isStale={dynStale}
      isError={dynIsError}
      onRefresh={() => {
        void dynRefetch();
      }}
    >
      {dynamics ? (
        <div className="min-h-full min-w-0 flex flex-col gap-4">
          {styleText != null ? (
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
          )}
          {!isCompact && <WidgetStatGrid stats={peakStats} cols={3} />}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-5 w-5" />}
          message={t("widget.drivingDynamics.noData", "No dynamics data")}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
