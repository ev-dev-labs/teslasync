import {
  BarChart3, Activity, Calendar, MapPin, Clock,
} from 'lucide-react';
import { CHART_COLORS } from '@/components/charts';

export const TAB_KEYS = ['overview', 'driving', 'charging', 'battery'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const PIE_COLORS = [
  CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2],
  CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[5],
];

export const QUICK_LINKS = [
  { labelKey: 'analytics.links.statistics', href: '/statistics', icon: <BarChart3 className="h-4 w-4" /> },
  { labelKey: 'analytics.links.compare', href: '/period-compare', icon: <Activity className="h-4 w-4" /> },
  { labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest', icon: <Calendar className="h-4 w-4" /> },
  { labelKey: 'analytics.links.mileage', href: '/mileage', icon: <MapPin className="h-4 w-4" /> },
  { labelKey: 'analytics.links.timeline', href: '/timeline', icon: <Clock className="h-4 w-4" /> },
];
