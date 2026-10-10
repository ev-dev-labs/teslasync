import type { ReactNode } from 'react';

export type MobileRole = 'title' | 'primary' | 'meta' | 'badge' | 'progress' | 'hidden';
export type MobileVariant = 'cards' | 'keyValue';
export type MobileExportScope = 'matchingLoaded' | 'selectedLoaded' | 'fullResult';
export interface MobileField {
  key: string;
  label: string;
  value: string;
}
/** Display values only. Canonical SI rows remain owned by the caller. */
export interface MobileRow<K extends string | number = string> {
  key: K;
  title: string;
  primary: string;
  tag?: string;
  meta: readonly MobileField[];
  badge?: { value: string; label: string };
  progress?: { from: number; to: number; label: string };
  rawLabel?: string;
  /** Every source field, including summary-hidden fields, must be reachable on activation. */
  details: readonly MobileField[];
}
export interface MobileGroup {
  key: string;
  label?: string;
  rows: readonly MobileRow[];
  /** Count is for the actual group, not the currently displayed batch. */
  memberCount: number;
  summary?: string;
}
export type MobileState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'empty'; message: string; action?: { label: string; onAction: () => void } }
  | { kind: 'noMatch'; query: string }
  | { kind: 'error'; message: string; retained: boolean; retrying?: boolean };
export interface MobileSortOption { key: string; label: string }
export interface MobileQuickFilter { key: string; label: string; count: number }
export interface MobileExportAction {
  scope: MobileExportScope;
  /** Must describe the callback's actual scope, not the visible mobile batch. */
  label: string;
  disabled?: boolean;
}
export interface MobileGridModel {
  id: string;
  label: string;
  variant: MobileVariant;
  state: MobileState;
  groups: readonly MobileGroup[];
  query: string;
  /** Unknown maximum keeps Search visible. Current page size is not a maximum. */
  maximumRows?: number;
  sortOptions: readonly MobileSortOption[];
  sortKey: string;
  filters: readonly MobileQuickFilter[];
  filterKey: string;
  selection: { enabled: boolean; mode: 'single' | 'multi'; keys: readonly string[] };
  pagination:
    | { kind: 'single'; count: number; countInHeading?: boolean }
    | { kind: 'cumulative'; shown: number; total: number | null; nextCount: number; busy?: boolean }
    | { kind: 'replacing'; notice: string };
  exports: readonly MobileExportAction[];
  exportBusy?: boolean;
  exportError?: string;
  overlays: { sort: boolean; overflow: boolean };
}
export interface MobileGridCallbacks {
  onSearch: (query: string) => void;
  onFilter: (key: string) => void;
  onSort: (key: string) => void;
  onOverlay: (overlay: 'sort' | 'overflow', open: boolean) => void;
  onSelectionMode: (enabled: boolean) => void;
  onToggleSelection: (key: string) => void;
  onActivate: (key: string) => void;
  onExport: (scope: MobileExportScope) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onClear: () => void;
}
export interface MobileGridReferenceProps {
  model: MobileGridModel;
  callbacks: MobileGridCallbacks;
  /** Existing DataTable or frozen desktop renderer. No candidate processing of this slot. */
  desktop: ReactNode;
}
