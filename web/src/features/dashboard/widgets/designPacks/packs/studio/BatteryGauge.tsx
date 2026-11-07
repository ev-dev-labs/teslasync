import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function StudioBatteryGauge({ status, headline, pack, meter, details, level }: BatteryGaugePresentationProps) {
  return (
    <div data-battery-gauge-pack="v1" className="flex min-w-0 flex-col gap-3">
      {status}
      <div className="grid min-w-0 items-center gap-3 @md:grid-cols-2">
        <div className="relative flex min-h-28 items-center justify-center rounded-full border-[6px] border-[var(--border-subtle)]">
          {level != null && <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--theme-primary)" strokeWidth="5" strokeDasharray={`${Math.max(0, Math.min(100, level)) * 2.76} 276`} />
          </svg>}
          <div className="relative min-w-0 text-center">{headline}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">{pack}{meter}</div>
      </div>
      {details}
    </div>
  );
}
