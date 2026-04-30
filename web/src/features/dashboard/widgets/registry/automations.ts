import { lazy } from 'react';
import { Workflow, PlayCircle } from 'lucide-react';
import type { WidgetDef } from '../types';

export const AUTOMATION_WIDGETS: WidgetDef[] = [
  {
    id: 'automation-status',
    name: 'Automation Status',
    description: 'Active automations: last run, success/fail badge, next scheduled',
    icon: Workflow,
    category: 'automations',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../AutomationStatusWidget')),
  },
  {
    id: 'automation-history',
    name: 'Automation History',
    description: 'Recent automation runs: success/failure status, execution times',
    icon: PlayCircle,
    category: 'automations',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazy(() => import('../AutomationHistoryWidget')),
  },
];
