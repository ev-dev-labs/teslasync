import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout';
import { Badge, Caption, DataTable, Text, type Column } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { FleetTelemetryCategoryCoverage, FleetTelemetryFieldCoverage } from '@/api/types';

interface CoverageCategoryProps {
  category: FleetTelemetryCategoryCoverage;
  filter: string;
}

export function CoverageCategory({ category, filter }: CoverageCategoryProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const fields = category.fields ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(field =>
      field.field.toLowerCase().includes(q) ||
      field.destination.toLowerCase().includes(q) ||
      (field.column ?? '').toLowerCase().includes(q),
    );
  }, [fields, filter]);
  const destinations = Object.entries(category.destinations ?? {}).sort((a, b) => b[1] - a[1]);
  const columns = useMemo<Column<FleetTelemetryFieldCoverage>[]>(() => [
    {
      key: 'field',
      filterValue: row => row.field ?? null,
      header: t('coverage.col.field', 'Field'),
      sortable: true,
      render: row => <Text as="span" mono size="sm" color="primary" className="break-words">{row.field}</Text>,
    },
    {
      key: 'destination',
      filterValue: row => row.destination ?? null,
      header: t('coverage.col.destination', 'Destination'),
      sortable: true,
      render: row => <Badge variant="info" size="sm">{row.destination}</Badge>,
    },
    {
      key: 'column',
      filterValue: row => row.column ?? null,
      header: t('coverage.col.column', 'Column'),
      sortable: true,
      render: row => row.column
        ? <Text as="span" mono size="xs" color="secondary" className="break-words">{row.column}</Text>
        : <Text as="span" size="xs" color="muted">—</Text>,
    },
    {
      key: 'also_signal_log',
      filterValue: row => row.also_signal_log ?? null,
      header: t('coverage.col.dualWrite', 'Dual write'),
      render: row => row.also_signal_log
        ? <Badge variant="warning" size="sm">{t('coverage.dualWrite.yes', 'signal_log')}</Badge>
        : <Text as="span" size="xs" color="muted">—</Text>,
    },
    {
      key: 'subscribed',
      filterValue: row => row.subscribed ?? null,
      filterValueLabel: (_value, row) => row.subscribed == null ? '—' : row.subscribed
        ? t('coverage.subscribed.yes', 'yes')
        : t('coverage.subscribed.no', 'no'),
      header: t('coverage.col.subscribed', 'Subscribed'),
      sortable: true,
      render: row => row.subscribed
        ? <Badge variant="success" size="sm">{t('coverage.subscribed.yes', 'yes')}</Badge>
        : <Badge variant="neutral" size="sm">{t('coverage.subscribed.no', 'no')}</Badge>,
    },
  ], [t]);

  return (
    <div className="h-full min-w-0" data-testid={`coverage-category-${category.category}`}>
      <LayoutCard title={category.category}>
        <Caption>
          {t('coverage.category.totalFields', '{{count}} routed fields', { count: category.total_fields ?? 0 })}
        </Caption>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {destinations.map(([destination, count]) => (
              <Badge
                key={destination}
                variant="neutral"
                size="sm"
                className="max-w-full whitespace-normal break-all"
                data-testid={`coverage-cat-dest-${category.category}-${destination}`}
              >
                {destination}: {fmtInt(count)}
              </Badge>
            ))}
          </div>
        {filtered.length === 0 ? (
          <Text as="p" size="sm" color="muted" className="italic">
            {t('coverage.category.noMatch', 'No fields match the current filter.')}
          </Text>
        ) : (
          <div data-testid={`coverage-fields-${category.category}`}>
            <DataTable<FleetTelemetryFieldCoverage>
              tableId={`coverage:fields:${category.category}`}
              data={filtered}
              enableValueFilters
              filterData={fields}
              columns={columns}
              mobileColumns={['field', 'destination', 'subscribed']}
              keyExtractor={row => `${category.category}:${row.field}`}
              emptyMessage={t('coverage.category.empty', 'This category has no routed fields.')}
            />
          </div>
        )}
      </LayoutCard>
    </div>
  );
}
