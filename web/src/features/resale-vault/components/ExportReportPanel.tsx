/**
 * Export panel — signs the currently-assembled `VaultReport` with the
 * active local key and offers a JSON download of the resulting
 * `SignedVaultReport`. Signing is explicit (a button press), so nothing
 * is ever signed/exported without the user seeing the privacy preview
 * first and choosing to proceed.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDayKey } from '@/lib/dateFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import { Badge, Button, HelperText, Toggle } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { InlineCallout } from '@/components/feedback';
import { Download, FileSignature, ShieldAlert } from 'lucide-react';
import { signReport } from '../lib/reportSigner';
import { CryptoUnavailableError } from '../lib/cryptoAvailability';
import { recordAuditEvent } from '../lib/auditTrail';
import { DIGEST_IS_NOT_A_SIGNATURE_NOTE } from '../lib/constants';
import type { SignedVaultReport, VaultReport } from '../lib/types';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';

export function getReportSourcePolicy(
  report: VaultReport,
  sources: readonly VaultEvidenceSource[],
  formatUpdatedAt = (value: number) => new Date(value).toISOString(),
) {
  const selected = sources.filter((source) => report.disclosure.sections.includes(source.section));
  return {
    blocked: selected.some(({ state }) => state.status === 'initial'),
    requiresAcknowledgment: selected.some(({ state }) =>
      state.status === 'initialFailure' || state.status === 'stale' || state.status === 'partial'
      || state.isRefreshing || state.isRefreshBlocked),
    limitations: selected.map(({ id, section, state }) =>
      `Source readiness: ${section}/${id}; status=${state.status}; retained=${state.hasData}; `
      + `refreshing=${state.isRefreshing}; paused=${state.isRefreshBlocked}; `
      + `provenance=${state.provenance}; refresh_failed=${state.refreshError != null}; `
      + `last successful load=${state.updatedAt == null ? 'unknown' : formatUpdatedAt(state.updatedAt)}. `
      + (state.status === 'initial' || state.status === 'initialFailure'
        ? 'Unresolved or failed source is not evidence of an empty history or a zero measurement.'
        : state.status === 'stale' || state.status === 'partial' || state.isRefreshing || state.isRefreshBlocked
          ? 'Retained or partial evidence is included intentionally; current completeness and freshness are not confirmed.'
          : 'Successful source response; empty histories and zero measurements are valid observed results, not lifetime guarantees.')),
  };
}

export interface ExportReportPanelProps {
  report: VaultReport;
  sources?: readonly VaultEvidenceSource[];
  retainedExport?: { signed: SignedVaultReport; readinessKey: string } | null;
  onSigned?: (signed: SignedVaultReport, readinessKey: string) => void;
  blocked?: boolean;
  onSigningChange?: (pending: boolean, operation: object) => void;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

export function ExportReportPanel({ report, sources = [], retainedExport, onSigned, blocked = false, onSigningChange }: ExportReportPanelProps) {
  const { t } = useTranslation();
  const { formatDateTime, opts } = useDateFormat();
  const [signed, setSigned] = useState<SignedVaultReport | null>(() => retainedExport ? structuredClone(retainedExport.signed) : null);
  const [signedReadinessKey, setSignedReadinessKey] = useState<string | null>(retainedExport?.readinessKey ?? null);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<object | null>(null);
  const [acknowledgedReport, setAcknowledgedReport] = useState<string | null>(null);
  const policy = getReportSourcePolicy(report, sources);
  // Localize only the preview; readiness identity and signed limitations retain canonical instants.
  const displayPolicy = getReportSourcePolicy(report, sources, (value) => formatDateTime(new Date(value)));
  const readinessKey = JSON.stringify([report, policy.limitations]);
  const currentScope = useRef({ key: readinessKey });
  if (currentScope.current.key !== readinessKey) currentScope.current = { key: readinessKey };
  const mounted = useRef(true);
  const pendingOperation = useRef<object | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const acknowledged = acknowledgedReport === readinessKey;
  const canSign = !blocked && !policy.blocked && (!policy.requiresAcknowledgment || acknowledged);

  const handleSign = async () => {
    if (!canSign || pendingOperation.current) return;
    const operation = {};
    pendingOperation.current = operation;
    const scope = currentScope.current;
    const matches = () => mounted.current && pendingOperation.current === operation;
    onSigningChange?.(true, operation);
    setIsSigning(true);
    setError(null);
    try {
      // Detach before the first await: neither refreshes nor callers may change the signed bytes.
      const snapshot = structuredClone(report);
      for (const limitation of policy.limitations) {
        if (!snapshot.limitations.includes(limitation)) snapshot.limitations.push(limitation);
      }
      const result = await signReport(snapshot);
      if (matches()) {
        setSigned(structuredClone(result));
        setSignedReadinessKey(scope.key);
        onSigned?.(structuredClone(result), scope.key);
      }
      await recordAuditEvent('report_signed', `Signed report ${snapshot.report_id} with key ${result.signature.key_id}.`);
    } catch (err) {
      if (!matches()) return;
      setErrorScope(scope);
      if (err instanceof CryptoUnavailableError) {
        setError(err.message);
      } else {
        setError(getErrorMessage(err, t('error.unexpected', 'An unexpected error occurred')));
      }
    } finally {
      pendingOperation.current = null;
      if (mounted.current) setIsSigning(false);
      onSigningChange?.(false, operation);
    }
  };

  const handleDownload = async () => {
    if (!signed || isSigning || blocked) return;
    const scope = currentScope.current;
    setError(null);
    try {
      downloadJson(`${signed.report.report_id}.json`, signed);
      await recordAuditEvent('report_exported', `Exported signed report ${signed.report.report_id} as JSON.`);
    } catch (err) {
      if (!mounted.current || currentScope.current !== scope) return;
      setErrorScope(scope);
      setError(getErrorMessage(err, t('error.unexpected', 'An unexpected error occurred')));
    }
  };

  return (
    <LayoutCard title={t('resaleVault.export.title', 'Export signed report')}
      actions={<FileSignature className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />}>

      <HelperText>
        {t(
          'resaleVault.export.subtitle',
          'Signing computes a SHA-256 digest of the report above and produces an ECDSA signature over it using your active local key.',
        )}
      </HelperText>

      {error && errorScope === currentScope.current && (
        <InlineCallout variant="danger" icon={<ShieldAlert />}>
          {error}
        </InlineCallout>
      )}

      {policy.blocked && (
        <InlineCallout variant="info">
          {t('resaleVault.inventory.loading', 'Loading…')}
        </InlineCallout>
      )}
      {policy.requiresAcknowledgment && (
        <div className="space-y-2">
          <InlineCallout variant="warning">
            {t('resaleVault.preview.includedWithWarning', 'Included with warning')}
            <ul className="list-disc ps-5">
              {displayPolicy.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </InlineCallout>
          <Toggle
            label={t('resaleVault.preview.includedWithWarning', 'Included with warning')}
            checked={acknowledged}
            onChange={(checked) => setAcknowledgedReport(checked ? readinessKey : null)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button wrapLabel size="sm" onClick={() => void handleSign()} loading={isSigning} disabled={!canSign || isSigning}>
          {t('resaleVault.export.sign', 'Sign report')}
        </Button>
        <Button wrapLabel size="sm" variant="secondary" onClick={() => void handleDownload()} disabled={!signed || isSigning || blocked} icon={<Download className="h-3.5 w-3.5" />}>
          {t('resaleVault.export.download', 'Download JSON')}
        </Button>
      </div>

      {signed && (
        <div className="space-y-2 rounded-shape-sm border border-[var(--border-subtle)] p-3">
          {signedReadinessKey !== readinessKey && (
            <InlineCallout variant="warning">
              {t('resaleVault.export.olderPreview', 'This signed snapshot belongs to an older preview. Download JSON exports that unchanged snapshot, not the current preview. Sign again to replace it.')}
            </InlineCallout>
          )}
          <HelperText>{signed.report.report_id}</HelperText>
          <HelperText>{t('resaleVault.disclosure.profileGroup', 'Disclosure profile')}: {signed.report.disclosure.profileId}</HelperText>
          <HelperText>{t('resaleVault.disclosure.sections', 'Evidence sections')}: {signed.report.disclosure.sections.join(', ')}</HelperText>
          <HelperText>{t('resaleVault.disclosure.vinLabel', 'VIN disclosure')}: {signed.report.disclosure.sensitive.vinDisclosure}</HelperText>
          <HelperText>
            {t('resaleVault.preview.timeBounds', 'Evidence window: {{earliest}} → {{latest}} ({{precision}} precision).', {
              earliest: signed.report.time_bounds.earliest_evidence_at ?? '—',
              latest: signed.report.time_bounds.latest_evidence_at ?? '—',
              precision: signed.report.time_bounds.precision,
            })}
          </HelperText>
          <div className="flex items-center gap-2">
            <Badge variant={signed.local_key_status.persisted ? 'success' : 'warning'}>
              {signed.local_key_status.persisted
                ? t('resaleVault.export.keyPersisted', 'Signing key persisted')
                : t('resaleVault.export.keySessionOnly', 'Signing key session-only')}
            </Badge>
            {signed.local_key_status.revoked && (
              <Badge variant="danger">{t('resaleVault.export.keyRevoked', 'Signed with a revoked key')}</Badge>
            )}
          </div>
          <div className="break-all text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.digest', 'SHA-256 digest')}:</span>{' '}
            {signed.digest_sha256_hex}
          </div>
          <div className="break-all text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.keyId', 'Key ID')}:</span>{' '}
            {signed.signature.key_id}
          </div>
          <div className="text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.signedAt', 'Signed at')}:</span>{' '}
            {/^\d{4}-\d{2}-\d{2}$/.test(signed.signature.signed_at)
              ? formatDayKey(signed.signature.signed_at, opts) : formatDateTime(signed.signature.signed_at)}
          </div>
        </div>
      )}

      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {DIGEST_IS_NOT_A_SIGNATURE_NOTE}
      </InlineCallout>
    </LayoutCard>
  );
}
