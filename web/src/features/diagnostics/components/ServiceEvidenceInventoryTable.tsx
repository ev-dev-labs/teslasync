import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge, Caption, DataTable, type Column } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { ServiceEvidencePackSignalEvidence } from '../lib/serviceEvidencePack';

export interface ServiceEvidenceInventoryTableProps {
  signalEvidence: ServiceEvidencePackSignalEvidence[];
  hasChosenSignal: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Tabular inventory of every signal considered by the pending pack: the
 * focal signal plus its bounded related-candidate set, each flagged with
 * whether it actually corroborated a ranked hypothesis. This is the same
 * `signalEvidence` array embedded verbatim in the exported pack's core
 * document — the table is a preview of exactly what will ship.
 */
export function ServiceEvidenceInventoryTable({
  signalEvidence,
  hasChosenSignal,
  isLoading,
  isError,
  error,
  onRetry,
  className,
}: ServiceEvidenceInventoryTableProps) {
  const { t } = useTranslation();

  const columns: Column<ServiceEvidencePackSignalEvidence>[] = [
    {
      key: 'signal',
      header: t('serviceEvidencePack.inventory.col.signal', 'Signal'),
      render: (row) => <span className="break-all">{row.signal}</span>,
    },
    {
      key: 'role',
      header: t('serviceEvidencePack.inventory.col.role', 'Role'),
      render: (row) => (
        <Badge variant={row.role === 'focal' ? 'info' : 'neutral'}>
          {row.role === 'focal'
            ? t('serviceEvidencePack.inventory.roleFocal', 'Focal')
            : t('serviceEvidencePack.inventory.roleCandidate', 'Candidate')}
        </Badge>
      ),
    },
    {
      key: 'domains',
      header: t('serviceEvidencePack.inventory.col.domains', 'Domains'),
      render: (row) => <Caption>{row.domains.length > 0 ? row.domains.join(', ') : '—'}</Caption>,
      visibleOnMobile: false,
    },
    {
      key: 'sampleCount',
      header: t('serviceEvidencePack.inventory.col.samples', 'Samples'),
      render: (row) => <span className="tabular-nums">{row.sampleCount}</span>,
      align: 'right',
    },
    {
      key: 'hasEvidence',
      header: t('serviceEvidencePack.inventory.col.evidence', 'Corroborating'),
      render: (row) => (
        <Badge variant={row.hasEvidence ? 'success' : 'neutral'}>
          {row.hasEvidence
            ? t('serviceEvidencePack.inventory.evidenceYes', 'Yes')
            : t('serviceEvidencePack.inventory.evidenceNo', 'No')}
        </Badge>
      ),
    },
  ];

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceEvidencePack.inventory.title', 'Evidence Inventory')}
      </PanelTitle>
      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={96} />
      ) : signalEvidence.length === 0 ? (
        <EmptyState /* no-action: the inventory appears once a focal signal has been analyzed above. */
          icon={<ClipboardList className="h-8 w-8" />}
          message={
            hasChosenSignal
              ? t('serviceEvidencePack.inventory.noSignals', 'No signal evidence is available for this window yet.')
              : t('serviceEvidencePack.inventory.pickOne', 'Choose a signal above to build the evidence inventory.')
          }
        />
      ) : (
        <DataTable
          tableId="diagnostics:service-evidence-signals"
          columns={columns}
          data={signalEvidence}
          keyExtractor={(row) => row.signal}
          emptyMessage={t('serviceEvidencePack.inventory.noSignals', 'No signal evidence is available for this window yet.')}
        />
      )}
    </GlassPanel>
  );
}
