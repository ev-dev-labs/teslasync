import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSecretRotation } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { SecretRotationSeverity, SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { SEVERITY_ORDER, KIND_LABELS } from '../components/structural-closure/secret-rotation/helpers';

export function useSecretRotationPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('admin.secretRotation.pageTitle', 'Secret rotation'));

  const query = useSecretRotation();
  const source = deriveDataState(query);
  const subsystemMissing = isApiError(source.fatalError) && source.fatalError.status === 503;
  const showError = Boolean(source.fatalError) && !subsystemMissing;
  const isLoading = query.isLoading && !source.hasData;
  const items = query.data?.items ?? [];

  // Friendly, translatable label for a secret kind — dynamic i18n key with the
  // English `KIND_LABELS` entry as the fallback default.
  const kindLabel = useCallback(
    (raw: string) => t(`admin.secretRotation.kind.${raw}`, KIND_LABELS[raw] ?? raw),
    [t],
  );

  // Compose a readable chart/list label, appending the target when set.
  const rowLabel = useCallback(
    (r: SecretRotationStatus) => (r.target_id ? `${kindLabel(r.kind)} · ${r.target_id}` : kindLabel(r.kind)),
    [kindLabel],
  );

  // Severity display labels resolved through i18n (module-level consts can't
  // call `t`); memoised so the columns/legend/list stay stable.
  const severityLabel = useMemo<Record<SecretRotationSeverity, string>>(
    () => ({
      ok: t('admin.secretRotation.severityOk', 'OK'),
      warn: t('admin.secretRotation.severityWarn', 'Rotate soon'),
      critical: t('admin.secretRotation.severityCritical', 'Overdue'),
      unknown: '—',
    }),
    [t],
  );

  const counts = useMemo(() => {
    const c: Record<SecretRotationSeverity, number> = { ok: 0, warn: 0, critical: 0, unknown: 0 };
    for (const it of items) c[it.severity] = (c[it.severity] ?? 0) + 1;
    return c;
  }, [items]);

  const total = items.length;
  const distinctKinds = useMemo(() => new Set(items.map((r) => r.kind)).size, [items]);
  const okPct = total > 0 ? `${Math.round((counts.ok / total) * 100)}%` : '—';

  const oldest = useMemo(
    () => items.reduce<SecretRotationStatus | null>(
      (best, r) => (best === null || (r.age_days ?? 0) > (best.age_days ?? 0) ? r : best),
      null,
    ),
    [items],
  );

  const soonestExpiry = useMemo(
    () => items.reduce<SecretRotationStatus | null>((best, r) => {
      const d = r.days_to_expiry;
      if (d === null || d === undefined) return best;
      if (best === null || d < (best.days_to_expiry ?? Infinity)) return r;
      return best;
    }, null),
    [items],
  );

  // Oldest secrets, capped, for the horizontal age chart.
  const topByAge = useMemo(
    () => [...items]
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 10)
      .map((r) => ({ ...r, label: rowLabel(r) })),
    [items, rowLabel],
  );

  // Rotation urgency — age relative to the per-kind critical threshold, so a
  // full bar means the secret has hit (or passed) its overdue point. Sorted by
  // that ratio so the closest-to-overdue secrets surface first.
  const urgency = useMemo(
    () => [...items]
      .map((r) => {
        const crit = r.critical_days ?? 0;
        const ratio = crit > 0 ? (r.age_days ?? 0) / crit : 0;
        return { r, ratio };
      })
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 8),
    [items],
  );

  const expiryWatch = useMemo(
    () => items
      .filter((r) => r.expires_at != null && r.days_to_expiry != null)
      .sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0)),
    [items],
  );

  const severitySlices = useMemo(
    () => SEVERITY_ORDER
      .map((key) => ({ key, label: severityLabel[key], value: counts[key] ?? 0 }))
      .filter((s) => s.value > 0),
    [counts, severityLabel],
  );


  const retry = () => query.refetch();

  return {
    fmtNumber, t, query, source, subsystemMissing, showError, isLoading, items, kindLabel, rowLabel, severityLabel, counts, total, distinctKinds, okPct, oldest, soonestExpiry, topByAge, urgency, expiryWatch, severitySlices, retry
  };
}
