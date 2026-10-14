import { CalendarClock, CalendarX, Clock, HardDriveDownload } from 'lucide-react';

// Keep the existing barrel exports, but describe manifest events, never job states.
export const STATUS_VARIANT = {
  created: 'neutral',
  downloaded: 'info',
  expires: 'neutral',
  expired: 'warning',
} as const;

export const STATUS_ICON = {
  created: Clock,
  downloaded: HardDriveDownload,
  expires: CalendarClock,
  expired: CalendarX,
} as const;

export const STATUS_COLOR = {
  created: 'var(--text-secondary)',
  downloaded: 'var(--semantic-info)',
  expires: 'var(--text-secondary)',
  expired: 'var(--semantic-warning)',
} as const;
