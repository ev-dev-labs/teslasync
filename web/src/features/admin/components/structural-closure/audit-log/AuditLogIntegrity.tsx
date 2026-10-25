import { Icons } from '@/lib/icons';

import { LayoutCard } from '@/components/layout';
import { Badge, Button, Caption } from '@/components/ui';
import { DataStateNotice, EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';

type Props = { controller: ReturnType<typeof useAuditLogPage> };

export function AuditLogIntegrity({ controller }: Props) {
  const { t, verifyQuery, verifyState, verifyData, verificationRequested, handleVerify, formatDateTime } = controller;
  const hasCheckedRows = Number.isSafeInteger(verifyData?.rows_checked) && (verifyData?.rows_checked ?? 0) > 0;
  const waiting = verificationRequested && !verifyState.hasData && !verifyState.fatalError;

  return (
<LayoutCard title={t('admin.auditLog.integrityTitle', 'Hash chain integrity')} actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={handleVerify}
                disabled={verifyQuery.isFetching}
                wrapLabel
              >
                {verifyQuery.isFetching
                  ? t('admin.auditLog.verifying', 'Verifying…')
                  : t('admin.auditLog.verifyButton', 'Verify chain')}
              </Button>
          }>
            <Caption className="mb-3 block">
              {t('admin.auditLog.boundedProof', 'Bounded row-hash proof only: not adjacency proof, full-ledger verification, or the current entry filters.')}
            </Caption>
            {verifyState.hasData && (
              <StaleRefreshWarning state={verifyState} hideRetry
                label={t('admin.auditLog.integrityTitle', 'Hash chain integrity')} />
            )}
            {verifyState.hasData && verifyQuery.isFetching && (
              <Caption role="status" className="mb-3 block">
                {t('admin.auditLog.retainedVerification', 'Verification is running; the previous receipt remains visible.')}
              </Caption>
            )}

            {(waiting || verifyQuery.isFetching) && verifyState.isRefreshBlocked ? (
              <DataStateNotice state="partial" title={t('fleetOps.brief.refreshBlocked', 'Refresh paused')}>
                {t('admin.auditLog.verificationPaused', 'Verification was requested but is paused. No verification receipt has been received.')}
              </DataStateNotice>
            ) : verifyQuery.isFetching && !verifyState.hasData ? (
              <Skeleton height={72} />
            ) : waiting ? (
              <DataStateNotice state="partial" title={t('common.unknown', 'Unknown')}>
                {t('admin.auditLog.verificationPending', 'Verification was requested; no verification receipt has been received.')}
              </DataStateNotice>
            ) : verifyState.fatalError ? (
              <QueryError
                error={verifyState.fatalError}
                onRetry={handleVerify}
                message={`${t('admin.auditLog.verifyError', 'Verification failed')}: ${getErrorMessage(verifyState.fatalError, t('admin.auditLog.verifyError', 'Verification failed'))}`}
              />
            ) : verifyData ? (
              <div className="space-y-3">
                {verifyData.intact && hasCheckedRows ? (
                  <Badge variant="success" size="lg">
                    <Icons.securityCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainIntact', 'Chain intact')}
                  </Badge>
                ) : !verifyData.intact ? (
                  <Badge variant="danger" size="lg">
                    <Icons.securityAlert className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainBroken', 'Chain broken')}
                  </Badge>
                ) : (
                  <Badge variant="neutral" size="lg">
                    <Icons.shieldQuestion className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.noVerificationEvidence', 'No verification evidence')}
                  </Badge>
                )}
                <Caption className="block">
                  {t('admin.auditLog.rowsChecked', '{{count}} rows checked', {
                    count: verifyData.rows_checked,
                  })}
                </Caption>
                <Caption className="block">
                  {t('admin.auditLog.verificationSince', 'Receipt since: {{since}}', {
                    since: verifyData.since || t('admin.auditLog.serverSelectedSince', 'Server-selected lower bound'),
                  })}
                </Caption>
                <Caption className="block">
                  {t('admin.auditLog.verificationLimit', 'Receipt limit: {{limit}}', { limit: verifyData.limit })}
                </Caption>
                <Caption className="block">
                  {verifyState.updatedAt ? t('admin.auditLog.verificationReceiptAge', 'Receipt: {{at}} · {{seconds}} seconds old', {
                    at: formatDateTime(new Date(verifyState.updatedAt)),
                    seconds: Math.floor((verifyState.ageMs ?? 0) / 1000),
                  }) : t('admin.auditLog.verificationReceiptUnknown', 'Receipt time unknown')}
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
                icon={<Icons.shieldQuestion className="h-8 w-8" />}
                message={t(
                  'admin.auditLog.boundedVerifyHint',
                  'Read-only GET re-derives at most 1,000 non-null row hashes, oldest first, from the server-selected lower bound (default: 30 days ago). It does not verify the full ledger or row adjacency.',
                )}
              />
            )}
          </LayoutCard>
  );
}
