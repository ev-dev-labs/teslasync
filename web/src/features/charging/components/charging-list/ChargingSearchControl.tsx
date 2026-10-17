import { useTranslation } from 'react-i18next';
import { SearchInput } from '@/components/forms/SearchInput';

interface ChargingSearchControlProps {
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
}

export function ChargingSearchControl({ value, onChange, pending }: ChargingSearchControlProps) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full sm:w-72">
      <SearchInput
        value={value}
        onChange={onChange}
        placeholder={t('charging.searchPlaceholder', 'Search charging — try "charger:home", "cost:>5", "kwh:>20", "Costco"')}
        className="w-full"
        historyScope="charging"
      />
      {pending && (
        <span
          role="status"
          aria-live="polite"
          aria-label={t('filter.pending', 'Filtering…')}
          className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 inline-block h-3 w-3 rounded-full border-2 border-cyan-400/40 border-t-cyan-400 animate-spin"
        />
      )}
    </div>
  );
}
