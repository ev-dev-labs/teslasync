import { useTranslation } from 'react-i18next';
import { ComboboxMulti } from '@/components/forms';
import { SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { useSignals } from '@/api/hooks/useTelemetry';

export interface SignalPickerProps {
  vehicleId: number;
  selected: string[];
  onChange: (signals: string[]) => void;
}

/**
 * Signal-name picker for reconstruction. Options come from the vehicle's
 * own dynamic signal catalog (`useSignals`) — this feature never hardcodes
 * Tesla signal names, matching the rest of the app's telemetry pages.
 */
export function SignalPicker({ vehicleId, selected, onChange }: SignalPickerProps) {
  const { t } = useTranslation();
  const signalsQuery = useSignals(vehicleId);
  const options = signalsQuery.data ?? [];
  const source = deriveDataState(signalsQuery);

  return (
    <div className="min-w-0 space-y-2">
    <ComboboxMulti
      value={selected}
      onChange={onChange}
      options={options}
      getOptionLabel={(s) => s}
      getOptionKey={(s) => s}
      label={t('dashcam.reconstruction.signalPickerLabel', 'Telemetry signals to align')}
      placeholder={t('dashcam.reconstruction.signalPickerPlaceholder', 'Search signals…')}
      loading={signalsQuery.isLoading && !source.hasData}
    />
    <SourceContent
      state={source.fatalError ? 'error' : source.refreshError ? 'retained'
        : source.hasData && options.length === 0 ? 'empty' : 'ready'}
      label={t('dashcam.reconstruction.signalPickerLabel', 'Telemetry signals to align')}
      error={source.fatalError}
      errorMessage={t('dashcam.reconstruction.signalCatalogFailed', 'The telemetry signal catalog could not be loaded.')}
      emptyMessage={t('dashcam.reconstruction.noSignals', 'No telemetry signals are available for this vehicle.')}
      errorRecovery={{ onRetry: () => { void signalsQuery.refetch(); } }}
    >
      {null}
    </SourceContent>
    </div>
  );
}
