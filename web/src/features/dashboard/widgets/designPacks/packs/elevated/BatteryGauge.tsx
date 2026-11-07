import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function ElevatedBatteryGauge({ status, headline, pack, meter, details }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v2" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">{status}<div className="rounded-shape-md bg-[var(--surface-2)] px-4 py-3">{headline}</div></div>
        <div className="self-center">{pack}</div>
      </div>
      <div className="rounded-shape-md border border-[var(--border-subtle)] p-3">{meter}{details}</div>
    </div>
  );
}
