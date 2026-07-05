import {
  BarChart3, Activity, Calendar, MapPin, Clock,
} from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CHART_COLORS } from '@/components/charts';
import type { FleetAnalytics } from '@/api/types';

export const TAB_KEYS = ['overview', 'driving', 'charging', 'battery'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

/**
 * Shared shape threaded from the page's `useFleetAnalytics()` down to every
 * tab and section so each panel can own its loading / error / empty state.
 */
export type FleetAnalyticsQuery = UseQueryResult<FleetAnalytics>;

/**
 * Pie/donut slice palette — the first six entries of the CB-safe
 * {@link CHART_COLORS}. Using `slice` (rather than fixed `[0]…[5]` indexing)
 * keeps every entry a defined hex string even if the shared palette is ever
 * shortened, so consumers that cycle with `PIE_COLORS[i % PIE_COLORS.length]`
 * never hand recharts a `fill={undefined}`.
 */
export const PIE_COLORS = CHART_COLORS.slice(0, 6);

/**
 * Overview-tab "Quick Links" band. Every `href` is a real app route (pinned by
 * the route-registry test), every `labelKey` resolves under `analytics.links.*`
 * in the i18n catalog, and every `icon` is decorative — the link's accessible
 * name comes from its adjacent text label, so each glyph is `aria-hidden`
 * (matching the trailing chevron in the OverviewTab consumer).
 */
export const QUICK_LINKS = [
  { labelKey: 'analytics.links.statistics', href: '/statistics', icon: <BarChart3 className="h-4 w-4" aria-hidden="true" /> },
  { labelKey: 'analytics.links.compare', href: '/period-compare', icon: <Activity className="h-4 w-4" aria-hidden="true" /> },
  { labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest', icon: <Calendar className="h-4 w-4" aria-hidden="true" /> },
  { labelKey: 'analytics.links.mileage', href: '/mileage', icon: <MapPin className="h-4 w-4" aria-hidden="true" /> },
  { labelKey: 'analytics.links.timeline', href: '/timeline', icon: <Clock className="h-4 w-4" aria-hidden="true" /> },
];
