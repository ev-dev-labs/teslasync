// Native parity port of
// web/src/features/analytics/components/analytics/constants.tsx.
//
// The web module is the small constants file backing the Analytics page tab
// system and Overview "quick links":
//   * TAB_KEYS / TabKey — the four analytics tab identifiers (overview /
//     driving / charging / battery).
//   * PIE_COLORS — the first six entries of the shared CHART_COLORS palette,
//     used to fill the analytics pie/donut chart cells.
//   * QUICK_LINKS — the five quick-link cards on the Overview tab, each with an
//     i18n labelKey, an in-app route href, and a small icon node.
//
// This port keeps the data, route hrefs, and i18n keys byte-for-byte identical
// and only swaps the two platform-specific dependencies:
//   * web `@/components/charts` -> the native charts barrel. Its CHART_COLORS is
//     the same CB-safe Okabe-Ito palette (#0072B2, #E69F00, #009E73, #F0E442,
//     #56B4E9, #D55E00, ...), so PIE_COLORS is value-identical to the web array.
//   * The lucide-react JSX icons (`<BarChart3 className="h-4 w-4" />`, ...) have
//     no native analogue (the app ships no SVG/vector icon set), so each is
//     rendered through the repo's SemanticIcon — the established way every
//     native parity port renders a lucide glyph. `icon` stays a renderable React
//     node, so a consumer keeps rendering `{link.icon}` exactly like the web.
//     The lucide -> SemanticIcon mapping preserves each icon's intent:
//       BarChart3 -> analytics, Activity -> activity, Calendar -> calendar,
//       MapPin -> mapPinned, Clock -> clock.
//
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported into the native output.

import React from 'react';

import { SemanticIcon } from '../../../../../components/icons/SemanticIcon';
import { CHART_COLORS } from '../../../../components/charts';

export const TAB_KEYS = ['overview', 'driving', 'charging', 'battery'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const PIE_COLORS = [
  CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2],
  CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[5],
];

export const QUICK_LINKS = [
  { labelKey: 'analytics.links.statistics', href: '/statistics', icon: <SemanticIcon name="analytics" size="sm" decorative /> },
  { labelKey: 'analytics.links.compare', href: '/period-compare', icon: <SemanticIcon name="activity" size="sm" decorative /> },
  { labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest', icon: <SemanticIcon name="calendar" size="sm" decorative /> },
  { labelKey: 'analytics.links.mileage', href: '/mileage', icon: <SemanticIcon name="mapPinned" size="sm" decorative /> },
  { labelKey: 'analytics.links.timeline', href: '/timeline', icon: <SemanticIcon name="clock" size="sm" decorative /> },
];
