import { useTranslation } from 'react-i18next';
import { MetricBar } from '@/components/data-display';
import { MetricValue } from '@/components/ui';
import InstrumentLayout from '@/features/dashboard/widgets/designPacks/families/InstrumentLayout';
import { PACK_APPEARANCES, type PackId } from '@/features/dashboard/widgets/designPacks/types';

export default function WidgetDesignPackThumbnail({ packId }: { packId: PackId }) {
  const { t } = useTranslation('settings');
  const label = t('theme.widgetDesignPacks.sampleBattery', 'Sample battery level');
  const headline = <MetricValue>72%</MetricValue>;
  return <div aria-hidden="true" data-widget-pack={packId} className="@container pointer-events-none flex h-48 min-w-0 shrink-0 items-center rounded-shape-md bg-[var(--surface-1)] p-3">
    <div className="w-full min-w-0">
      {packId === 'classic'
        ? <div className="space-y-3">{headline}<MetricBar value={72} max={100} color="var(--theme-primary)" ariaLabel={label} showHeader={false} /></div>
        : <InstrumentLayout appearance={PACK_APPEARANCES[packId]} family="ring" compact
            headline={headline} reading={{ value: 72, max: 100, label }} />}
    </div>
  </div>;
}
