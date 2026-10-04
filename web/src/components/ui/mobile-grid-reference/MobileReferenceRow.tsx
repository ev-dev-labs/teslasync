import { useTranslation } from 'react-i18next';
import { Badge, Checkbox, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { rowMappingIssues, safeProgress } from './helpers';
import type { MobileRow, MobileVariant } from './types';

interface Props {
  row: MobileRow;
  variant: MobileVariant;
  selecting: boolean;
  selected: boolean;
  onActivate: () => void;
  onToggle: () => void;
}
export function MobileReferenceRow({ row, variant, selecting, selected, onActivate, onToggle }: Props) {
  const { t } = useTranslation();
  const activate = selecting ? onToggle : onActivate;
  const keyValue = variant === 'keyValue';
  if (rowMappingIssues(row).length > 0) return (
    <EmptyState className="mgr-state !py-8 [&_button]:min-h-11"
      message={t('developerReference.mobileGrid.gaps.mapping', 'Invalid mobile mapping: provide at most three unique metadata fields and unique detail fields.')}
      action={{ label: t('developerReference.mobileGrid.desktop.details', 'Open reference details and actions'), onClick: onActivate }} />
  );
  return (
    <div className="mgr-row-wrap flex min-w-0 items-center border-b border-[var(--border-subtle)] last:border-b-0">
      {selecting && (
        <Checkbox
          checked={selected}
          onChange={onToggle}
          aria-label={t('developerReference.mobileGrid.selection.row', 'Select {{title}}', { title: row.title })}
          className="mgr-checkbox min-h-11 min-w-11 justify-center"
        />
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label={row.title}
        aria-pressed={selecting ? selected : undefined}
        data-card={keyValue ? undefined : ''}
        data-kv-row={keyValue ? '' : undefined}
        data-row-key={row.key}
        className={cn('mgr-row min-w-0 flex-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]',
          keyValue ? 'mgr-kv' : 'mgr-card')}
        onClick={activate}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <Text data-card-label="" title={row.title} className="mgr-title block truncate">{row.title}</Text>
            {keyValue && row.rawLabel && <Text mono className="block truncate text-[11px] text-[var(--text-muted)]" title={row.rawLabel}>{row.rawLabel}</Text>}
          </div>
          {!keyValue && row.tag && <Badge variant="neutral" className="max-w-20 truncate">{row.tag}</Badge>}
          <Text data-card-primary="" title={row.primary} className="mgr-primary max-w-[45%] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">{row.primary}</Text>
        </div>
        {!keyValue && (
          <div className="mt-2 flex min-w-0 items-center gap-2">
            {row.meta.map(field => (
              <div key={field.key} data-card-meta="" data-field-key={field.key} className="min-w-0 flex-1">
                <Text className="mgr-meta-label block truncate">{field.label}</Text>
                <Text title={field.value} className="mgr-meta-value block truncate">{field.value}</Text>
              </div>
            ))}
            {row.badge && <Badge variant="neutral" aria-label={row.badge.label} className="shrink-0">{row.badge.value}</Badge>}
          </div>
        )}
        {!keyValue && row.progress && (
          <div
            role="img"
            aria-label={row.progress.label}
            className="mgr-progress relative mt-2 overflow-hidden rounded-full bg-[var(--surface-3)]"
          >
            <div className="absolute inset-y-0 left-0 bg-[var(--text-muted)]"
              style={{ width: `${safeProgress(row.progress.from)}%` }} />
            <div className="absolute inset-y-0 bg-[var(--theme-primary)]"
              style={{ left: `${safeProgress(Math.min(row.progress.from, row.progress.to))}%`,
                width: `${Math.abs(safeProgress(row.progress.to) - safeProgress(row.progress.from))}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
