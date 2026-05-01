import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface SearchInputProps {
  /** Current committed value (controlled). */
  value: string;
  /** Called with the new value once the debounce window elapses. */
  onChange: (value: string) => void;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Debounce window in milliseconds. Defaults to 250ms. */
  debounceMs?: number;
  /** Auto-focus the field on mount. */
  autoFocus?: boolean;
  /** Optional class applied to the outer wrapper (use for sizing). */
  className?: string;
  /** Optional accessible label for the clear button. */
  clearLabel?: string;
}

/**
 * Debounced search input with leading magnifier icon and trailing clear button.
 *
 * The `value` prop is controlled by the parent. Local typing state is buffered
 * until `debounceMs` elapses, then `onChange` fires with the latest text. The
 * clear button immediately resets to an empty string and emits `onChange('')`.
 *
 * Rendered as a wrapper around the shared `<Input>` component using its `icon`
 * and `suffix` slots so styling stays consistent with other form fields.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  debounceMs = 250,
  autoFocus,
  className,
  clearLabel,
}: SearchInputProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);

  // Re-sync from the parent if the controlled value changes externally
  // (e.g. consumer resets the filter).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce: only emit onChange once the user stops typing for `debounceMs`.
  useEffect(() => {
    if (local === value) return;
    const id = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(id);
  }, [local, value, debounceMs, onChange]);

  const handleClear = useCallback(() => {
    setLocal('');
  }, []);

  const label = clearLabel ?? t('common.clear', 'Clear');

  return (
    <div className={cn(className)}>
      <Input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        icon={<Search className="h-4 w-4" aria-hidden />}
        suffix={local ? (
          <button
            type="button"
            onClick={handleClear}
            className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={label}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : undefined}
      />
    </div>
  );
}
