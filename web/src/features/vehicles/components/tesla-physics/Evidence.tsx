import type { ReactNode } from 'react';
import { Accordion, DataTable, GlassPanel, PanelTitle, Text, useTableExpansion, type Column, type MobileDataTablePresentation } from '@/components/ui';
import type { Translate } from './PhysicsPageShell';
import { pagination } from './PhysicsPageShell';

export function Evidence({ title, honesty, children }: { title: string; honesty?: string; children: ReactNode }) {
  return <GlassPanel className="space-y-4 p-4 sm:p-6">
    <PanelTitle>{title}</PanelTitle>
    {honesty && <Text as="p" variant="caption">{honesty}</Text>}
    {children}
  </GlassPanel>;
}

export function RawRows<T>({ title, rows, columns, tableId, keyExtractor, mobileColumns, mobilePresentation, t, disclosureLabel, description }: {
  title: string; rows: T[]; columns: Column<T>[]; tableId: string;
  keyExtractor: (row: T) => string; mobileColumns?: string[]; t: Translate;
  disclosureLabel?: string; description?: string;
  mobilePresentation?: MobileDataTablePresentation<T>;
}) {
  const { expandedKeys, setExpandedKeys } = useTableExpansion();
  return <Accordion headerClassName="min-h-11" title={disclosureLabel ?? t('teslaOnly.workbench.inspectRaw', 'Inspect raw evidence: {{title}} ({{count}} rows)', { title, count: rows.length })}>
    <Text as="p" variant="caption">{description ?? t('teslaOnly.workbench.rawCaution', 'Rows are the returned, bounded observations, not a complete lifetime stream. Open only when you need timestamps or individual readings.')}</Text>
    <DataTable tableId={tableId} columns={columns} mobileColumns={mobileColumns} mobilePresentation={mobilePresentation} data={rows}
      className="[&_button]:max-md:min-h-11 [&_button]:max-md:min-w-11"
      expandable={!mobilePresentation} expandedKeys={expandedKeys} onExpandedChange={setExpandedKeys}
      renderExpanded={(row) => <dl className="min-w-0 space-y-3">
        {columns.map((column) => <div key={column.key} className="min-w-0 space-y-1 break-words">
          <Text as="dt" variant="caption">{column.header}</Text>
          <Text as="dd" variant="body">{column.render(row) ?? '—'}</Text>
        </div>)}
      </dl>}
      keyExtractor={keyExtractor} emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')} pagination={pagination} />
  </Accordion>;
}
