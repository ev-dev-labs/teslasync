import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Button as ControlButton, Input as ControlInput } from '@/components/ui';
import { Spinner } from '@/components/feedback';
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

export function AddressInput({ value, onChange, onSelect, placeholder, label }: AddressInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce the search query (400ms)
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(timerRef.current);
  }, [value]);

  const { data: results, isLoading } = useGeocodeSearch(debouncedQuery, isOpen);
  const suggestions = useMemo(() => results ?? [], [results]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback((result: GeocodeResult) => {
    onChange(result.display_name);
    onSelect({ lat: result.lat, lng: result.lng, name: result.display_name });
    setIsOpen(false);
  }, [onChange, onSelect]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-xs font-medium text-white/60 mb-1">{label}</label>
      )}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        <ControlInput
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="pl-9"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner className="h-4 w-4" />
          </div>
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-xl max-h-60 overflow-y-auto">
          {suggestions.map((result, idx) => (
            <ControlButton
              key={`${result.lat}-${result.lng}-${idx}`}
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-2 text-left text-sm font-normal text-white/80 hover:bg-white/5"
              onClick={() => handleSelect(result)}
            >
              <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-white/40" />
              <span className="line-clamp-2">{result.display_name}</span>
            </ControlButton>
          ))}
        </div>
      )}
    </div>
  );
}
