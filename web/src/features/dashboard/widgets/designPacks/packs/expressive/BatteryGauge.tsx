import BatteryGaugeLayout from '../../families/BatteryGaugeLayout';
import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function ExpressiveBatteryGauge({ status, headline, pack, meter, details }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v6" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-[1.75rem] bg-[var(--surface-2)] p-4">{headline}{pack}</div>
      <div className="rounded-[1.25rem] bg-[var(--surface-2)] p-4">{meter}</div>
      <BatteryGaugeLayout status={status} details={details} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-2" detailsFirst />
    </div>
  );
}
