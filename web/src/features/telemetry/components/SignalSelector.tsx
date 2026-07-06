/**
 * SignalSelector — `ComboboxMulti` wrapper specialised for signal names.
 *
 * Adds the standard "Signals" label, search icon, mono font option
 * rendering, the layer-help tooltip, and the optional cap (defaults to
 * 5 to keep the chart legible). Used everywhere a signal multi-select
 * appears so all surfaces stay consistent.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { ComboboxMulti } from '@/components/forms';
import { HelpTooltip, Label } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface SignalSelectorProps {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Hard cap. Defaults to 5. Pass `null` for no cap. */
  max?: number | null;
  /** Show the layer-help tooltip next to the label. Default true. */
  showLayerHelp?: boolean;
  /** Override the label (defaults to "Signals (N / max)"). */
  labelOverride?: string;
  className?: string;
}

export function SignalSelector({
  options,
  value,
  onChange,
  max = 5,
  showLayerHelp = true,
  labelOverride,
  className,
}: SignalSelectorProps) {
  const { t } = useTranslation();
  const cap = max ?? Number.POSITIVE_INFINITY;

  // Null-safe: this selector is handed hook data everywhere it appears
  // (`useSignalsAvailable(...).data`, a not-yet-initialised selection), which is
  // `undefined` before the first load. Never read `.length` off — or hand
  // ComboboxMulti — a possibly-undefined list. Memoised so the empty-fallback
  // keeps a stable reference across renders instead of a fresh `[]` each time.
  const safeValue = useMemo(() => value ?? [], [value]);
  const safeOptions = useMemo(() => options ?? [], [options]);

  // Enforce the cap on the way out. ComboboxMulti already blocks additions past
  // `maxItems`, but slicing here also trims an over-long incoming `value` the
  // first time the user edits it. Stable identity avoids re-rendering the
  // combobox when an unrelated parent state change re-runs this component.
  const handleChange = useCallback(
    (next: string[]) => onChange(Number.isFinite(cap) ? next.slice(0, cap) : next),
    [onChange, cap],
  );

  return (
    <div className={cn('w-full', className)}>
      <Label className="flex items-center gap-1 mb-2">
        {labelOverride ??
          (max != null
            ? `${t('Signals')} (${safeValue.length} / ${max})`
            : `${t('Signals')} (${safeValue.length})`)}
        {showLayerHelp ? (
          <HelpTooltip
            i18nKey="help.signal.layers"
            defaultValue="TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history)."
            ariaLabel={t('help.signal.layers.aria', { defaultValue: 'More info about signal layers (L1, L2, log)' })}
            placement="bottom"
          />
        ) : null}
      </Label>
      <ComboboxMulti<string>
        label={t('Signals')}
        hideLabel
        placeholder={t('Search signals…')}
        icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
        value={safeValue}
        onChange={handleChange}
        options={safeOptions}
        getOptionLabel={(s) => s}
        getOptionKey={(s) => s}
        maxItems={Number.isFinite(cap) ? (cap as number) : undefined}
        renderOption={(s) => <span className="font-mono text-xs">{s}</span>}
      />
    </div>
  );
}
