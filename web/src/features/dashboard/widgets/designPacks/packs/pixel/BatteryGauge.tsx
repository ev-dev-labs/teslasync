import BatteryGaugeLayout from '../../families/BatteryGaugeLayout';
import { SegmentedMeter } from '@/components/data-display';
import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function PixelBatteryGauge({ status, headline, pack, meter, details, level }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v7" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3 font-mono">{headline}{pack}</div>
      <SegmentedMeter value={level} />
      {meter}
      <BatteryGaugeLayout status={status} details={details} className="border-t border-[var(--border-subtle)] pt-2 font-mono" />
    </div>
  );
}
