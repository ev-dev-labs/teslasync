import type { BatteryGaugePresentationProps } from '../viewModels/BatteryGaugeViewModel';

export default function ClassicBatteryGauge({ status, headline, pack, meter, details, level }: BatteryGaugePresentationProps) {
  return (
    <>
      {status}
      <div className="flex min-w-0 flex-col gap-1.5">
        {level != null ? (
          <>
            <div className="flex min-w-0 items-center justify-between gap-3">{headline}{pack}</div>
            {meter}
            {details}
          </>
        ) : headline}
      </div>
    </>
  );
}
