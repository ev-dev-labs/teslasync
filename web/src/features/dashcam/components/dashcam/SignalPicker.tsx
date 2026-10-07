import { useTranslation } from 'react-i18next';
import { ComboboxMulti } from '@/components/forms';
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

  return (
    <ComboboxMulti
      value={selected}
      onChange={onChange}
      options={options}
      getOptionLabel={(s) => s}
      getOptionKey={(s) => s}
      label={t('dashcam.reconstruction.signalPickerLabel', 'Telemetry signals to align')}
      placeholder={t('dashcam.reconstruction.signalPickerPlaceholder', 'Search signals…')}
    />
  );
}
