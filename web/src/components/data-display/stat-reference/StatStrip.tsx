import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Heading } from '@/components/ui';
import { cn } from '@/lib/cn';
import { StatTile } from './StatTile';
import { useMetricPreferences } from './useMetricPreferences';
import type { StatStripProps } from './types';
import styles from './statReference.module.css';

/** The single renderer consumed by both reference owners; no production rollout. */
export function StatStrip({
  metrics, period, id, title, variant = 'standalone', loading = false,
  error, retained = false, breakdown, preferences, className,
  periodInHeader = false, periodHeaderId,
}: StatStripProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const savedPreferences = useMetricPreferences();
  const prefs = preferences ?? savedPreferences;
  const items = metrics ?? [];
  const facts = breakdown ?? [];
  const banks = Array.from({ length: Math.ceil(items.length / 6) }, (_, index) => items.slice(index * 6, index * 6 + 6));
  return <section data-stat-strip={id ?? `stat-${generatedId}`} data-period-kind={period.kind} data-retained={retained}
    aria-busy={loading} aria-describedby={periodInHeader ? periodHeaderId : undefined}
    className={cn(styles.root, variant === 'standalone' &&
      'rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)]', className)}>
    {(title || !periodInHeader) && <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
      {title && <Heading level="panel">{title}</Heading>}
      {!periodInHeader && <span data-stat-period={period.kind !== 'snapshot' ? true : undefined}
        data-stat-freshness={period.kind === 'snapshot' ? true : undefined}
        className="text-[13px] text-[var(--text-secondary)]">{period.label}</span>}
    </header>}
    {period.kind === 'unknown' && period.reason && <p className="px-4 pb-2 text-xs text-[var(--text-secondary)]">{period.reason}</p>}
    {retained && <p role="status" className="px-4 pb-2 text-xs text-[var(--text-secondary)]">
      {t('developerReference.stats.state.retained', 'Showing retained measurements')}
    </p>}
    {error && <p role="alert" className="px-4 pb-2 text-sm text-[var(--text-secondary)]">{error}</p>}
    {items.length ? banks.map((bank, bankIndex) => <div key={bankIndex} className={styles.tiles} data-stat-bank
      data-columns={bank.length}>
      {bank.map((metric, index) => <StatTile key={metric.occurrenceId ?? `${metric.metricId}-${bankIndex}-${index}`}
        metric={metric} preferences={prefs} loading={loading && !retained} />)}
    </div>) : <div className="p-4"><EmptyState message={t('developerReference.stats.state.empty', 'No metrics supplied')} /></div>}
    {facts.length > 0 && <p data-stat-breakdown className="px-4 py-3 text-[13px] leading-5 text-[var(--text-secondary)]">
      {facts.join(' · ')}
    </p>}
  </section>;
}
