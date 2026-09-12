import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  GlassPanel, PanelTitle, Badge, Text, Caption, Button, Input, CopyButton,
} from '@/components/ui';
import { useClaimDraft, type ClaimDraft } from '@/api/hooks/useServiceIntelligence';
import { useDataState } from '@/hooks/useDataState';
import { PanelState } from './PanelState';

export interface ClaimDraftPanelProps {
  vehicleId: number | null;
}

function coverageVariant(status: string): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'expiring_soon':
      return 'warning';
    default:
      return 'danger';
  }
}

function DraftBody({ draft }: { draft: ClaimDraft }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div>
        <Text variant="bodySm" className="font-medium">{draft.subject}</Text>
        {draft.vehicle && <Caption>{draft.vehicle}</Caption>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {draft.coverages.map((c) => (
          <Badge key={c.name} variant={coverageVariant(c.status)} size="sm">
            {t('serviceIntelligence.claim.coverage', '{{name}} · {{days}}d left', {
              name: c.name, days: c.days_remaining,
            })}
          </Badge>
        ))}
      </div>
      {draft.issue && <Text variant="bodySm">{draft.issue}</Text>}
      <Text variant="bodySm">{draft.ask}</Text>
      {draft.communications.length > 0 && (
        <ul className="space-y-1">
          {draft.communications.map((c, i) => (
            <li key={i}><Caption className="break-words">{c}</Caption></li>
          ))}
        </ul>
      )}
      <CopyButton
        text={draft.body}
        withToast
        label={t('serviceIntelligence.claim.copy', 'Copy ticket text')}
      />
      <Caption>{draft.disclaimer}</Caption>
    </div>
  );
}

export function ClaimDraftPanel({ vehicleId }: ClaimDraftPanelProps) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const query = useClaimDraft(vehicleId, submitted);
  const draftState = useDataState(query);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icons.fileText className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.claim.title', 'Warranty claim draft')}
      </PanelTitle>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder={t('serviceIntelligence.claim.placeholder', 'Describe the issue (e.g. charge rate drops after 60%)')}
          aria-label={t('serviceIntelligence.claim.issueLabel', 'Issue description')}
          className="flex-1"
        />
        <Button
          onClick={() => setSubmitted(issue)}
          disabled={vehicleId == null || query.isFetching}
          loading={query.isFetching}
          icon={<Icons.fileText className="h-4 w-4" aria-hidden="true" />}
          className="gap-2"
        >
          {t('serviceIntelligence.claim.generate', 'Draft ticket')}
        </Button>
      </div>
      <PanelState
        selected={vehicleId != null}
        loading={query.isLoading || query.isFetching}
        error={draftState.fatalError}
        empty={submitted == null || query.data == null}
        icon={<Icons.fileText className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.claim.selectMessage',
          'Choose a vehicle to draft a warranty service ticket.',
        )}
        emptyTitle={t('serviceIntelligence.claim.emptyTitle', 'No ticket yet')}
        emptyMessage={t('serviceIntelligence.claim.empty', 'Describe an issue and generate a ready-to-paste service ticket.')}
        onRetry={() => void query.refetch()}
      >
        {query.data && <DraftBody draft={query.data} />}
      </PanelState>
    </GlassPanel>
  );
}
