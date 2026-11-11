import { useTranslation } from 'react-i18next';
import { Energy, KVList, MetricCard, Timeline } from '@/components/data-display';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

export default function PreviewOverview({ section }: { section: string }) {
  const { t } = useTranslation('settings');
  const { formatDistance } = useUnits();
  const summary = section === 'activity'
    ? t('theme.appDesignPreview.activitySummary', 'Five sample journeys are complete; one has an unavailable energy reading. Unknown is never shown as zero.')
    : section === 'review'
      ? t('theme.appDesignPreview.reviewSummary', 'Review the partial journey before comparing totals. These examples do not describe the health of your vehicle.')
      : t('theme.appDesignPreview.overviewSummary', 'A useful overview keeps totals, source quality and the next review step together.');
  return (
    <section data-preview-section="overview" className="min-w-0 space-y-4">
      <div data-app-part="metric-grid" className="grid min-w-0 gap-3 md:grid-cols-3">
        <MetricCard label={t('theme.appDesignPreview.sampleJourneys', 'Sample journeys')} value={6}
          kind="count" subtitle={t('theme.appDesignPreview.loadedOnly', 'Six local examples, not a fleet total')} wrapSubtitle />
        <MetricCard label={t('theme.appDesignPreview.sampleDistance', 'Sample distance')} value="—"
          subtitle={t('theme.appDesignPreview.partialTotal', 'Total withheld: one journey is partial')} wrapSubtitle />
        <MetricCard label={t('theme.appDesignPreview.sampleCoverage', 'Sample source coverage')} value="83%"
          subtitle={t('theme.appDesignPreview.coverageDetail', 'Five of six energy readings are available')} wrapSubtitle />
      </div>
      <GlassPanel className="min-w-0 space-y-4 p-4">
        <PanelTitle>{t('theme.appDesignPreview.brief', 'Journey brief')}</PanelTitle>
        <Text role="status">{summary}</Text>
        <KVList layout="responsive" items={[
          { id: 'harbor', label: t('theme.appDesignPreview.harbor', 'Harbor loop'),
            value: <span className="flex flex-wrap justify-end gap-3"><span>{formatDistance(18200)}</span><Energy wh={2900} />
              <Badge variant="success">{t('theme.appDesignPreview.complete', 'Complete')}</Badge></span> },
          { id: 'studio', label: t('theme.appDesignPreview.studio', 'Studio connection'),
            value: <span className="flex flex-wrap justify-end gap-3"><span>{formatDistance(8700)}</span>
              <Badge variant="warning">{t('theme.appDesignPreview.partial', 'Partial')}</Badge></span> },
        ]} />
        <Timeline label={t('theme.appDesignPreview.timeline', 'Sample activity timeline')} chronology="oldest-first" items={[
          { title: t('theme.appDesignPreview.departed', 'Sample journey started'), time: '09:00',
            subtitle: t('theme.appDesignPreview.departedDetail', 'Harbor loop began with 78% battery.') },
          { title: t('theme.appDesignPreview.gap', 'Sample observation gap'), time: '09:15',
            subtitle: t('theme.appDesignPreview.gapDetail', 'Missing observations remain a gap in the chart.') },
          { title: t('theme.appDesignPreview.arrived', 'Sample journey finished'), time: '09:30',
            subtitle: t('theme.appDesignPreview.arrivedDetail', 'Review the journey alongside its source quality.') },
        ]} />
      </GlassPanel>
    </section>
  );
}
