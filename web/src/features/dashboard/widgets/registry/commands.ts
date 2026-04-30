import { lazy } from 'react';
import { Command, Terminal } from 'lucide-react';
import type { WidgetDef } from '../types';

export const COMMAND_WIDGETS: WidgetDef[] = [
  {
    id: 'command-quick-actions',
    name: 'Quick Actions',
    description: 'Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash',
    icon: Command,
    category: 'commands',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../CommandQuickActionsWidget')),
  },
  {
    id: 'command-history',
    name: 'Command History',
    description: 'Recent vehicle commands: lock, unlock, climate — with success/fail status',
    icon: Terminal,
    category: 'commands',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../CommandHistoryWidget')),
  },
];
