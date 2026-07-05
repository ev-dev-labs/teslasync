import { useCallback, useEffect, useMemo, useState } from 'react';
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
 * Minimum query length before the upstream geocoder is queried. Mirrors the
 * `enabled` guard inside {@link useGeocodeSearch} so the loading affordance
 * and the actual request agree on when a search is "live".
 */
const MIN_QUERY_LENGTH = 3;

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
      // Combobox fires `onChange(null)` on clear / free-text commit; guard so
      // the parent's coordinate callback only runs for a real suggestion.
      if (!result) return;
      onChange(result.display_name);
      onSelect({ lat: result.lat, lng: result.lng, name: result.display_name });
    },
    [onChange, onSelect],
  );

  // Surface the loading affordance for the entire "a search is coming" window,
  // not just while the network request is in flight. Between a keystroke and
  // the 400ms debounce settling, `debouncedQuery` still lags `value`, so the
  // request has not fired yet — without covering that gap the dropdown flashes
  // a misleading "No results" for up to 400ms before the spinner appears.
  const trimmedQuery = value.trim();
  const debouncePending = trimmedQuery !== debouncedQuery.trim();
  const loading =
    (isLoading || debouncePending) && trimmedQuery.length >= MIN_QUERY_LENGTH;

  // Stabilise the option list + accessors so the Combobox's internal
  // filter/render memoisation is not invalidated on every parent keystroke.
  const options = useMemo(() => results ?? [], [results]);
  const getOptionLabel = useCallback((r: GeocodeResult) => r.display_name, []);
  const getOptionKey = useCallback(
    (r: GeocodeResult) => `${r.lat}-${r.lng}-${r.display_name}`,
    [],
  );
  const icon = useMemo(
    () => <MapPin className="h-4 w-4" aria-hidden="true" />,
    [],
  );
  const renderOption = useCallback(
    (r: GeocodeResult) => (
      <span className="flex items-start gap-2">
        <MapPin
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <span className="line-clamp-2">{r.display_name}</span>
      </span>
    ),
    [],
  );

  return (
    <Combobox<GeocodeResult>
      label={label ?? t('addressInput.label', 'Address')}
      hideLabel={!label}
      placeholder={placeholder}
      icon={icon}
      noChevron
      noClearButton
      value={null}
      onChange={handleSelect}
      inputValue={value}
      onInputChange={onChange}
      options={options}
      getOptionLabel={getOptionLabel}
      getOptionKey={getOptionKey}
      loading={loading}
      maxVisibleOptions={5}
      allowFreeText
      renderOption={renderOption}
    />
  );
}
