import { Download, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Toggle } from '@/components/ui';
import type { useLiveLogsPage } from '../../../hooks/useLiveLogsPage';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsToolbar({ controller }: Props) {
  const { t, paused, setPaused, autoscroll, setAutoscroll, filteredEvents, handleClear, handleReconnect, handleDownload } = controller;

  return (
<div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Toggle
        label={t('liveLogs.controls.autoscroll', 'Auto-scroll')}
        checked={autoscroll}
        onChange={setAutoscroll}
        size="sm"
        data-testid="livelogs-autoscroll-toggle"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setPaused((p) => !p)}
        icon={
          paused ? (
            <Play className="h-4 w-4" aria-hidden />
          ) : (
            <Pause className="h-4 w-4" aria-hidden />
          )
        }
        data-testid="livelogs-pause-button"
      >
        {paused
          ? t('liveLogs.controls.resume', 'Resume')
          : t('liveLogs.controls.pause', 'Pause')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClear}
        icon={<Trash2 className="h-4 w-4" aria-hidden />}
        data-testid="livelogs-clear-button"
      >
        {t('liveLogs.controls.clear', 'Clear buffer')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDownload}
        disabled={filteredEvents.length === 0}
        icon={<Download className="h-4 w-4" aria-hidden />}
        data-testid="livelogs-download-button"
      >
        {t('liveLogs.controls.download', 'Download visible (.txt)')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleReconnect}
        icon={<RefreshCw className="h-4 w-4" aria-hidden />}
        data-testid="livelogs-reconnect-button"
      >
        {t('liveLogs.controls.reconnect', 'Reconnect')}
      </Button>
    </div>
  );
}
