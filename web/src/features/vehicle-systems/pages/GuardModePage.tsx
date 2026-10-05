import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { PageLayout, CardGrid, type CardGridItem } from '@/components/layout/layout-reference';
import { Text, ConfirmDialog } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useGuardPageModel, GuardOverview, GuardLiveMap, GuardControls,
  GuardSettings, GuardStatus, GuardEvents, eventLabelKey,
} from '../components/guard-modernization';

/** Workspace scope stays in the application header. Each independent source
 * owns recovery inside its persistent section, not a page-wide data gate. */
export default function GuardModePage() {
  const { t } = useTranslation();
  usePageTitle(t('guard.title', 'Guard mode'));
  const model = useGuardPageModel();
  const items: CardGridItem[] = [
    { id: 'guard-live-map', size: 'half', content: <GuardLiveMap model={model} /> },
    { id: 'guard-controls', size: 'half', content: <GuardControls model={model} /> },
    { id: 'guard-settings', size: 'half', content: <GuardSettings model={model} /> },
    { id: 'guard-status', size: 'half', content: <GuardStatus model={model} /> },
    { id: 'guard-events', size: 'full', content: <GuardEvents model={model} /> },
  ];
  const latestLabel = model.latestEvent ? eventLabelKey(model.latestEvent.event_type) : null;
  return (
    <PageLayout title={t('guard.title', 'Guard mode')}
      subtitle={t('guard.subtitle', 'Anti-theft monitoring and emergency response')}
      query={[model.configQuery, model.eventsQuery, model.vehicleStateQuery, model.geofencesQuery]}>
      {model.isTriggered && model.latestEvent && latestLabel && (
        <AlertBanner variant="danger" title={t('guard.alertTriggered', 'Guard alert triggered!')}
          icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}>
          <Text as="p" variant="bodySm">
            {t(latestLabel[0], latestLabel[1])} {'— '}<TimeStamp value={model.latestEvent.ts} />
          </Text>
          <Text as="p" variant="bodySm">
            {t('guard.modernization.eventsCoverage', 'Counts cover the returned security event history, not a theft detection assessment.')}
          </Text>
        </AlertBanner>
      )}
      <FadeIn><GuardOverview model={model} /></FadeIn>
      <FadeIn delay={0.05}>
        <CardGrid items={items} label={t('guard.modernization.panels', 'Guard location, controls, settings, status, and event history')} />
      </FadeIn>
      <ConfirmDialog open={model.panicDialogOpen}
        title={t('guard.panicConfirmTitle', 'Activate panic mode?')}
        message={t('guard.modernization.panicEffects', 'This requests Sentry mode on, then horn honking, then light flashing. It does not lock doors, send notifications, or create a guard event. Commands can fail or complete only partially.')}
        confirmLabel={t('guard.panicConfirmLabel', 'Activate panic')}
        cancelLabel={t('common.cancel', 'Cancel')} variant="danger"
        loading={model.panic.isPending} onConfirm={model.handlePanic}
        onCancel={() => model.setPanicDialogOpen(false)} />
    </PageLayout>
  );
}
