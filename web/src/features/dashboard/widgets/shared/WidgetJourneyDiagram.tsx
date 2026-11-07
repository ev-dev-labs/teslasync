import { useTranslation } from 'react-i18next';
import { Flag, MapPin } from 'lucide-react';
import { Caption } from '@/components/ui';
import { WidgetFlowDiagram } from './WidgetFlowDiagram';

interface WidgetJourneyDiagramProps {
  start: string | null;
  end: string | null;
}

export function WidgetJourneyDiagram({ start, end }: WidgetJourneyDiagramProps) {
  const { t } = useTranslation();
  const description = t('dashboardWidgets.maps.journey.schematic',
    'Schematic connection, not recorded route geometry.');
  return (
    <div className="min-w-0 space-y-1">
      <div className="h-28 min-w-0" data-motion-suppressed="true">
        <WidgetFlowDiagram
          nodes={[
            { id: 'start', label: t('dashboardWidgets.maps.journey.start', 'Start'),
              value: null, formattedValue: start ?? '—', icon: <MapPin />, position: 'left' },
            { id: 'end', label: t('dashboardWidgets.maps.journey.end', 'End'),
              value: null, formattedValue: end ?? '—', icon: <Flag />, position: 'right' },
          ]}
          arrows={start && end ? [{ from: 'start', to: 'end', value: null, active: false }] : []}
          ariaLabel={`${start ?? '—'} → ${end ?? '—'}. ${description}`}
        />
      </div>
      <Caption as="p">{description}</Caption>
    </div>
  );
}
