/**
 * SignalSelector — `ComboboxMulti` wrapper specialised for signal names.
 *
 * Adds the standard "Signals" label, search icon, mono font option
 * rendering, the layer-help tooltip, and the optional cap (defaults to
 * 5 to keep the chart legible). Used everywhere a signal multi-select
 * appears so all surfaces stay consistent.
 */

import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { ComboboxMulti } from '@/components/forms';
import { HelpTooltip } from '@/components/ui';
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

  return (
    <div className={cn('w-full', className)}>
      <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider mb-2 text-[var(--text-muted)]">
        {labelOverride ?? (
          max != null
            ? `${t('Signals')} (${value.length} / ${max})`
            : `${t('Signals')} (${value.length})`
        )}
        {showLayerHelp ? (
          <HelpTooltip
            i18nKey="help.signal.layers"
            defaultValue="TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history)."
            ariaLabel={t('help.signal.layers.aria', { defaultValue: 'More info about signal layers (L1, L2, log)' })}
            placement="bottom"
          />
        ) : null}
      </span>
      <ComboboxMulti<string>
        label={t('Signals')}
        hideLabel
        placeholder={t('Search signals…')}
        icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
        value={value}
        onChange={(next) => onChange(Number.isFinite(cap) ? next.slice(0, cap) : next)}
        options={options}
        getOptionLabel={(s) => s}
        getOptionKey={(s) => s}
        maxItems={Number.isFinite(cap) ? (cap as number) : undefined}
        renderOption={(s) => <span className="font-mono text-xs">{s}</span>}
      />
    </div>
  );
}
