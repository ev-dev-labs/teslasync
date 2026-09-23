import type { ReactNode } from 'react';
import { Accordion, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import type { Translate } from './PhysicsPageShell';
import { pagination } from './PhysicsPageShell';

export function Evidence({ title, honesty, children }: { title: string; honesty?: string; children: ReactNode }) {
  return <GlassPanel className="space-y-4 p-4 sm:p-6">
    <PanelTitle>{title}</PanelTitle>
    {honesty && <Text as="p" variant="caption">{honesty}</Text>}
    {children}
  </GlassPanel>;
}

export function RawRows<T>({ title, rows, columns, tableId, keyExtractor, mobileColumns, t, disclosureLabel, description }: {
  title: string; rows: T[]; columns: Column<T>[]; tableId: string;
  keyExtractor: (row: T) => string; mobileColumns?: string[]; t: Translate;
  disclosureLabel?: string; description?: string;
}) {
  return <Accordion title={disclosureLabel ?? t('teslaOnly.workbench.inspectRaw', 'Inspect raw evidence: {{title}} ({{count}} rows)', { title, count: rows.length })}>
    <Text as="p" variant="caption">{description ?? t('teslaOnly.workbench.rawCaution', 'Rows are the returned, bounded observations, not a complete lifetime stream. Open only when you need timestamps or individual readings.')}</Text>
    <DataTable tableId={tableId} columns={columns} mobileColumns={mobileColumns} data={rows}
      keyExtractor={keyExtractor} emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')} pagination={pagination} />
  </Accordion>;
}
