import type { MobileRole, MobileRow, MobileGroup, MobileGridModel } from './types';

export const MOBILE_GRID_BOUNDARY = 640;
export function isMobileGridWidth(width: number): boolean {
  return Number.isFinite(width) && width >= 0 && width < MOBILE_GRID_BOUNDARY;
}
export function showMobileSearch(maximumRows: number | undefined): boolean {
  return maximumRows == null || maximumRows > 10;
}
export function canLoadMore(paging: MobileGridModel['pagination']): boolean {
  return paging.kind === 'cumulative' && paging.nextCount > 0
    && (paging.total == null || paging.shown < paging.total);
}
export function groupHasSummary(group: MobileGroup): boolean {
  return group.memberCount >= 2 && group.summary != null;
}
export function safeProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
/** Explicit roles are preferred; numeric is metadata, never inferred from JSX text. */
export function defaultMobileRoles(
  fields: readonly { key: string; numeric?: boolean; visible?: boolean }[],
): ReadonlyMap<string, MobileRole> {
  const roles = new Map<string, MobileRole>();
  const visible = fields.filter(field => field.visible !== false);
  const title = visible[0]?.key;
  const primary = visible.find(field => field.numeric && field.key !== title)?.key;
  let meta = 0;
  for (const field of fields) {
    let role: MobileRole = 'hidden';
    if (field.key === title) role = 'title';
    else if (field.key === primary) role = 'primary';
    else if (field.visible !== false && meta < 3) { role = 'meta'; meta += 1; }
    roles.set(field.key, role);
  }
  return roles;
}
/** Configuration validation is explicit: don't silently discard excess/duplicate metadata. */
export function rowMappingIssues(row: MobileRow<string | number>): string[] {
  const issues: string[] = [];
  if (row.meta.length > 3) issues.push('too-many-meta-fields');
  const keys = row.meta.map(field => field.key);
  if (new Set(keys).size !== keys.length) issues.push('duplicate-meta-field');
  if (new Set(row.details.map(field => field.key)).size !== row.details.length) {
    issues.push('duplicate-detail-field');
  }
  return issues;
}
