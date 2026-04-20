import { useMemo } from 'react';
import { useLocation, useParams, matchPath } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BreadcrumbItem } from '@/components/layout/Breadcrumbs';

interface RouteConfig {
  pattern: string;
  label: string;
  parent?: string;
}

/**
 * Ordered by specificity — more specific patterns first so matchPath
 * picks the right one when multiple could match.
 */
const ROUTE_CONFIGS: RouteConfig[] = [
  // Drive detail + replay
  { pattern: '/drives/:id/replay', label: 'Trip Replay', parent: '/drives/:id' },
  { pattern: '/drives/:id', label: 'Drive #{{id}}', parent: '/drives' },
  { pattern: '/drives', label: 'Drives' },

  // Charging detail
  { pattern: '/charging/:id', label: 'Session #{{id}}', parent: '/charging' },
  { pattern: '/charging', label: 'Charging' },

  // Vehicle detail + access
  { pattern: '/vehicles/:id/access', label: 'Vehicle Access', parent: '/vehicles/:id' },
  { pattern: '/vehicles/:id', label: 'Vehicle #{{id}}', parent: '/vehicles' },
  { pattern: '/vehicles', label: 'Vehicles' },

  // Trip detail
  { pattern: '/trips/:id', label: 'Trip #{{id}}', parent: '/trips' },
  { pattern: '/trips', label: 'Trips' },

  // Automations
  { pattern: '/automations/:id/edit', label: 'Edit Automation', parent: '/automations' },
  { pattern: '/automations/new', label: 'New Automation', parent: '/automations' },
  { pattern: '/automations', label: 'Automations' },
];

/** Build a lookup from pattern → config for parent chain traversal */
const CONFIG_MAP = new Map(ROUTE_CONFIGS.map((c) => [c.pattern, c]));

/**
 * Build breadcrumb items from the current route.
 *
 * @param overrides - Map of route pattern → custom label for the breadcrumb.
 *   Use this to replace default labels with dynamic content (e.g. vehicle name).
 */
export function useBreadcrumbs(overrides?: Partial<Record<string, string>>): BreadcrumbItem[] {
  const location = useLocation();
  const params = useParams();
  const { t } = useTranslation();

  return useMemo(() => {
    const path = location.pathname;

    // Find which route config matches the current path
    let matchedPattern: string | undefined;
    for (const config of ROUTE_CONFIGS) {
      if (matchPath({ path: config.pattern, end: true }, path)) {
        matchedPattern = config.pattern;
        break;
      }
    }
    if (!matchedPattern) return [];

    // Walk up the parent chain to build the breadcrumb trail
    const items: BreadcrumbItem[] = [];
    let current: string | undefined = matchedPattern;

    while (current) {
      const config = CONFIG_MAP.get(current);
      if (!config) break;

      // Resolve label: override > i18n > default with params interpolated
      let label = overrides?.[current] ?? config.label;
      // Replace {{param}} placeholders with actual param values
      for (const [key, value] of Object.entries(params)) {
        if (value) label = label.replace(`{{${key}}}`, value);
      }
      label = t(`breadcrumb.${current}`, label);

      // Resolve href by replacing :param with actual values
      let href: string | undefined = current;
      for (const [key, value] of Object.entries(params)) {
        if (value) href = href.replace(`:${key}`, value);
      }

      items.unshift({
        label,
        href: current === matchedPattern ? undefined : href,
      });

      current = config.parent;
    }

    return items;
  }, [location.pathname, params, overrides, t]);
}
