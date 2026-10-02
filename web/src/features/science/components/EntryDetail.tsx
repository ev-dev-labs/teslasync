import type {
  ScienceNotebookEntry
} from '@/api/types';
import {
  Badge,
  Caption,
  Table,
  Text
} from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { asList, unknown, useT } from './helpers';

export function EntryDetail({ entry }: { entry: ScienceNotebookEntry }) {
  const t = useT();
  const kv = (label: string, obj?: Record<string, unknown>) => {
    if (!obj) return null;
    const rows = Object.entries(obj).filter(([, v]) => v != null);
    if (rows.length === 0) return null;
    return (
      <Table aria-label={label}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className="font-normal">
                <Text size="sm" color="secondary" mono>{k}</Text>
              </th>
              <td className={typeof v === 'number' ? 'text-right tabular-nums' : undefined}>
                <Text size="sm" color="secondary" mono>
                  {typeof v === 'number' ? fmtNumber(v, 3) : String(v)}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
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
      <Text as="p" size="sm" color="secondary">
        {t('science.notebook.signalsUsed', 'Signals used')}: {asList(entry.signals_used).join(', ') || unknown(t)}
      </Text>
      <Text as="p" size="sm" color="secondary">
        {t('science.notebook.missingSignals', 'Missing signals')}: {asList(entry.missing_signals).join(', ') || t('science.notebook.noneReported', 'None reported')}
      </Text>
      <Text as="p" size="sm" color="secondary">
        {t('science.notebook.residual', 'Fit residual (mean / RMSE)')}:{' '}
        {entry.residual_mean != null ? fmtNumber(entry.residual_mean, 3) : unknown(t)} / {entry.residual_rmse != null ? fmtNumber(entry.residual_rmse, 3) : unknown(t)}
      </Text>
      <Text as="p" size="sm" color="secondary">
        {t('science.notebook.recordId', 'Generated record')}: {entry.id}
      </Text>
      {kv(t('science.notebook.parameters', 'Parameters'), entry.parameters)}
      {kv(t('science.notebook.ci', 'Confidence intervals'), entry.ci)}
      <Caption>{formatDateTime(entry.start)} → {formatDateTime(entry.end)}</Caption>
      <Text as="p" size="sm" color="secondary">{entry.honesty}</Text>
    </div>
  );
}
