import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLogStream, type LogStreamEvent, type LogStreamLevel, type UseLogStreamOptions } from '@/api/hooks/useLogStream';
import { type NeonColor } from '@/lib/tokens';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { LEVEL_OPTIONS, parseCanonicalVehicleId, deriveAiVehicleScope, extractVehicleId, downloadFilename, eventToText } from '../components/structural-closure/live-logs/helpers';

export interface LiveLogsPageProps {
  /** Test seam — replace fetch in unit tests. */
  fetchImpl?: UseLogStreamOptions['fetchImpl'];
  /** Test seam — point at a stub server. */
  endpoint?: string;
}


export function useLiveLogsPage({ fetchImpl, endpoint }: LiveLogsPageProps = {}) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('liveLogs.title', 'Live logs'));

  const levelLabel = useCallback((value: string | null | undefined) => {
    const option = LEVEL_OPTIONS.find((option) => option.value === value);
    return option ? t(option.i18nKey, option.defaultLabel) : value ?? '—';
  }, [t]);

  const [level, setLevel] = useState<LogStreamLevel>('info');
  const [grep, setGrep] = useState('');
  const [grepDraft, setGrepDraft] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [inspectedEvent, setInspectedEvent] = useState<LogStreamEvent | null>(null);

  useEffect(() => {
    setVehicleFilter(vehicleId == null ? '' : String(vehicleId));
  }, [vehicleId]);

  // commitVehicleFilter is the ONLY path that turns typed filter text
  // into a real, committed vehicle selection. It gates on
  // {@link parseCanonicalVehicleId} (canonical digit-string shape,
  // checked BEFORE any Number conversion) rather than a bare
  // `Number(text)` parse, so a non-canonical draft like `"1e2"`
  // (scientific notation), `"1.5"` (fractional), `"+7"` (signed), or
  // `"007"` (leading zero — see parseCanonicalVehicleId's doc for why
  // that is rejected too) can never commit, no matter what numeric
  // value it would coincidentally evaluate to.
  const commitVehicleFilter = useCallback(() => {
    const parsed = parseCanonicalVehicleId(vehicleFilter);
    if (parsed == null) return;
    const isKnownVehicle = vehicles.some((candidate) => candidate.id === parsed);
    if (isKnownVehicle && parsed !== vehicleId) {
      setVehicleId(parsed);
    }
  }, [setVehicleId, vehicleFilter, vehicleId, vehicles]);

  const stream = useLogStream({
    level,
    grep,
    enabled,
    paused,
    fetchImpl,
    endpoint,
  });

  const grepPattern = useMemo<RegExp | null>(() => {
    if (grep.trim().length === 0) return null;
    try {
      return new RegExp(grep, 'i');
    } catch {
      return null;
    }
  }, [grep]);

  const filteredEvents = useMemo(() => {
    if (vehicleFilter.trim().length === 0) return stream.events;
    const needle = vehicleFilter.trim();
    return stream.events.filter((ev) => extractVehicleId(ev.parsed) === needle);
  }, [stream.events, vehicleFilter]);

  // Compute the AI summarization window from the current buffer.
  // Newest event time backward by 30 minutes, or the current time
  // minus 30 minutes when the buffer is empty. Both bounds in
  // Unix seconds (the AI handler validates positive int64 seconds).
  const { aiFromUnix, aiToUnix } = useMemo(() => {
    const windowSeconds = 30 * 60;
    const newestMs = stream.events.length > 0
      ? stream.events[stream.events.length - 1]?.receivedAt ?? Date.now()
      : Date.now();
    const toUnix = Math.floor(newestMs / 1000);
    const fromUnix = toUnix - windowSeconds;
    return { aiFromUnix: fromUnix, aiToUnix: toUnix };
  }, [stream.events]);

  // aiVehicleId is the vehicle scope handed to AILogTraceSummarization.
  // See {@link deriveAiVehicleScope} for the full rationale: it tracks
  // the committed/validated vehicleId (never the raw draft text) so
  // in-progress typing can never broaden scope, send a fractional/
  // unknown id, or abort/reset an active or completed AI summary.
  const aiVehicleId = useMemo(
    () => deriveAiVehicleScope(vehicleFilter, vehicleId, vehicles),
    [vehicleFilter, vehicleId, vehicles],
  );

  // Find the scrollable container the DataTable renders inside so we
  // can pin the view to the bottom when autoscroll is on. The
  // virtualized DataTable wraps its rows in an element that scrolls;
  // we identify it by the data-testid we set on the table wrapper.
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoscroll) return;
    const el = tableWrapRef.current?.querySelector<HTMLDivElement>(
      '[data-table-scroll-container="true"]',
    );
    const target = el ?? tableWrapRef.current;
    if (target) {
      target.scrollTop = target.scrollHeight;
    }
  }, [autoscroll, filteredEvents.length]);

  const applyGrep = useCallback(() => {
    setGrep(grepDraft);
  }, [grepDraft]);

  const handleClear = useCallback(() => {
    stream.clear();
  }, [stream]);

  const handleReconnect = useCallback(() => {
    setEnabled(false);
    // Defer to the next tick so React processes the unmount-style
    // tear-down before we ask for a fresh connection.
    queueMicrotask(() => setEnabled(true));
  }, []);

  const handleDownload = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const filename = downloadFilename(
      t('liveLogs.filename', { ts: '{{ts}}' }),
    );
    const body = filteredEvents.map(eventToText).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredEvents, t]);

  // Connection state → neon hue for the status KPI icon chip. Color is
  // never the only signal — the ConnectionBadge carries text + a dot too.
  const statusColor: NeonColor = stream.error
    ? 'red'
    : !enabled
      ? 'amber'
      : !stream.isConnected
        ? 'blue'
        : paused
          ? 'amber'
          : 'green';


  return {
    fmtInt, t, levelLabel, level, setLevel, grep, grepDraft, setGrepDraft, vehicleFilter, setVehicleFilter, vehicleId, vehicles, paused, setPaused, autoscroll, setAutoscroll, enabled, inspectedEvent, setInspectedEvent, commitVehicleFilter, stream, grepPattern, filteredEvents, aiFromUnix, aiToUnix, aiVehicleId, tableWrapRef, applyGrep, handleClear, handleReconnect, handleDownload, statusColor
  };
}
