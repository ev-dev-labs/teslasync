import { useTranslation } from 'react-i18next';
import { CodeBlock, CopyButton, Text } from '@/components/ui';
import { KVList } from '@/components/data-display';
import type { AuditLogRow } from '@/types/admin-operator-confidence';

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditExpandedDetail({ row }: { row: AuditLogRow }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-4 p-4">
      <KVList layout="responsive" items={[
        { id: 'ip', label: t('admin.auditLog.detailIp', 'IP'), value: <Text mono>{row.ip ?? '—'}</Text> },
        { id: 'ua', label: t('admin.auditLog.detailUa', 'User-agent'), value: row.user_agent ?? '—' },
        ...(row.trace_id ? [{
          id: 'trace', label: t('admin.auditLog.detailTrace', 'Trace ID'),
          value: <div className="flex min-w-0 items-start gap-2">
            <Text mono className="min-w-0 break-all">{row.trace_id}</Text>
            <CopyButton text={row.trace_id} iconOnly variant="ghost" size="sm" />
          </div>,
        }] : []),
        ...(row.row_hash ? [{
          id: 'hash', label: t('admin.auditLog.detailHash', 'Row hash'),
          value: <div className="flex min-w-0 items-start gap-2">
            <Text mono size="xs" className="min-w-0 break-all">{row.row_hash}</Text>
            <CopyButton text={row.row_hash} iconOnly variant="ghost" size="sm" />
          </div>,
        }] : []),
      ]} />
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        {row.before && <CodeBlock heading={t('admin.auditLog.detailBefore', 'Before')} ariaLabel={t('admin.auditLog.detailBefore', 'Before')} text={formatJSON(row.before)} className="[&_pre]:max-h-64" wrap />}
        {row.after && <CodeBlock heading={t('admin.auditLog.detailAfter', 'After')} ariaLabel={t('admin.auditLog.detailAfter', 'After')} text={formatJSON(row.after)} className="[&_pre]:max-h-64" wrap />}
      </div>
    </div>
  );
}
