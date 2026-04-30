import { lazy } from 'react';
import { Bell } from 'lucide-react';
import type { WidgetDef } from '../types';

export const ALERT_WIDGETS: WidgetDef[] = [
  {
    id: 'alert-feed',
    name: 'Alert Feed',
    description: 'Recent alerts reverse-chronological with severity badges',
    icon: Bell,
    category: 'alerts',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../AlertFeedWidget')),
  },
  {
    id: 'notification-stats',
    name: 'Notification Stats',
    description: 'Notification delivery rate, active channels, recent delivery log',
    icon: Bell,
    category: 'alerts',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../NotificationStatsWidget')),
  },
];
