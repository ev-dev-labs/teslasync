import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Badge, Button, Caption } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';

type Props = { controller: ReturnType<typeof useAuditLogPage> };

export function AuditLogIntegrity({ controller }: Props) {
  const { t, verifyQuery, verifyState, verifyData } = controller;

  return (
<LayoutCard title={t('admin.auditLog.integrityTitle', 'Hash chain integrity')} actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => verifyQuery.refetch()}
                disabled={verifyQuery.isFetching}
                wrapLabel
              >
                {verifyQuery.isFetching
                  ? t('admin.auditLog.verifying', 'Verifying…')
                  : t('admin.auditLog.verifyButton', 'Verify chain')}
              </Button>
          }>

            {verifyQuery.isFetching && !verifyState.hasData ? (
              <Skeleton height={72} />
            ) : verifyState.fatalError ? (
              <QueryError
                error={verifyState.fatalError}
                onRetry={() => verifyQuery.refetch()}
                message={`${t('admin.auditLog.verifyError', 'Verification failed')}: ${getErrorMessage(verifyState.fatalError, t('admin.auditLog.verifyError', 'Verification failed'))}`}
              />
            ) : verifyData ? (
              <div className="space-y-3">
                {verifyData.intact ? (
                  <Badge variant="success" size="lg">
                    <ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainIntact', 'Chain intact')}
                  </Badge>
                ) : (
                  <Badge variant="danger" size="lg">
                    <ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainBroken', 'Chain broken')}
                  </Badge>
                )}
                <Caption className="block">
                  {t('admin.auditLog.rowsChecked', '{{count}} rows checked', {
                    count: verifyData.rows_checked,
                  })}
                </Caption>
                {!verifyData.intact && verifyData.first_bad_id > 0 && (
                  <Caption className="block">
                    {t('admin.auditLog.firstBadId', 'First bad row: #{{id}}', {
                      id: verifyData.first_bad_id,
                    })}
                  </Caption>
                )}
              </div>
            ) : (
              <EmptyState
                /* no-action: verification is an explicit, read-only operator action via the button above */
                icon={<ShieldQuestion className="h-8 w-8" />}
                message={t(
                  'admin.auditLog.verifyHint',
                  'Re-derive every row_hash server-side. No data is sent or written — this is read-only.',
                )}
              />
            )}
          </LayoutCard>
  );
}
