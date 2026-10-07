/**
 * KPI card model for the Data Quality coverage band.
 *
 * Extracted from `NormalizationCoverageKpis` so the rendering component stays
 * a thin, well under-limit shell and the card derivation can be unit-tested on
 * its own. The hook owns the one rule that matters here: a null coverage
 * percentage becomes the localized "Unknown" label, never `0.0%`.
 */
import { type ReactNode, useMemo } from 'react';
import {
  AlertOctagon,
  BadgeCheck,
  Database,
  FileQuestion,
  ShieldCheck,
  Tag,
} from 'lucide-react';

import { type NeonColor } from '@/lib/tokens';
import { fmtInt } from '@/lib/numberFormat';
import { coverageTrust, countBySeverity, formatCoveragePct, type CoverageTrust } from './helpers';
import type {
  DataQualityFieldScore,
  NormalizationSummary,
} from '@/types/admin-operator-confidence';

export interface CoverageKpi {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  color: NeonColor;
  subtitle: string;
}

/** Trust tier → KPI accent. `unknown` stays neutral: it is not a failure. */
const TRUST_COLOR: Record<CoverageTrust, NeonColor> = {
  unknown: 'blue',
  none: 'red',
  partial: 'amber',
  complete: 'green',
};

/** Minimal translator surface, so this module does not import i18n directly. */
type Translate = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

export function useCoverageKpis(
  normalization: NormalizationSummary | undefined,
  fields: readonly DataQualityFieldScore[],
  windowMins: number | undefined,
  t: Translate,
): CoverageKpi[] {
  const total = normalization?.total_sample_count ?? 0;
  const versioned = normalization?.versioned_sample_count ?? 0;
  const unversioned = normalization?.unversioned_sample_count ?? 0;
  const coveragePct = normalization?.coverage_pct ?? null;
  const coverageState = normalization?.coverage_state;
  const requiredVersion = normalization?.required_version;

  const trust = coverageTrust(coveragePct, coverageState);
  const coverageText = formatCoveragePct(coveragePct, coverageState);
  const criticalFields = countBySeverity(fields, 'critical');

  return useMemo<CoverageKpi[]>(
    () => [
      {
        key: 'total',
        label: t('admin.dataQuality.kpiTotal', 'Samples in window'),
        value: fmtInt(total),
        icon: <Database className="h-5 w-5" />,
        color: 'cyan',
        subtitle: t('admin.dataQuality.windowSub', 'Window: {{mins}} min', {
          mins: fmtInt(windowMins ?? 0),
        }),
      },
      {
        key: 'versioned',
        label: t('admin.dataQuality.kpiVersioned', 'Version-attested'),
        value: fmtInt(versioned),
        icon: <BadgeCheck className="h-5 w-5" />,
        color: 'green',
        subtitle: t(
          'admin.dataQuality.kpiVersionedSub',
          'Rows carrying a normalization version',
        ),
      },
      {
        key: 'unversioned',
        label: t('admin.dataQuality.kpiUnversioned', 'Unattested'),
        value: fmtInt(unversioned),
        icon: <FileQuestion className="h-5 w-5" />,
        color: unversioned > 0 ? 'amber' : 'green',
        subtitle: t(
          'admin.dataQuality.kpiUnversionedSub',
          'Legacy or below-contract provenance',
        ),
      },
      {
        key: 'coverage',
        label: t('admin.dataQuality.kpiCoverage', 'Attested coverage'),
        // Null coverage renders the explicit "Unknown" label. Never 0 %.
        value: coverageText ?? t('admin.dataQuality.unknown', 'Unknown'),
        icon: <ShieldCheck className="h-5 w-5" />,
        color: TRUST_COLOR[trust],
        subtitle:
          coverageText == null
            ? t(
                'admin.dataQuality.kpiCoverageUnknownSub',
                'No samples were observed in this window',
              )
            : t('admin.dataQuality.kpiCoverageSub', '{{versioned}} of {{total}} rows', {
                versioned: fmtInt(versioned),
                total: fmtInt(total),
              }),
      },
      {
        key: 'required',
        label: t('admin.dataQuality.kpiRequiredVersion', 'Required version'),
        value:
          requiredVersion == null
            ? t('admin.dataQuality.unknown', 'Unknown')
            : `v${requiredVersion}`,
        icon: <Tag className="h-5 w-5" />,
        color: 'purple',
        subtitle: t(
          'admin.dataQuality.kpiRequiredVersionSub',
          'Minimum attested SI contract',
        ),
      },
      {
        key: 'critical',
        label: t('admin.dataQuality.kpiCriticalFields', 'Critical fields'),
        value: fmtInt(criticalFields),
        icon: <AlertOctagon className="h-5 w-5" />,
        color: criticalFields > 0 ? 'red' : 'green',
        subtitle: t('admin.dataQuality.kpiCriticalFieldsSub', 'Composite score below 50'),
      },
    ],
    [
      t,
      total,
      versioned,
      unversioned,
      coverageText,
      trust,
      requiredVersion,
      criticalFields,
      windowMins,
    ],
  );
}
