import { useTranslation } from 'react-i18next';
import { Energy } from '@/components/data-display';
import { Badge, DataTable, GlassPanel, PanelTitle, Text, useSortToggle, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { PREVIEW_JOURNEYS, type PreviewJourney } from './fixtures';

export default function PreviewTable() {
  const { t } = useTranslation('settings');
  const { formatDistance } = useUnits();
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('distance_m');
  const names: Record<PreviewJourney['route'], string> = {
    harbor: t('theme.appDesignPreview.harbor', 'Harbor loop'),
    park: t('theme.appDesignPreview.park', 'Park pause'),
    studio: t('theme.appDesignPreview.studio', 'Studio connection'),
    library: t('theme.appDesignPreview.library', 'Library visit'),
    market: t('theme.appDesignPreview.market', 'Market loop'),
    garden: t('theme.appDesignPreview.garden', 'Garden visit'),
  };
  const complete = t('theme.appDesignPreview.complete', 'Complete');
  const partial = t('theme.appDesignPreview.partial', 'Partial');
  const columns: Column<PreviewJourney>[] = [
    { key: 'route', header: t('theme.appDesignPreview.journey', 'Sample journey'), sortable: true,
      render: row => names[row.route], filterValue: row => names[row.route], required: true },
    { key: 'distance_m', header: t('theme.appDesignPreview.distance', 'Distance'), sortable: true,
      render: row => formatDistance(row.distance_m), align: 'right' },
    { key: 'energy_wh', header: t('theme.appDesignPreview.energy', 'Energy'), sortable: true,
      render: row => row.energy_wh != null ? <Energy wh={row.energy_wh} /> : '—', align: 'right' },
    { key: 'completeness', header: t('theme.appDesignPreview.quality', 'Source quality'),
      filterValue: row => row.completeness === 'complete' ? complete : partial,
      render: row => <Badge variant={row.completeness === 'complete' ? 'success' : 'warning'}>
        {row.completeness === 'complete' ? complete : partial}</Badge> },
  ];
  const rows = sortFn(PREVIEW_JOURNEYS, (row, key) => key === 'route' ? names[row.route]
    : key === 'energy_wh' ? row.energy_wh ?? Number.NEGATIVE_INFINITY : row.distance_m);
  return (
    <GlassPanel data-preview-section="table" className="min-w-0 space-y-4 p-4">
      <PanelTitle>{t('theme.appDesignPreview.table', 'Sample journey ledger')}</PanelTitle>
      <Text variant="bodySm">{t('theme.appDesignPreview.tableHelp', 'Sort columns, search these six loaded rows, filter source quality and change pages. A dash means unknown; zero remains zero.')}</Text>
      <DataTable tableId="settings:app-design-preview" caption={t('theme.appDesignPreview.table', 'Sample journey ledger')}
        columns={columns} data={rows} keyExtractor={row => row.id}
        sortKey={sortKey} sortDir={sortDir} onSort={onSort} enableValueFilters
        pagination={{ defaultPageSize: 3, pageSizeOptions: [3] }} mobileColumns={['route', 'distance_m', 'energy_wh', 'completeness']}
        columnVisibility={false} resizable={false} columnReorder={false} exportable={false}
        showDensityControl={false} noMatchMessage={t('theme.appDesignPreview.noRows', 'No sample journeys match.')} />
    </GlassPanel>
  );
}
