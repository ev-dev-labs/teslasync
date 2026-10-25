import { Icons } from '@/lib/icons';


// Keep the existing barrel exports, but describe manifest events, never job states.
export const STATUS_VARIANT = {
  created: 'neutral',
  downloaded: 'info',
  expires: 'neutral',
  expired: 'warning',
} as const;

export const STATUS_ICON = {
  created: Icons.clock,
  downloaded: Icons.hardDriveDownload,
  expires: Icons.calendarClock,
  expired: Icons.calendarX,
} as const;

export const STATUS_COLOR = {
  created: 'var(--text-secondary)',
  downloaded: 'var(--semantic-info)',
  expires: 'var(--text-secondary)',
  expired: 'var(--semantic-warning)',
} as const;
