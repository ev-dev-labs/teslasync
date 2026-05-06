import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@/components/forms';
import { useGeocodeSearch } from '@/api/hooks/useDriving';
import { MapPin } from 'lucide-react';
import type { GeocodeResult, TripLocation } from '@/types/driving';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (location: TripLocation) => void;
  placeholder?: string;
  label?: string;
}

/**
 * Geocoded address input — wraps the shared {@link Combobox} primitive
 * with the trip-planner's address autocomplete behaviour. The parent
 * owns the raw text via `value` / `onChange`; selecting a suggestion
 * additionally fires `onSelect` with the resolved coordinates.
 */
export function AddressInput({ value, onChange, onSelect, placeholder, label }: AddressInputProps) {
  const { t } = useTranslation();
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce typed input → geocode-search query (400ms) so we don't
  // hammer the upstream geocoder on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(id);
  }, [value]);

  const { data: results, isLoading } = useGeocodeSearch(debouncedQuery);

  const handleSelect = useCallback(
    (result: GeocodeResult | null) => {
      if (!result) return;
      onChange(result.display_name);
      onSelect({ lat: result.lat, lng: result.lng, name: result.display_name });
    },
    [onChange, onSelect],
  );

  return (
    <Combobox<GeocodeResult>
      label={label ?? t('addressInput.label', 'Address')}
      hideLabel={!label}
      placeholder={placeholder}
      icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
      noChevron
      noClearButton
      value={null}
      onChange={handleSelect}
      inputValue={value}
      onInputChange={onChange}
      options={results ?? []}
      getOptionLabel={(r) => r.display_name}
      getOptionKey={(r) => `${r.lat}-${r.lng}-${r.display_name}`}
      loading={isLoading && debouncedQuery.length >= 3}
      maxVisibleOptions={5}
      allowFreeText
      renderOption={(r) => (
        <span className="flex items-start gap-2">
          <MapPin
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <span className="line-clamp-2">{r.display_name}</span>
        </span>
      )}
    />
  );
}
