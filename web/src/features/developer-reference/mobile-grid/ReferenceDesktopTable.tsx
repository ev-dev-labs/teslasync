import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Text, type Column } from '@/components/ui';
import type { MobileGridCallbacks, MobileGridModel, MobileRow } from '@/components/ui/mobile-grid-reference';
import type { ReferenceRecord } from './fixtures';
import type { ReferenceFieldDefinition } from './useReferencePresentation';

interface Props {
  model: MobileGridModel;
  callbacks: MobileGridCallbacks;
  rows: ReferenceRecord[];
  definitions: readonly ReferenceFieldDefinition[];
  display: ReadonlyMap<string, MobileRow>;
  onKeys: (keys: string[]) => void;
}
/** Existing DataTable is composed unchanged; no mobile CSS reaches its DOM. */
export function ReferenceDesktopTable({ model, callbacks, rows, definitions, display, onKeys }: Props) {
  const { t } = useTranslation();
  const columns = useMemo<Column<ReferenceRecord>[]>(() => definitions.map(field => ({
    key: field.key,
    header: field.label,
    render: row => display.get(row.id)?.details.find(detail => detail.key === field.key)?.value ?? '—',
    exportValue: row => row[field.key],
    filterValue: row => row[field.key],
    sortable: field.key === 'timestamp' || field.key === 'cost_usd',
    visibleOnMobile: true,
  })), [definitions, display]);
  return (
    <>
      {model.state.kind !== 'ready' && (
        <Text role="status" className="mb-2 block">
          {t('developerReference.mobileGrid.desktop.notice', 'State examples below 640px; this unchanged shared DataTable is the desktop reference.')}
        </Text>
      )}
      <DataTable<ReferenceRecord>
        tableId={`developer-reference:${model.id}`}
        caption={model.label}
        variant="embedded"
        columns={columns}
        data={rows}
        keyExtractor={row => row.id}
        pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
        sortKey={model.sortKey === 'cost' ? 'cost_usd' : 'timestamp'}
        sortDir={model.sortKey === 'oldest' ? 'asc' : 'desc'}
        onSort={key => callbacks.onSort(key === 'cost_usd' ? 'cost' : model.sortKey === 'newest' ? 'oldest' : 'newest')}
        selectable={model.selection.enabled ? model.selection.mode : 'none'}
        selectedKeys={[...model.selection.keys]}
        onSelectionChange={keys => onKeys(keys.flatMap(key => typeof key === 'string' ? [key] : []))}
        rowLabel={row => display.get(row.id)?.title ?? row.id}
        expandable
        renderExpanded={row => (
          <Button variant="secondary" className="min-h-11" onClick={() => callbacks.onActivate(row.id)}>
            {t('developerReference.mobileGrid.desktop.details', 'Open reference details and actions')}
          </Button>
        )}
        controls={{
          search: { value: model.query, onChange: callbacks.onSearch,
            ariaLabel: t('developerReference.mobileGrid.toolbar.searchLabel', 'Search {{label}}', { label: model.label }),
            placeholder: t('developerReference.mobileGrid.toolbar.search', 'Search…') },
        }}
        toolbarActions={<Button variant="secondary" onClick={() => callbacks.onOverlay('overflow', true)}>
          {t('developerReference.mobileGrid.desktop.requests', 'Reference export requests')}
        </Button>}
        emptyMessage={t('developerReference.mobileGrid.desktop.empty', 'No matching reference rows')}
        exportable={false}
      />
    </>
  );
}
