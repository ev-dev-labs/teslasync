import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function OwnerBatteryGauge({ status, headline, pack, meter, details }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v4" className="grid min-w-0 gap-3 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex min-w-0 flex-col justify-center gap-3 rounded-shape-md bg-[var(--surface-2)] p-3">{status}{headline}{pack}</div>
      <div className="flex min-w-0 flex-col justify-center gap-3">{meter}<div className="border-t border-[var(--border-subtle)] pt-2">{details}</div></div>
    </div>
  );
}
