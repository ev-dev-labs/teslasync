import { useTranslation } from 'react-i18next';
import { Waypoints } from 'lucide-react';
import { GlassPanel, PanelTitle, Select } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { ROOT_CAUSE_WINDOW_HOUR_PRESETS } from '../hooks/useRootCauseWorkspace';

/** Fallback English label for each fixed window-hour preset. Keyed by the
 *  numeric hour value so a new preset can't silently render as "undefined". */
const WINDOW_LABEL_FALLBACK: Record<number, string> = {
  24: 'Last 24 hours',
  72: 'Last 3 days',
  168: 'Last 7 days',
  720: 'Last 30 days',
};

export interface SignalWindowPickerProps {
  catalog: string[];
  signalsLoading: boolean;
  signalsError: unknown;
  onRetrySignals: () => void;
  focalSignal: string;
  onFocalSignalChange: (signal: string) => void;
  windowHours: number;
  onWindowHoursChange: (hours: number) => void;
  className?: string;
}

/**
 * Shared focal-signal + analysis-window selector panel.
 *
 * Both `RootCauseIntelligencePage` and `ServiceEvidencePackPage` need the
 * exact same picker wired to the same `useRootCauseWorkspace` state, so it
 * lives here rather than being duplicated per page. Always renders its own
 * panel shell (loading / error / empty / content) so callers never need to
 * gate the whole page around the signal catalog query.
 */
export function SignalWindowPicker({
  catalog,
  signalsLoading,
  signalsError,
  onRetrySignals,
  focalSignal,
  onFocalSignalChange,
  windowHours,
  onWindowHoursChange,
  className,
}: SignalWindowPickerProps) {
  const { t } = useTranslation();

  const signalOptions = catalog.map((name) => ({ value: name, label: name }));
  const windowOptions = ROOT_CAUSE_WINDOW_HOUR_PRESETS.map((hours) => ({
    value: String(hours),
    label: t(`rootCauseIntelligence.picker.window.h${hours}`, WINDOW_LABEL_FALLBACK[hours] ?? `${hours}h`),
  }));

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Waypoints className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('rootCauseIntelligence.picker.title', 'Choose a Signal to Investigate')}
      </PanelTitle>
      {signalsError ? (
        <QueryError error={signalsError} onRetry={onRetrySignals} />
      ) : signalsLoading ? (
        <Skeleton height={96} />
      ) : catalog.length === 0 ? (
        <EmptyState /* no-action: signals appear as the telemetry stream reports them for this vehicle. */
          icon={<Waypoints className="h-8 w-8" />}
          message={t('rootCauseIntelligence.picker.noSignals', 'No telemetry signals have been recorded for this vehicle yet.')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('rootCauseIntelligence.picker.focalLabel', 'Focal signal')}
            options={signalOptions}
            value={focalSignal}
            onChange={(e) => onFocalSignalChange(e.target.value)}
            placeholder={t('rootCauseIntelligence.picker.focalPlaceholder', 'Choose a signal')}
            hint={t('rootCauseIntelligence.picker.focalHint', 'The signal whose shift you want evidence-ranked hypotheses for.')}
          />
          <Select
            label={t('rootCauseIntelligence.picker.windowLabel', 'Analysis window')}
            options={windowOptions}
            value={String(windowHours)}
            onChange={(e) => onWindowHoursChange(Number(e.target.value))}
          />
        </div>
      )}
    </GlassPanel>
  );
}
