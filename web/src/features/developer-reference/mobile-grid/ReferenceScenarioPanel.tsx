import { useTranslation } from 'react-i18next';
import { Button, GlassPanel, Heading, Text } from '@/components/ui';
import { MobileGridReference } from '@/components/ui/mobile-grid-reference';
import { ReferenceDesktopTable } from './ReferenceDesktopTable';
import { ReferenceRecordDialog } from './ReferenceRecordDialog';
import { useReferenceController } from './useReferenceController';
import type { ReferenceScenario } from './fixtures';

interface Props { scenario: ReferenceScenario }
export function ReferenceScenarioPanel({ scenario }: Props) {
  const { t } = useTranslation();
  const label = t(`developerReference.mobileGrid.scenarios.${scenario.labelKey}`, scenario.label);
  const fixture = useReferenceController(scenario, label);
  const row = fixture.detailKey != null ? fixture.presentation.display.get(fixture.detailKey) : undefined;
  const sourceRow = fixture.source.find(item => item.id === fixture.detailKey);
  return (
    <GlassPanel className="min-w-0 p-4">
      <Heading level="panel" className="mb-2">{label}</Heading>
      <Text as="p" className="mb-3 text-sm text-[var(--text-muted)]">
        {t('developerReference.mobileGrid.fixture.label', 'REFERENCE FIXTURES · local controller only · not live data')}
      </Text>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-11" onClick={fixture.runLoading}>
          {t('developerReference.mobileGrid.fixture.loading', 'Simulate 3-second loading')}
        </Button>
        <Button variant="secondary" className="min-h-11" onClick={() => { fixture.setLoading(false); fixture.setFailure(true); }}>
          {t('developerReference.mobileGrid.fixture.failure', 'Simulate request failure')}
        </Button>
        <Button variant="secondary" className="min-h-11" onClick={() => { fixture.setLoading(false); fixture.setFailure(false); }}>
          {t('developerReference.mobileGrid.fixture.ready', 'Show ready state')}
        </Button>
      </div>
      <MobileGridReference model={fixture.model} callbacks={fixture.callbacks}
        desktop={<ReferenceDesktopTable model={fixture.model} callbacks={fixture.callbacks}
          rows={fixture.matching} definitions={fixture.presentation.definitions}
          display={fixture.presentation.display} onKeys={fixture.setKeys} />} />
      <Text as="p" role="status" className="mt-3 break-words">{fixture.notice}</Text>
      <ReferenceRecordDialog row={row} actionDisabled={sourceRow?.status !== 'complete'}
        onClose={() => fixture.setDetailKey(null)} onAction={fixture.setNotice} />
    </GlassPanel>
  );
}
