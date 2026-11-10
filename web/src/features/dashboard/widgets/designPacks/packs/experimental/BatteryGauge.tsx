import { useTranslation } from 'react-i18next';
import { usePackPresentation } from '../../PackBoundary';
import { EXPERIMENTAL_LAYOUTS, isExperimentalAppearance } from '../../experimentalLayouts';
import InstrumentLayout from '../../families/InstrumentLayout';
import type { BatteryGaugePresentationProps } from '../../viewModels/BatteryGaugeViewModel';

export default function ExperimentalBatteryGauge({ status, headline, pack, meter, details, level }: BatteryGaugePresentationProps) {
  const packId = usePackPresentation();
  const { t } = useTranslation();
  if (!isExperimentalAppearance(packId)) return null;
  const layout = EXPERIMENTAL_LAYOUTS[packId];
  return <div data-battery-gauge-pack={packId} className="flex min-w-0 flex-col gap-3">
    <InstrumentLayout appearance={packId} family="ring" headline={headline}
      context={status} reading={{ value: level, max: 100, label: t('widget.batteryLevel', 'Battery level') }}
      instrument={<div className={layout.body}>
        <div key="pack" className="min-w-0">{pack}</div>
        <div key="meter" className="min-w-0">{meter}</div>
      </div>}
      details={details} />
  </div>;
}
