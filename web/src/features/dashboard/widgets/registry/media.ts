import { lazy } from 'react';
import { Music, ListMusic } from 'lucide-react';
import type { WidgetDef } from '../types';

export const MEDIA_WIDGETS: WidgetDef[] = [
  {
    id: 'media-now-playing',
    name: 'Now Playing',
    description: 'Current media: song title, artist, source',
    icon: Music,
    category: 'media',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../MediaNowPlayingWidget')),
  },
  {
    id: 'media-history',
    name: 'Media History',
    description: 'Recently played tracks: title, artist, source, playback history',
    icon: ListMusic,
    category: 'media',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../MediaHistoryWidget')),
  },
];
