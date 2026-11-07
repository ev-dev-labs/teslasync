import BatteryGaugeLayout from '../../families/BatteryGaugeLayout';
import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function PrecisionBatteryGauge({ status, headline, pack, meter, details }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v3" className="flex min-w-0 flex-col gap-4 py-2">
      <div className="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-3">{headline}{pack}</div>
      <div className="min-w-0">{meter}</div>
      <BatteryGaugeLayout status={status} details={details} className="flex min-w-0 flex-col gap-2 text-[var(--text-secondary)]" />
    </div>
  );
}
