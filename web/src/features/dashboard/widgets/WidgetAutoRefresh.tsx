import { useEffect, useRef } from 'react';
import { useRefreshInterval } from '@/hooks/useRefreshPolicy';

interface WidgetAutoRefreshProps {
  intervalMs: number;
  paused: boolean;
  onRefresh: () => void;
}

export function WidgetAutoRefresh({ intervalMs, paused, onRefresh }: WidgetAutoRefreshProps) {
  const interval = useRefreshInterval(intervalMs, { enabled: !paused });
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (interval === false) return;
    const timer = window.setInterval(() => refreshRef.current(), interval);
    return () => window.clearInterval(timer);
  }, [interval]);

  return null;
}
