import { useMemo, type ReactNode } from 'react';
import { buildTableFilterValues, DataTableValueFilter, selectedTableValueKeys } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDriveGridValues, type DriveGridScope } from '@/api/hooks/useDriveGrid';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DriveValueColumn, DriveValueSelection } from './driveGridValues';

export function DriveEvidenceValueFilter({ vehicleId, scope, field, selection, labelFor, condition,
  conditionActive, conditionLabel, invalid, valuesEnabled, onChange }: {
  vehicleId: number;
  scope: DriveGridScope;
  field: DriveValueColumn;
  selection: DriveValueSelection | undefined;
  labelFor: (value: string | number | null) => string;
  condition?: ReactNode;
  conditionActive?: boolean;
  conditionLabel: string;
  invalid: boolean;
  valuesEnabled: boolean;
  onChange: (values: string[] | null, available: string[]) => void;
}) {
  const { locale, precision } = useNumberFormatting();
  const query = useDriveGridValues(vehicleId, scope, field, locale, precision, valuesEnabled);
  const state = useDataState(query, { provenance: 'historical' });
  const options = useMemo(() => buildTableFilterValues(state.data ?? [], row => row.value,
    (_, row) => labelFor(row.value), row => row.count), [state.data, labelFor]);
  const available = options.flatMap(option => option.keys ?? [option.value]);
  return (
    <>
      <StaleRefreshWarning state={state} />
      <DataTableValueFilter
        options={options}
        selected={selectedTableValueKeys(selection, available)}
        onChange={values => onChange(values, available)}
        condition={condition}
        conditionActive={conditionActive}
        conditionLabel={conditionLabel}
        invalid={invalid}
        valuesStatus={!valuesEnabled ? <></> : state.fatalError ? <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
          : state.status === 'initial' ? <Skeleton className="h-24" /> : undefined}
      />
    </>
  );
}
