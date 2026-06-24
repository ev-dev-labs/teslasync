import type { ComponentType } from 'react';

import type { RouteId } from '../navigation/routes';
import type { SemanticIconName } from '../components/icons/SemanticIcon';

export type NativeWidgetStatus = 'implemented' | 'pending';

export type NativeWidgetCategory =
  | 'alerts'
  | 'analytics'
  | 'automation'
  | 'battery'
  | 'charging'
  | 'climate'
  | 'driving'
  | 'energy'
  | 'maps'
  | 'media'
  | 'navigation'
  | 'security'
  | 'system'
  | 'tires'
  | 'vehicle';

export interface NativeWidgetSize {
  cols: number;
  rows: number;
}

export interface NativeWidgetProps {
  vehicleId?: number;
  onNavigate?: (route: RouteId) => void;
}

interface NativeWidgetDefinitionBase {
  id: string;
  title: string;
  description: string;
  category: NativeWidgetCategory;
  icon: SemanticIconName;
  webWidgetIds: readonly string[];
  defaultSize: NativeWidgetSize;
}

export interface ImplementedNativeWidgetDefinition extends NativeWidgetDefinitionBase {
  status: 'implemented';
  component: ComponentType<NativeWidgetProps>;
}

export interface PendingNativeWidgetDefinition extends NativeWidgetDefinitionBase {
  status: 'pending';
  pendingReason: string;
}

export type NativeWidgetDefinition =
  | ImplementedNativeWidgetDefinition
  | PendingNativeWidgetDefinition;
