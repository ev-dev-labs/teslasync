import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GridMetricIndicator } from '@/components/data-display';
import { batteryColor, healthColor, COLOR } from '@/lib/colors';
import { gradeFromEfficiency } from '@/lib/drivesAggregation';

type MetricKind = 'battery' | 'efficiency' | 'score';

export function metricBand(value: number, kind: MetricKind) {
  if (kind === 'efficiency') {
    const grade = gradeFromEfficiency(value).label;
    return grade === 'A+' || grade === 'A' ? 'good' : grade === 'B' ? 'info' : grade === 'C' ? 'warning' : 'critical';
  }
  const color = kind === 'battery' ? batteryColor(value) : healthColor(value);
  return color === COLOR.GOOD ? 'good' : color === COLOR.WARN ? 'warning' : 'critical';
}

export function DriveGridMetric({ value, children, scaleLabel, kind }: {
  value: number | null;
  children: ReactNode;
  scaleLabel: string;
  kind: MetricKind;
}) {
  const { t } = useTranslation();
  if (value == null || !Number.isFinite(value)) return <span>—</span>;
  const fraction = Math.min(1, Math.max(0, value / 100));
  const band = metricBand(value, kind);
  const grade = kind === 'efficiency' ? gradeFromEfficiency(value) : null;
  const gradeLevel = grade?.label === 'A+' ? 5 : grade?.numeric ?? 0;
  const bandLabel = {
    good: t('drives.grid.bandGood', 'Good range'),
    info: t('drives.grid.bandInfo', 'Typical range'),
    warning: t('drives.grid.bandWarning', 'Caution range'),
    critical: t('drives.grid.bandCritical', 'Outside preferred range'),
  }[band];
  const title = grade
    ? t('drives.efficiencyGradeAria', 'Efficiency grade {{grade}}', { grade: grade.label })
    : `${scaleLabel}. ${bandLabel}`;
  return (
    <GridMetricIndicator kind={kind} band={band} title={title} fraction={fraction} segments={gradeLevel}>
      {children}
    </GridMetricIndicator>
  );
}
