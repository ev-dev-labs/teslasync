import BatteryGaugeLayout from '../../families/BatteryGaugeLayout';
import { BatteryCharging } from 'lucide-react';
import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function IconicBatteryGauge({ status, headline, pack, meter, details }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v5" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <BatteryCharging className="h-8 w-8 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
        <div className="min-w-0">{headline}</div>
        <div className="ml-auto">{pack}</div>
      </div>
      <div className="rounded-shape-md border border-[var(--border-subtle)] p-3">{meter}</div>
      <BatteryGaugeLayout status={status} details={details} className="flex min-w-0 flex-col gap-2" />
    </div>
  );
}
