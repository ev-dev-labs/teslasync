import { useTranslation } from 'react-i18next';
import type { DataStatus } from '@/api/dataState';
import type { PhysicsLedger } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import { formatDateTime } from '@/lib/dateFormat';
import { VehicleEvidenceBrief } from './VehicleEvidenceBrief';

export function LedgerEvidenceBrief({ ledger, id, title, description, metrics, status, available }: {
  ledger: PhysicsLedger;
  id: string;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  status?: DataStatus;
  available: boolean;
}) {
  const { t } = useTranslation();
  const sourceStatus = status ?? 'ok';
  return <VehicleEvidenceBrief id={id} title={title} description={description}
    metrics={metrics}
    status={sourceStatus === 'ok' && (!available || ledger.truncated) ? 'partial' : sourceStatus}
    scope={t('physicsLedger.briefWindow', '{{start}} → {{end}}', {
      start: formatDateTime(ledger.start), end: formatDateTime(ledger.end),
    })}
    provenance={t('physicsLedger.briefSource', 'Bounded physics ledger')} />;
}
