/**
 * SignalCategoryTree — categorized signal picker for SignalsWorkspacePage.
 *
 * Thin wrapper around the generic `TreeSelect` primitive: pulls the
 * vehicle's available-signal catalog, groups by `category`, applies
 * friendly category labels, and feeds each leaf a lazy
 * `SignalSparklinePreview` (only rendered when its category is
 * expanded — TanStack Query short-circuits unmounted hooks).
 *
 * Selection / search / expanded-group state are all controlled by the
 * parent so the page can URL-sync them.
 */

import { useMemo } from 'react';
import { TreeSelect, type TreeGroup } from '@/components/forms';
import { useAvailableSignals } from '@/api/hooks/useSignals';
import type { SignalDescriptor } from '@/api/types';
import { SignalSparklinePreview } from './SignalSparklinePreview';

/** Closed set of routing categories shipped by `internal/tesla/protomodel`. */
const CATEGORY_LABELS: Record<string, string> = {
  charging: 'Charging',
  driving: 'Driving',
  climate: 'Climate',
  location: 'Location',
  powertrain: 'Powertrain',
  vehicle_state: 'Vehicle State',
  safety_security: 'Safety & Security',
  media: 'Media',
  config: 'Config',
  prefs: 'Preferences',
  setting_unit: 'Setting Units',
  metadata: 'Metadata',
};

/** Stable display order. Unknown categories sort last alphabetically. */
const CATEGORY_ORDER = [
  'charging',
  'driving',
  'powertrain',
  'climate',
  'location',
  'vehicle_state',
  'safety_security',
  'media',
  'config',
  'prefs',
  'setting_unit',
  'metadata',
];

function categoryRank(id: string): number {
  const idx = CATEGORY_ORDER.indexOf(id);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function friendlyCategoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id;
}

export interface SignalCategoryTreeProps {
  vehicleId: number;
  selectedSignals: string[];
  onChange: (next: string[] | ((prev: string[]) => string[])) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  expandedGroupIds: string[];
  onExpandedChange: (next: string[]) => void;
  /** Disable sparklines (e.g. when many signals are selected and sparkline fetches would be wasteful). */
  showSparklines?: boolean;
  className?: string;
  maxHeightClassName?: string;
}

export function SignalCategoryTree({
  vehicleId,
  selectedSignals,
  onChange,
  searchValue,
  onSearchChange,
  expandedGroupIds,
  onExpandedChange,
  showSparklines = true,
  className,
  maxHeightClassName,
}: SignalCategoryTreeProps) {
  const query = useAvailableSignals(vehicleId);

  const groups = useMemo<TreeGroup<SignalDescriptor>[]>(() => {
    const signals = query.data?.signals ?? [];
    if (signals.length === 0) return [];
    const byCat = new Map<string, SignalDescriptor[]>();
    for (const s of signals) {
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    const out: TreeGroup<SignalDescriptor>[] = [];
    for (const [cat, list] of byCat) {
      // Sort leaves alphabetically within each category for predictable
      // display (matches the backend's own SignalsByName ordering).
      list.sort((a, b) => a.name.localeCompare(b.name));
      out.push({
        id: cat,
        label: friendlyCategoryLabel(cat),
        leaves: list.map((s) => ({ id: s.name, label: s.name, data: s })),
      });
    }
    out.sort((a, b) => {
      const ra = categoryRank(a.id);
      const rb = categoryRank(b.id);
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
    return out;
  }, [query.data]);

  // Per-group expansion drives the sparkline lazy-fetch.
  const expandedSet = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);
  const isSearching = searchValue.trim().length > 0;

  return (
    <TreeSelect<SignalDescriptor>
      groups={groups}
      selectedIds={selectedSignals}
      onChange={onChange}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      expandedGroupIds={expandedGroupIds}
      onExpandedChange={onExpandedChange}
      isLoading={query.isLoading}
      ariaLabel="Signal catalog"
      searchPlaceholder="Search signals…"
      emptyState={
        query.isError
          ? `Failed to load catalog: ${(query.error as Error)?.message ?? 'unknown error'}`
          : 'No signals available for this vehicle.'
      }
      className={className}
      maxHeightClassName={maxHeightClassName}
      renderLeafRight={
        showSparklines
          ? (leaf) => {
              const groupId = leaf.data.category;
              // Sparkline fetches only when the group is expanded
              // (or the user is searching, which auto-expands all
              // matching groups in TreeSelect).
              const enabled = isSearching || expandedSet.has(groupId);
              return (
                <SignalSparklinePreview
                  vehicleId={vehicleId}
                  signal={leaf.id}
                  valueKind={leaf.data.value_kind}
                  enabled={enabled}
                />
              );
            }
          : undefined
      }
    />
  );
}
