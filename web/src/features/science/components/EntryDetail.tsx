import type {
  ScienceNotebookEntry
} from '@/api/types';
import {
  Badge,
  Caption,
  Text
} from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { unknown, useT } from './helpers';

export function EntryDetail({ entry }: { entry: ScienceNotebookEntry }) {
  const t = useT();
  const kv = (obj?: Record<string, unknown>) => {
    if (!obj) return null;
    const rows = Object.entries(obj).filter(([, v]) => v != null);
    if (rows.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {rows.map(([k, v]) => (
          <Text key={k} as="p" size="sm" color="secondary" mono>
            {k}: {typeof v === 'number' ? fmtNumber(v, 3) : String(v)}
          </Text>
        ))}
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <Text as="p" size="sm">{entry.hypothesis}</Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={entry.unknown ? 'warning' : 'success'} size="sm">
          n={fmtNumber(entry.n, 0)} · {entry.method} · {entry.ci_method}
        </Badge>
        {entry.holdout_frac != null ? (
          <Badge variant="neutral" size="sm">
            {t('science.holdout', 'holdout')}: {fmtNumber(entry.holdout_frac * 100, 0)}%
            {entry.holdout_rmse != null ? ` RMSE ${fmtNumber(Number(entry.holdout_rmse), 2)}` : ''}
          </Badge>
        ) : null}
        <Badge variant="neutral" size="sm">{entry.firmware_epoch || unknown(t)}</Badge>
      </div>
      {kv(entry.parameters)}
      {kv(entry.ci)}
      <Caption>{formatDateTime(entry.start)} → {formatDateTime(entry.end)}</Caption>
      <Text as="p" size="sm" color="secondary">{entry.honesty}</Text>
    </div>
  );
}
