import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrderedStepList, Timeline } from '@/components/data-display';
import { BipolarBar, SmallMultiplesChart } from '@/components/charts';
import { Accordion, GlassPanel, SectionTitle, Text } from '@/components/ui';
import { useCompletionLabels } from '../components/shared-library-completion/useCompletionLabels';

const chartRows = [
  { timestamp: 1785574800000, primary: 0, secondary: -10 },
  { timestamp: 1785574860000, primary: 20, secondary: null },
  { timestamp: 1785574920000, primary: 40, secondary: 10 },
];
const series = ['primary', 'secondary'];

export function RemainingEvidenceReference() {
  const c = useCompletionLabels();
  const { t } = useTranslation();
  const [actions, setActions] = useState(0);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GlassPanel data-shared-contract="ordered-step-list">
        <SectionTitle>{c.orderedTitle}</SectionTitle>
        <OrderedStepList aria-label={c.orderedName} steps={[
          { id: 'prepare', title: c.orderedFirst, description: c.note },
          { id: 'review', title: c.orderedSecond, description: c.eventSubtitle },
        ]} />
        <OrderedStepList aria-label={c.orderedName + ' · ' + c.currentState} steps={[
          { id: 'complete', title: c.orderedFirst, state: { kind: 'completed', label: c.completedState } },
          { id: 'current', title: c.orderedSecond, state: { kind: 'current', label: c.currentState },
            action: { label: c.recordAction, onClick: () => setActions(value => value + 1) } },
          { id: 'disabled', title: c.orderedSecond,
            action: { label: c.bulkDisabled, disabled: true, onClick: () => setActions(value => value + 1) } },
        ]} />
        <Text role="status">{t('developerReference.sharedCompletion.actionCount', '{{count}} fixture actions recorded', { count: actions })}</Text>
      </GlassPanel>
      <GlassPanel data-shared-contract="accordion">
        <SectionTitle>{c.accordionTitle}</SectionTitle>
        <Accordion title={c.orderedFirst} description={<Text as="span" variant="bodySm">{c.note}</Text>}>
          <Text>{c.eventSubtitle}</Text>
        </Accordion>
        <Accordion title={c.orderedSecond} description={c.eventSubtitle} defaultOpen>
          <Text>{c.note}</Text>
        </Accordion>
      </GlassPanel>
      <GlassPanel data-shared-contract="timeline-summary">
        <SectionTitle>{c.chronologyTitle}</SectionTitle>
        <Timeline label={c.chronologyLabel} chronology="oldest-first" items={[
          { title: c.eventFirst, subtitle: c.eventSubtitle, time: c.eventTimeFirst },
          { title: c.eventSecond, subtitle: c.eventMetadata, time: c.eventTimeSecond },
        ]} />
        <Timeline label={c.eventInvalid} summaryBounds={{ start: c.eventTimeFirst, end: c.eventTimeSecond }} items={[
          { title: c.eventSecond, time: c.eventTimeUnknown },
          { title: c.eventFirst, time: c.eventTimeFirst },
        ]} />
      </GlassPanel>
      <GlassPanel data-shared-contract="small-multiples-chart">
        <SectionTitle>{c.containmentTitle}</SectionTitle>
        <div data-narrow-multiples className="w-full max-w-56">
          <SmallMultiplesChart data={chartRows} series={series} cellMinWidth={280}
            seriesLabel={key => key === 'primary' ? c.primarySeries : c.secondarySeries} />
        </div>
      </GlassPanel>
      <GlassPanel data-shared-contract="bipolar-bar">
        <SectionTitle>{c.bipolarTitle}</SectionTitle>
        <div className="flex min-w-0 flex-col gap-4">
          <BipolarBar label={c.unknownLabel} value={null} min={40} max={100} />
          <BipolarBar label={c.zeroLabel} value={0} min={40} max={100} />
          <BipolarBar label={c.signedLabel} value={-30} min={40} max={100}
            negativeLabel={c.rankNegative} positiveLabel={c.rankPositive} />
          <BipolarBar label={c.signedLabel + ' · ' + c.rankPositive} value={75} min={40} max={100} />
        </div>
      </GlassPanel>
    </div>
  );
}
